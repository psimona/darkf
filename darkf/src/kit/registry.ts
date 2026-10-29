import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DONE, FAILED, parseEventLog } from "../core/index.ts";

export const SCHEMA_VERSION = 1;

export type RegistryStatus = "running" | "succeeded" | "failed" | "crashed" | "failed-start";

// A pointer to a detached run, never a source of truth for its outcome — the
// journal is. `status`/`finishedAt` are a best-effort cache a worker updates
// on completion; they are never trusted alone once the PID is found dead.
export interface RegistryEntry {
  schemaVersion: number;
  runId: string;
  pid: number;
  rootDir: string;
  startedAt: number;
  message?: string;
  status: RegistryStatus;
  finishedAt: number | null;
  /** Absolute path to the resolved workflow directory (contains
   *  `workflow.ts`) this run was started from. Optional so entries written
   *  before this field existed still parse. Lets a later process (e.g. a
   *  visualizer) load the same `WorkflowDef` this run is executing without
   *  having been the one that resolved the workflow reference itself. */
  workflowDir?: string;
  /** `AgentRunner.kind` of the runner this run was started with, copied at
   *  `startCmd`/`runCmd` time. Unset if the workflow has no agent nodes, or
   *  its runner doesn't self-identify. */
  agentRunnerKind?: string;
  /** The external session (if any) that invoked `darkf start`/`run`, and
   *  which harness it was — detected once, at invocation time, via
   *  `SUPERVISOR_ENV_SIGNALS`. Both unset if no signal matched. */
  supervisorSessionID?: string;
  supervisorHarness?: string;
  /** `/proc/sys/kernel/random/boot_id`, recorded at `start`/`run` time —
   *  lets a later `status` tell "this host rebooted since the run started"
   *  (`host-died`) apart from "the process just died" (`orphaned`). Absent
   *  on entries written before this field existed, or on a non-Linux host
   *  (`currentBootId()` returns `undefined` there) — both degrade to
   *  today's `orphaned` wording, never a false `host-died`. See
   *  docs/specs/_built/registry-lifecycle/spec.md. */
  bootId?: string;
  /** Set only when `status` is `"failed-start"`: the last lines of
   *  `worker.log` — the worker process's own captured stderr — so the
   *  failure self-documents without a foreground reproduction. */
  startFailureDetail?: string;
}

// Small, extensible table of "this env var means we're running under harness
// X" signals, checked once at invocation time (`startCmd`/`runCmd`). First
// match in `process.env` wins. Growing this table (e.g. adding opencode's
// row once `verify-opencode-session-env` confirms a version floor) never
// needs a schema change — just another row.
export const SUPERVISOR_ENV_SIGNALS: Array<{ env: string; harness: string }> = [
  { env: "CLAUDE_CODE_SESSION_ID", harness: "claude-code" },
];

export interface SupervisorSignal {
  supervisorSessionID?: string;
  supervisorHarness?: string;
}

// No match degrades to both fields unset — same "nothing shown" philosophy
// as everywhere else this plugin reads optional external signals.
export function detectSupervisorSignal(
  env: Record<string, string | undefined> = process.env,
): SupervisorSignal {
  for (const { env: name, harness } of SUPERVISOR_ENV_SIGNALS) {
    const value = env[name];
    if (value) return { supervisorSessionID: value, supervisorHarness: harness };
  }
  return {};
}

export function projectRoot(cwd: string = process.cwd()): string {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

export function registryDir(root: string): string {
  return join(root, ".darkf", "registry");
}

export function entryPath(root: string, runId: string): string {
  return join(registryDir(root), `${runId}.json`);
}

export function journalPathFor(entry: RegistryEntry): string {
  return join(entry.rootDir, ".darkf", "run", entry.runId, "journal.jsonl");
}

// These three take `(rootDir, runId)` directly, not a `RegistryEntry` — the
// readiness-gating in `startCmd` needs them *before* any entry exists.
export function runArtifactsDir(rootDir: string, runId: string): string {
  return join(rootDir, ".darkf", "run", runId);
}

/** Written by the worker (`workerCmd`) once the workflow module has
 *  loaded — see docs/specs/_built/registry-lifecycle/spec.md. Its mere
 *  existence is the proof `start` waits for; contents are never read. */
export function readyPath(rootDir: string, runId: string): string {
  return join(runArtifactsDir(rootDir, runId), "ready");
}

/** The detached worker's own stderr, captured here instead of discarded —
 *  every startup failure self-documents without a foreground
 *  reproduction. */
export function workerLogPath(rootDir: string, runId: string): string {
  return join(runArtifactsDir(rootDir, runId), "worker.log");
}

/** `undefined` on a non-Linux host, or if the file can't be read — both
 *  degrade `hostDiedSince` to `false` (never a false `host-died`). */
export function currentBootId(): string | undefined {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return undefined;
  }
}

/** True only when the entry recorded a boot id AND the current host's own
 *  boot id is readable AND they differ — every other case (no `bootId` on
 *  the entry, non-Linux host) degrades to `false`, i.e. today's `orphaned`
 *  wording, never a guess. */
