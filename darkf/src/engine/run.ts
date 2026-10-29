import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentFailure,
  type AgentProgress,
  type AgentRunner,
  buildRegistry,
  type CrashReason,
  type DispatchInfo,
  DONE,
  DuplicateStateIdError,
  enter,
  FAILED,
  isComposite,
  isNodeResult,
  type NodeEvent,
  type NodeResult,
  type NodeStatus,
  type RegistryEntry,
  type RunResult,
  resolveTarget,
  type ScriptRunner,
  type StepTrace,
  validateWorkflow,
  type WorkflowDef,
} from "../core/index.ts";
import { createJsonlEventLogger } from "./eventLog.ts";

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 1h — high default ceiling, not a tuning knob
const DEFAULT_MAX_STEPS = 1000;
// Bounded in-session repair attempts per outer attempt (see
// docs/specs/session-nudge/spec.md) — not a `def.retries`-style tuning
// knob, deliberately fixed.
const NUDGE_LIMIT = 3;
const NUDGEABLE_KINDS = new Set<CrashReason["kind"]>([
  "handoff-missing",
  "handoff-unparseable",
  "no-transition",
]);
function isNudgeable(reason: CrashReason): boolean {
  return NUDGEABLE_KINDS.has(reason.kind);
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const defaultScriptRunner: ScriptRunner = {
  async run(_id, def, handoff, baseDir, info) {
    const url = pathToFileURL(`${baseDir}/${def.file}`).href;
    const mod = await import(url);
    // Scripts get the DispatchInfo too — rootDir lets a script act on the
    // target repo (spawn builds, read files) without hardcoding its location.
    const fn = mod.default as (
      handoff: NodeResult,
      info: DispatchInfo,
    ) => NodeResult | Promise<NodeResult>;
    return await fn(handoff, info);
  },
};

export interface RunOptions {
  workflow: WorkflowDef;
  /** Seed handed to the first node's dispatch, in place of a predecessor's result. Same shape as every other handoff — no special-casing. Default `{}`. */
  input?: NodeResult;
  agentRunner?: AgentRunner;
  scriptRunner?: ScriptRunner;
  /** Live-runtime heartbeat cadence for open dispatches (default 30s, 0 disables). */
  heartbeatMs?: number;
  baseDir?: string;
  maxSteps?: number;
  /** Fires on every transition of every node's execution machine, live, as it happens. */
  onEvent?: (event: NodeEvent) => void;
  /** Root for run artifacts. Default: cwd. Every run always journals to `<rootDir>/.darkf/run/<runId>/journal.jsonl` — not optional. */
  rootDir?: string;
  /** Run identifier. A UUID when omitted. Honored by callers that must key external state (e.g. `darkf-cli`'s registry entry) to the run's own journal directory. */
  runId?: string;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const runId = opts.runId ?? crypto.randomUUID();
  const trace: StepTrace[] = [];
  let handoff: NodeResult = opts.input ?? {};
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const scriptRunner = opts.scriptRunner ?? defaultScriptRunner;
  const baseDir = opts.baseDir ?? process.cwd();
  const rootDir = opts.rootDir ?? process.cwd();

  const journalPath = join(rootDir, ".darkf", "run", runId, "journal.jsonl");
  const jsonlLogger = createJsonlEventLogger(journalPath);

  function emit(status: NodeStatus, state: string, scopePath: string[]): void {
    const event: NodeEvent = { runId, state, scopePath, status, timestamp: Date.now() };
    jsonlLogger(event);
    opts.onEvent?.(event);
  }

  function crashed(
    reason: CrashReason,
    attempt: number,
    state: string,
    scopePath: string[],
  ): RunResult {
    const status: NodeStatus = { phase: "crashed", reason, attempt };
    emit(status, state, scopePath);
    return { runId, trace, node: status };
  }

  // Run begin marker: the run machine's own first transition. Emitted before
  // buildRegistry (not merely before the dispatch loop) so it is
  // journal.jsonl's first line even if the registry build crashes and
  // returns before the loop. `handoff` here is the run's seed
  // (`opts.input ?? {}`), unchanged since it was set above.
  emit({ phase: "succeeded", result: handoff }, DONE, []);

  let registry: Map<string, RegistryEntry>;
  try {
    registry = buildRegistry(opts.workflow);
  } catch (err) {
    if (err instanceof DuplicateStateIdError) {
      return crashed({ kind: "duplicate-id", id: err.id }, 0, err.id, []);
    }
    throw err;
  }

  const validationErrors = validateWorkflow(registry, opts.workflow.initial);
  if (validationErrors.length > 0) {
    return crashed(
      { kind: "invalid-workflow", errors: validationErrors },
      0,
      opts.workflow.initial,
      [],
    );
  }

  let current = enter(registry, opts.workflow.initial);
  let steps = 0;
  const cycleCounters = new Map<string, number>();
  // The immediately preceding dispatch's scopePath — lets the cycle-count
  // loop below tell "still inside the same pass through this composite"
  // apart from "just entered it again" (a composite id present here keeps
  // accumulating; one absent here is a fresh entry and resets to 0). Each
  // composite id's freshness is independent of its ancestors'/descendants'
  // — diving into a nested composite for the first time doesn't reset an
  // outer composite that's still mid-pass, and vice versa.
  let previousScopePath: string[] = [];

  for (;;) {
    if (steps++ >= maxSteps) {
      return crashed({ kind: "max-steps", steps, state: current }, 0, current, []);
    }

    const entry = registry.get(current);
    if (!entry || isComposite(entry.def)) {
      return crashed({ kind: "unresolved-target", from: current, target: current }, 0, current, []);
    }
    const def = entry.def;
    const scopePath = entry.scopePath;
    const previousScopeSet = new Set(previousScopePath);

    for (let i = scopePath.length - 1; i >= 0; i--) {
      const compositeId = scopePath[i]!;
      const compositeDef = registry.get(compositeId)?.def;
      const maxCycles =
        compositeDef && isComposite(compositeDef) ? compositeDef.maxCycles : undefined;
      if (maxCycles === undefined) continue;
      const count = previousScopeSet.has(compositeId) ? (cycleCounters.get(compositeId) ?? 0) : 0;
      if (count >= maxCycles) {
        return crashed(
          { kind: "cycle-limit", composite: compositeId, cycles: maxCycles },
          0,
          current,
          scopePath,
        );
      }
      cycleCounters.set(compositeId, count + 1);
    }
    previousScopePath = scopePath;

    const maxAttempts = (def.retries ?? 0) + 1;
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let result: NodeResult | undefined;
    let target: string | undefined;
    let reason: CrashReason | undefined;
    let agentSessionId: string | undefined;
    let attempt = 0;

    attemptLoop: for (attempt = 1; attempt <= maxAttempts; attempt++) {
      // Fixed once per outer attempt: every dispatch this attempt makes — the
      // first call and up to NUDGE_LIMIT nudges after it — spends down the
      // SAME remaining budget, so a nudge sequence can't multiply the
      // configured per-attempt timeout (docs/specs/session-nudge/spec.md,
      // "Dispatch loop change").
      const deadline = Date.now() + timeoutMs;
      let nudgeAttempt = 0;

      for (;;) {
        const nudgeReason = nudgeAttempt > 0 ? reason?.kind : undefined;
        const info: DispatchInfo = {
          runId,
          validEvents: Object.keys(def.on ?? {}),
          hasFallback: def.next !== undefined,
          attempt,
          agentSessionId,
          previousFailure: reason,
          step: steps,
          rootDir,
        };
        const startedAt = Date.now();
        // Reset fresh per dispatch attempt (including each nudge) — a new
        // process gets a new progress snapshot, never carried over from a
        // previous attempt. See docs/specs/agent-liveness/spec.md.
        let latestProgress: AgentProgress | undefined;
        const onProgress = (p: AgentProgress) => {
          latestProgress = p;
        };
        const runningStatus = (lastHeartbeat: number): NodeStatus => ({
          phase: "running",
          attempt,
          startedAt,
          lastHeartbeat,
          agentSessionId,
          ...(latestProgress
            ? {
                agentStepCount: latestProgress.stepCount,
                agentIdleMs: lastHeartbeat - latestProgress.at,
              }
            : {}),
          ...(nudgeAttempt > 0 ? { nudgeAttempt, nudgeReason } : {}),
        });
        emit(runningStatus(startedAt), current, scopePath);
        // Live-runtime heartbeats: journal a refreshed `running` status while the
        // dispatch is open, so status/monitor can advance runtime and prove
        // liveness (spec: darkf-cli/docs/specs/live-runtime). unref'd — a pending
        // timer must never keep the process alive past the run's own exit.
        const heartbeat =
          heartbeatMs > 0
            ? setInterval(() => emit(runningStatus(Date.now()), current, scopePath), heartbeatMs)
            : undefined;
        heartbeat?.unref?.();

        try {
          const dispatch =
            def.type === "agent"
              ? requireAgentRunner(opts.agentRunner).run(current, def, handoff, info, onProgress)
              : scriptRunner.run(current, def, handoff, baseDir, info);
          const raw = await withTimeout(dispatch, Math.max(0, deadline - Date.now()));
          heartbeat && clearInterval(heartbeat);

          if (!isNodeResult(raw)) {
            reason = { kind: "malformed-result" };
            continue attemptLoop;
          }
          agentSessionId = raw.agentSessionId ?? agentSessionId;
          const validationError = def.validate?.(raw, handoff);
          if (validationError !== undefined) {
            reason = { kind: "validation-failed", message: validationError };
            continue attemptLoop;
          }
          const resolved = resolveTarget(def, raw.event);
          if (resolved === undefined) {
            reason = { kind: "no-transition", state: current, event: raw.event };
            if (agentSessionId && nudgeAttempt < NUDGE_LIMIT) {
              nudgeAttempt++;
              continue;
            }
            continue attemptLoop;
          }

          result = raw;
          target = resolved;
          reason = undefined;
          break attemptLoop;
        } catch (err) {
          heartbeat && clearInterval(heartbeat);
          if (err instanceof TimeoutError) {
            reason = { kind: "timeout", elapsedMs: timeoutMs };
            continue attemptLoop;
          }
          if (err instanceof AgentFailure) {
            agentSessionId = err.agentSessionId ?? agentSessionId;
            reason = err.crashReason ?? { kind: "runner-error", error: err.message };
          } else {
            reason = {
              kind: "runner-error",
              error: err instanceof Error ? err.message : String(err),
            };
          }
          if (isNudgeable(reason) && agentSessionId && nudgeAttempt < NUDGE_LIMIT) {
            nudgeAttempt++;
            continue;
          }
          continue attemptLoop;
        }
      }
    }

    if (!result) {
      return crashed(reason!, attempt - 1, current, scopePath);
    }

    emit({ phase: "succeeded", result }, current, scopePath);
    trace.push({ state: current, scopePath, result, timestamp: Date.now() });
    handoff = result;

    // `target` is always set alongside `result` in the success branch above.
    const nextTarget = target!;
    if (nextTarget === DONE) {
      // Run end marker: the run machine's terminal transition — the last
      // journal line on success. A crashed run never reaches here, so it has
      // no end marker; the crashing leaf's own `crashed` emit is its last.
      emit({ phase: "succeeded", result }, DONE, []);
      return { runId, trace, node: { phase: "succeeded", result } };
    }
    // Both sentinel checks must sit strictly before the unresolved-target
    // guard below — FAILED, like DONE, has no registry entry, so checked
    // after the guard every FAILED-routed dispatch would crash as
    // unresolved-target instead of grading as failed.
    if (nextTarget === FAILED) {
      emit({ phase: "failed", result }, FAILED, []);
      return { runId, trace, node: { phase: "failed", result } };
    }
    if (!registry.has(nextTarget)) {
      return crashed(
        { kind: "unresolved-target", from: current, target: nextTarget },
        attempt,
        current,
        scopePath,
      );
    }
    current = enter(registry, nextTarget);
  }
}

function requireAgentRunner(agentRunner: AgentRunner | undefined): AgentRunner {
  if (!agentRunner) {
    throw new Error("Workflow contains an agent node but no agentRunner was provided");
  }
  return agentRunner;
}
