import {
  type CrashReason,
  DONE,
  FAILED,
  type NodeResult,
  parseEventLog,
  type Task,
  type TaskList,
} from "../core/index.ts";
import { journalTerminal, type RegistryStatus } from "./registry.ts";

export interface JournalDigest {
  current: {
    state: string;
    phase: string;
    /** Present while a dispatch is open (running events carry it). */
    startedAt?: number;
    lastHeartbeat?: number;
    /** The agent-dispatch session for this running node, when its runner
     *  reported one (`NodeStatus.agentSessionId`) — e.g. a resumable claude-code
     *  `--resume` session. Absent for script dispatches or runners that
     *  don't report one. */
    agentSessionId?: string;
    /** Present while the engine is nudging this attempt (1..3) — see
     *  `nudgeWarning` and docs/specs/session-nudge/spec.md. */
    nudgeAttempt?: number;
    /** The nudgeable `CrashReason` kind that triggered the current nudge. */
    nudgeReason?: CrashReason["kind"];
    /** Latest agent-reported step count, when the runner reports progress —
     *  see `agentStallWarning` and docs/specs/agent-liveness/spec.md. */
    agentStepCount?: number;
    /** Milliseconds idle as of the last heartbeat — see `agentStallWarning`. */
    agentIdleMs?: number;
  } | null;
  crash?: { attempt: number; reason: CrashReason };
  visits: Record<string, number>;
  runtimeMs: number | null;
  hasBegin: boolean;
  hasEnd: boolean;
  seed?: NodeResult;
  finalResult?: NodeResult;
}

// Fold a journal's event stream into the one-shot digest `status` prints and
// `monitor` builds on. `visits` counts distinct visits per node: a visit
// begins at a `running` event with attempt 1 (retries reuse the same visit, so
// a node's attempts > 1 does not add a visit). `hasBegin`/`hasEnd` are read
// from the first/last lines — the journal's own DONE/FAILED-tagged markers.
export function foldJournal(journalText: string): JournalDigest {
  const events = parseEventLog(journalText);
  const digest: JournalDigest = {
    current: null,
    visits: {},
    runtimeMs: null,
    hasBegin: false,
    hasEnd: false,
  };
  if (events.length === 0) return digest;

  const first = events[0]!;
  const last = events.at(-1)!;

  if (first.state === DONE && first.status.phase === "succeeded") {
    digest.hasBegin = true;
    digest.seed = first.status.result;
  }
  // Both terminal gradings end the run — a failed run's `hasEnd` must stay
  // true, or it reads as indistinguishable from one still in progress.
  if (last.state === DONE && last.status.phase === "succeeded") {
    digest.hasEnd = true;
    digest.finalResult = last.status.result;
  }
  if (last.state === FAILED && last.status.phase === "failed") {
    digest.hasEnd = true;
    digest.finalResult = last.status.result;
  }

  const lastStatus = last.status;
  digest.current = {
    state: last.state,
    phase: lastStatus.phase,
    ...(lastStatus.phase === "running"
      ? {
          startedAt: lastStatus.startedAt,
          lastHeartbeat: lastStatus.lastHeartbeat,
          agentSessionId: lastStatus.agentSessionId,
          nudgeAttempt: lastStatus.nudgeAttempt,
          nudgeReason: lastStatus.nudgeReason,
          agentStepCount: lastStatus.agentStepCount,
          agentIdleMs: lastStatus.agentIdleMs,
        }
      : {}),
  };
  if (last.status.phase === "crashed") {
    digest.crash = { attempt: last.status.attempt, reason: last.status.reason };
  }

  // Visit counting with heartbeat tolerance: a visit begins when a
  // (state, attempt, scope) dispatch OPENS — heartbeat events repeat the same
  // key while it stays open and must not inflate the count.
  const open = new Set<string>();
  for (const e of events) {
    if (e.state === DONE || e.state === FAILED) continue;
    const st = e.status;
    if (st.phase !== "running") continue;
    const key = `${e.state}|${st.attempt}|${(e.scopePath ?? []).join(">")}`;
    if (open.has(key)) continue;
    open.add(key);
    if (st.attempt === 1) {
      digest.visits[e.state] = (digest.visits[e.state] ?? 0) + 1;
    }
  }

  digest.runtimeMs = last.timestamp - first.timestamp;
  return digest;
}

// --- task lists (docs/specs/task-list-json/spec.md) ---