export function hostDiedSince(entry: RegistryEntry): boolean {
  if (entry.bootId === undefined) return false;
  const current = currentBootId();
  if (current === undefined) return false;
  return current !== entry.bootId;
}

// `process.kill(pid, 0)` never signals the target. It throws ESRCH only when
// no such process exists; any other throw (e.g. EPERM) means a process IS
// there, just unreachable — count that as alive. Verified against Bun.
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function writeEntry(root: string, entry: RegistryEntry): void {
  mkdirSync(registryDir(root), { recursive: true });
  writeFileSync(entryPath(root, entry.runId), `${JSON.stringify(entry, null, 2)}\n`);
}

function parseEntry(raw: string): RegistryEntry | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const e = obj as Record<string, unknown>;
  if (e.schemaVersion !== SCHEMA_VERSION) {
    console.warn(
      `darkf: skipping registry entry with unknown schemaVersion ${String(e.schemaVersion)}`,
    );
    return null;
  }
  if (typeof e.runId !== "string" || typeof e.pid !== "number" || typeof e.rootDir !== "string") {
    return null;
  }
  return e as unknown as RegistryEntry;
}

export function readEntry(root: string, runId: string): RegistryEntry | undefined {
  let raw: string;
  try {
    raw = readFileSync(entryPath(root, runId), "utf8");
  } catch {
    return undefined;
  }
  return parseEntry(raw) ?? undefined;
}

export function listEntries(root: string): RegistryEntry[] {
  let names: string[];
  try {
    names = readdirSync(registryDir(root));
  } catch {
    return [];
  }
  const entries: RegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(registryDir(root), name), "utf8");
    } catch {
      continue;
    }
    const entry = parseEntry(raw);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function readJournalText(journalPath: string): string {
  try {
    return readFileSync(journalPath, "utf8");
  } catch {
    return "";
  }
}

// The journal's authoritative terminal outcome, read from its last line only.
// A `DONE`-tagged `succeeded` last line means the run's end marker; a
// `FAILED`-tagged `failed` last line means `run_failure` routed the graph to
// its failure terminal; a `crashed` last line is the crashing leaf's own
// terminal emit. Anything else means the run had not reached a terminal state
// in the journal.
export type TerminalOutcome = "succeeded" | "failed" | "crashed";

export function journalTerminal(journalText: string): TerminalOutcome | undefined {
  const last = parseEventLog(journalText).at(-1);
  if (!last) return undefined;
  if (last.state === DONE && last.status.phase === "succeeded") return "succeeded";
  if (last.state === FAILED && last.status.phase === "failed") return "failed";
  if (last.status.phase === "crashed") return "crashed";
  return undefined;
}

export type RunResolution =
  | { kind: "none"; recentFinished?: RegistryEntry }
  | { kind: "noSuchRun" }
  | { kind: "ambiguous"; entries: RegistryEntry[] }
  | { kind: "terminal"; entry: RegistryEntry; outcome: TerminalOutcome; journalPath: string }
  | { kind: "orphaned"; entry: RegistryEntry; journalPath: string }
  | { kind: "resolved"; entry: RegistryEntry; journalPath: string };

function classifyResolved(entry: RegistryEntry): RunResolution {
  const journalPath = journalPathFor(entry);
  const outcome = journalTerminal(readJournalText(journalPath));
  if (outcome) return { kind: "terminal", entry, outcome, journalPath };
  if (isPidAlive(entry.pid)) return { kind: "resolved", entry, journalPath };
  return { kind: "orphaned", entry, journalPath };
}

function mostRecentFinished(entries: RegistryEntry[]): RegistryEntry | undefined {
  let best: RegistryEntry | undefined;
  let bestTime = -Infinity;
  for (const e of entries) {
    if (e.status === "running") continue;
    const t = e.finishedAt ?? e.startedAt;
    if (t > bestTime) {
      bestTime = t;
      best = e;
    }
  }
  return best;
}

// The 9-case "which run" resolution shared by `status` and `monitor`. `root` is
// the project root (see projectRoot), `runId` the `--run` value when given.
export function resolveRun(root: string, runId?: string): RunResolution {
  const entries = listEntries(root);

  if (runId !== undefined) {
    const entry = entries.find((e) => e.runId === runId);
    if (!entry) return { kind: "noSuchRun" };
    return classifyResolved(entry);
  }

  if (entries.length === 0) return { kind: "none" };

  const running = entries.filter((e) => e.status === "running");
  if (running.length === 0) return { kind: "none", recentFinished: mostRecentFinished(entries) };

  const live = running.filter((e) => isPidAlive(e.pid));
  if (live.length >= 2) return { kind: "ambiguous", entries: live };
  if (live.length === 1) {
    for (const other of running) {
      if (other.runId === live[0]!.runId) continue;
      console.warn(
        `darkf: run ${other.runId} (${other.rootDir}) is cached "running" but its PID ${other.pid} is gone`,
      );
    }
    return classifyResolved(live[0]!);
  }

  // Every cached-"running" entry is dead. One of them is unambiguous; several
  // still are, so refuse to guess and require --run.
  if (running.length === 1) return classifyResolved(running[0]!);
  return { kind: "ambiguous", entries: running };
}