export interface TaskListDigest {
  /** Strict count: only `done` tasks — pending, in-progress, and failed all
   *  count as not-done, so the plugin's `nn/mm` tab title is honest. */
  done: number;
  total: number;
  /** The task the file says the run is on — its `in-progress` status is
   *  authoritative (no journal join); `null` when nothing is in-progress. */
  current: Task | null;
  /** Non-null only when the list is incoherent about "where the run is":
   *  more than one task in-progress. A `TaskList` carries no timestamps, so
   *  a time-based stall isn't derivable here — staleness of the current row
   *  stays covered by the workflow view's own stall warning. */
  stall: string | null;
}

// Pure fold over a parsed TaskList for rendering: done/total counts, the
// current in-progress item, and stall state. Never throws — input is an
// already-narrowed TaskList (see `parseTaskList`).
export function foldTaskList(list: TaskList): TaskListDigest {
  const inProgress = list.tasks.filter((t) => t.status === "in-progress");
  return {
    done: list.tasks.filter((t) => t.status === "done").length,
    total: list.tasks.length,
    current: inProgress[0] ?? null,
    stall:
      inProgress.length > 1
        ? `${inProgress.length} tasks in-progress — expected one; the list's current position is ambiguous`
        : null,
  };
}

export type TerminalState =
  | "succeeded"
  | "failed"
  | "crashed"
  | "orphaned"
  | "host-died"
  | "failed-start"
  | "running";

// The terminal-state classifier. The journal's last line is authoritative for
// succeeded/crashed; only when the journal shows no terminal marker does the
// PID decide (alive -> running, dead -> orphaned/host-died). The registry's
// own status/finishedAt are a best-effort cache that is never the authority,
// so they are deliberately not an input here — a stale "running" can never
// mask a journal-proven success into a false orphan. (Reading the registry to
// get the entry's pid and journal path is the resolution layer's job, in
// registry.ts.)
//
// `cachedStatus === "failed-start"` is the one deliberate exception to that
// rule: a failed-start run never gets a journal at all (the worker died
// before `run()` was ever called), so there is no journal-proven outcome
// this could ever mask — the registry is the only record that will ever
// exist. See docs/specs/_built/registry-lifecycle/spec.md.
export function classifyTerminal(
  journalText: string,
  pidAlive: boolean,
  opts?: { cachedStatus?: RegistryStatus; hostDied?: boolean },
): TerminalState {
  if (opts?.cachedStatus === "failed-start") return "failed-start";
  const outcome = journalTerminal(journalText);
  if (outcome) return outcome;
  if (pidAlive) return "running";
  if (opts?.hostDied) return "host-died";
  return "orphaned";
}

// --- run report ---

export interface ReportDispatch {
  state: string;
  durationMs: number;
  phase: "succeeded" | "failed" | "crashed";
  event?: string;
  reason?: unknown;
}

export interface ReportDigest {
  spanMs: number;
  dispatches: ReportDispatch[];
  visits: Record<string, number>;
  crashReasons: string[];
}

/** Per-dispatch fold for `darkf report`: one row per running→terminal pair
 *  (attempt-aware), plus the visit histogram and crash-reason summary. This is
 *  the efficacy/efficiency view the one-shot status digest deliberately is not. */
export function foldReport(journalText: string): ReportDigest {
  const events = parseEventLog(journalText);
  const digest: ReportDigest = { spanMs: 0, dispatches: [], visits: {}, crashReasons: [] };
  if (events.length === 0) return digest;

  digest.spanMs = events.at(-1)!.timestamp - events[0]!.timestamp;
  const openAt = new Map<string, number>();
  for (const e of events) {
    // DONE's begin/end markers are skipped — neither is a real node's
    // dispatch. FAILED's end marker is NOT skipped: it is `run_failure`'s
    // own terminal grading, with no preceding "running" open of its own (see
    // the `phase === "failed"` branch below), and it's the one piece of
    // evidence that the run ended in failure — dropping it here would
    // silently drop it from the report entirely.
    if (e.state === DONE) continue;
    const st = e.status;
    // Terminal events do not repeat the attempt field — normalize to 1.
    const attempt = st.phase === "running" ? st.attempt : 1;
    const key = `${e.state}|${attempt}|${(e.scopePath ?? []).join(">")}`;
    // Heartbeat tolerance: a running event for an already-open key is a
    // heartbeat — it must not re-open (reset the duration start) or inflate
    // the visit histogram.
    if (st.phase === "running" && openAt.has(key)) continue;
    if (st.phase === "running") {
      // a dispatch opens (first attempt or retry): count attempt-1 opens as
      // visits and start the duration clock
      if (attempt === 1) digest.visits[e.state] = (digest.visits[e.state] ?? 0) + 1;
      openAt.set(key, e.timestamp);
    } else if (st.phase === "succeeded") {
      const started = openAt.get(key);
      if (started === undefined) continue;
      openAt.delete(key);
      digest.dispatches.push({
        state: e.state,
        durationMs: e.timestamp - started,
        phase: "succeeded",
        event: st.result?.event,
      });
    } else if (st.phase === "crashed") {
      const started = openAt.get(key);
      if (started === undefined) continue;
      openAt.delete(key);
      digest.dispatches.push({
        state: e.state,
        durationMs: e.timestamp - started,
        phase: "crashed",
        reason: st.reason,
      });
      digest.crashReasons.push(JSON.stringify(st.reason));
    } else if (st.phase === "failed") {
      // The FAILED sentinel is never dispatched (no "running" open of its
      // own to pair with), unlike every other row in this fold — report it
      // as a zero-duration bookkeeping entry, the terminal grading itself
      // rather than a timed dispatch.
      digest.dispatches.push({
        state: e.state,
        durationMs: 0,
        phase: "failed",
        event: st.result?.event,
      });
    }
  }
  return digest;
}

// --- stall detection (warn-only; the supervisor owns the reaction) ---

export const STALL_AFTER_MS = 3 * 30_000;

/** Warn-only stall check for an open dispatch: heartbeats older than
 *  STALL_AFTER_MS mean the runner stopped proving liveness. Never acts —
 *  informing the supervisor is the whole contract. */
export function stallWarning(digest: JournalDigest, now: number = Date.now()): string | null {
  const hb = digest.current?.lastHeartbeat;
  if (digest.current?.phase !== "running" || hb === undefined) return null;
  const silentFor = now - hb;
  if (silentFor <= STALL_AFTER_MS) return null;
  return `stall suspected: no heartbeat for ${Math.round(silentFor / 1000)}s (state: ${digest.current.state}) — supervisor decides`;
}

// Placeholder default, not yet measured against real runs — see
// docs/specs/agent-liveness/spec.md's open questions (a long tool-execution
// gap, e.g. a 10-minute build, looks identical to a hung provider; the
// warning's step count is what lets the supervisor tell them apart).
export const AGENT_STALL_MS = 15 * 60_000;

/** Warn-only agent-level stall check: distinct from `stallWarning` (engine
 *  heartbeat liveness, proves only that the engine loop is alive) — this
 *  watches whether the AGENT is making step progress. A hung LLM backend
 *  still produces healthy engine heartbeats; this is what catches that.
 *  Absent `agentIdleMs` (script dispatch, or a runner that doesn't report
 *  progress) never warns — there's no evidence either way. Never acts. */
export function agentStallWarning(digest: JournalDigest, now: number = Date.now()): string | null {
  const hb = digest.current?.lastHeartbeat;
  const idleAsOfHeartbeat = digest.current?.agentIdleMs;
  if (digest.current?.phase !== "running" || hb === undefined || idleAsOfHeartbeat === undefined) {
    return null;
  }
  const liveIdleMs = idleAsOfHeartbeat + Math.max(0, now - hb);
  if (liveIdleMs <= AGENT_STALL_MS) return null;
  const steps = digest.current.agentStepCount ?? 0;
  return `agent stall suspected: no step event for ${Math.round(liveIdleMs / 60_000)}m (state: ${digest.current.state}, steps so far: ${steps}) — supervisor decides`;
}

/** Warn-only nudge-in-progress note, same contract as `stallWarning`: a
 *  nudge is already visible the instant the engine issues it
 *  (`nudgeAttempt`/`nudgeReason` are set then, not gated behind a
 *  heartbeat) — this is purely a display string, never acts.
 *  "3" mirrors darkf-engine's own fixed nudge budget (run.ts); kept as a
 *  literal here rather than imported, same as this module already treats
 *  other engine constants (e.g. `STALL_AFTER_MS`) as display-only
 *  knowledge, not a shared dependency. */
export function nudgeWarning(digest: JournalDigest): string | null {
  const { nudgeAttempt, nudgeReason } = digest.current ?? {};
  if (digest.current?.phase !== "running" || nudgeAttempt === undefined) return null;
  return `nudging attempt ${nudgeAttempt}/3 (${nudgeReason}) — supervisor decides`;
}
