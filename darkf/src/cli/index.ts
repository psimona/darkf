#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AgentRunner,
  buildRegistry,
  DONE,
  type NodeEvent,
  type NodeResult,
  parseEventLog,
  renderActive,
  renderMermaid,
  type ScriptRunner,
  validateWorkflow,
  type WorkflowDef,
  type WorkflowValidationError,
} from "../core/index.ts";
import { run } from "../engine/index.ts";
import {
  currentBootId,
  detectSupervisorSignal,
  hostDiedSince,
  isPidAlive,
  journalPathFor,
  projectRoot,
  type RegistryEntry,
  type RegistryStatus,
  readEntry,
  readJournalText,
  readyPath,
  resolveRun,
  runArtifactsDir,
  SCHEMA_VERSION,
  workerLogPath,
  writeEntry,
} from "../kit/registry.ts";
import {
  AGENT_STALL_MS,
  agentStallWarning,
  classifyTerminal,
  foldJournal,
  foldReport,
  nudgeWarning,
  stallWarning,
  type TerminalState,
} from "../kit/status.ts";

const INDEX_PATH = fileURLToPath(import.meta.url);
// Fixed, not yet measured against a cold `bun` import on real hosts — see
// docs/specs/_built/registry-lifecycle/spec.md's open questions.
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 100;
const MONITOR_SUB_POLL_MS = 500;
const DEFAULT_MONITOR_WINDOW_S = 30;
const MESSAGE_MAX_LEN = 2048;
const WORKER_LOG_TAIL_CHARS = 2000;

interface WorkflowModule {
  workflow: WorkflowDef;
  input?: NodeResult;
  agentRunner?: AgentRunner;
  /** Opt-in override for run-aware script dispatch — e.g. a script needing
   *  `.darkf/run/<runId>/...` for its own artifacts (see DispatchInfo's own
   *  docs in darkf-core). Omitted: falls back to darkf-engine's default,
   *  which only ever passes a script's default export the plain `handoff`. */
  scriptRunner?: ScriptRunner;
}

async function loadWorkflow(dir: string): Promise<WorkflowModule> {
  const url = pathToFileURL(resolve(dir, "workflow.ts")).href;
  const mod = await import(url);
  return mod as WorkflowModule;
}

/**
 * Workflow reference resolution. A ref with a path separator (or an existing
 * relative path) is a filesystem path. A bare name is looked up in:
 *   1. `<cwd>/darkf/<name>`           — project workspace
 *   2. `<darkf>/workflows/<name>` — shipped with darkf
 * A candidate counts only if it contains a workflow.ts.
 *
 * `<cwd>/.darkf/workflows/<name>` was the original location and is no
 * longer resolved at all (see docs/specs/_built/registry-lifecycle/spec.md):
 * `.darkf/` is darkf's own runtime/run-storage directory, meant to be
 * gitignored wholesale, which was never possible while committed workflow
 * config lived inside it too.
 */
function selfRoot(): string {
  // src/cli/index.ts → the package root (where examples/ and workflows/ live).
  return resolve(dirname(INDEX_PATH), "..", "..");
}

function workflowCandidates(ref: string): string[] {
  if (ref.includes("/") || ref.includes("\\") || ref === "." || ref === "..") return [resolve(ref)];
  // Back-compat: a bare name that names a dir relative to cwd stays a path
  // (the pre-resolution behavior). Otherwise it is a workflow reference:
  // project workspace first, then workflows shipped with darkf.
  return [
    resolve(ref),
    resolve(process.cwd(), "darkf", ref),
    resolve(selfRoot(), "workflows", ref),
  ];
}

function resolveWorkflowDir(ref: string): string {
  const candidates = workflowCandidates(ref);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "workflow.ts"))) return candidate;
  }
  const available = listWorkflows()
    .map((w) => `${w.name} (${w.source})`)
    .join(", ");
  console.error(`no workflow for '${ref}' — tried:`);
  for (const candidate of candidates) console.error(`  ${candidate}`);
  console.error(
    `available: ${available || "(none)"} — or pass a path to a dir containing workflow.ts`,
  );
  process.exit(1);
}

interface WorkflowListing {
  name: string;
  source: "workspace" | "built-in";
}

function listWorkflows(): WorkflowListing[] {
  const roots: Array<[string, WorkflowListing["source"]]> = [
    [resolve(process.cwd(), "darkf"), "workspace"],
    [resolve(selfRoot(), "workflows"), "built-in"],
  ];
  const out: WorkflowListing[] = [];
  for (const [root, source] of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (existsSync(join(root, entry, "workflow.ts"))) out.push({ name: entry, source });
    }
  }
  return out;
}

async function reportCmd(args: string[]): Promise<void> {
  const { runId } = parseFlags(args);
  const res = resolveRun(projectRoot(), runId);
  // Report works on ANY resolvable run — finished runs (terminal/orphaned)
  // are the primary subject, not an error.
  const entry = "entry" in res && res.entry ? res.entry : undefined;
  const journalPath = "journalPath" in res ? res.journalPath : undefined;
  if (!entry || !journalPath) {
    console.error(`no run for '${runId ?? "(latest)"}' (${res.kind})`);
    process.exit(1);
  }
  const journalText = readJournalText(journalPath);
  if (!journalText) {
    console.error("journal is empty or missing");
    process.exit(1);
  }
  const report = foldReport(journalText);
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  console.log(`run: ${entry.runId}`);
  console.log(`message: ${entry.message ?? "(none)"}`);
  console.log(`span: ${seconds(report.spanMs)}, ${report.dispatches.length} dispatches`);
  const visits = Object.entries(report.visits);
  if (visits.length) console.log(`visits: ${JSON.stringify(Object.fromEntries(visits))}`);

  console.log("\ndispatches:");
  for (const d of report.dispatches) {
    const outcome =
      d.phase === "succeeded"
        ? `-> ${d.event ?? "(no event)"}`
        : d.phase === "failed"
          ? `-> FAILED${d.event ? ` ${d.event}` : ""}`
          : `-> CRASHED ${d.reason ? JSON.stringify(d.reason) : ""}`;
    console.log(`  ${d.state.padEnd(12)} ${seconds(d.durationMs).padStart(9)}  ${outcome}`);
  }
  if (report.crashReasons.length) {
    console.log(`crashes: ${report.crashReasons.length}`);
    for (const r of new Set(report.crashReasons)) console.log(`  ${r}`);
  }

  const usage = await readUsageSummary(entry.rootDir, entry.runId);
  if (usage) console.log(usage);
}

async function readUsageSummary(rootDir: string, runId: string): Promise<string | null> {
  const dir = join(rootDir, ".darkf", "run", runId, "usage");
  if (!existsSync(dir)) return null;
  let cost = 0;
  let hasCost = false;
  let input = 0,
    cacheRead = 0,
    cacheCreation = 0,
    output = 0,
    count = 0;
  for (const file of readdirSync(dir)) {
    try {
      const u = JSON.parse(readFileSync(join(dir, file), "utf8"));
      count += 1;
      if (typeof u.costUsd === "number") {
        cost += u.costUsd;
        hasCost = true;
      }
      input += u.inputTokens ?? 0;
      cacheRead += u.cacheReadTokens ?? 0;
      cacheCreation += u.cacheCreationTokens ?? 0;
      output += u.outputTokens ?? 0;
    } catch {
      /* skip unreadable sidecars */
    }
  }
  if (count === 0) return null;
  const costPart = hasCost ? ` $${cost.toFixed(2)},` : "";
  return `usage (${count} agent dispatches):${costPart} ${input + cacheRead + cacheCreation} in (${cacheRead} cache-read, ${cacheCreation} cache-write), ${output} out`;
}

function describeValidationError(err: WorkflowValidationError): string {
  switch (err.kind) {
    case "unresolved-target":
      return `${err.from ?? "<top-level initial>"} -> "${err.target}": no such state`;
    case "initial-cycle":
      return `initial cycle: ${err.cycle.join(" -> ")} -> ${err.cycle[0]}`;
    case "dead-end-leaf":
      return `"${err.state}": dead end, no on/next`;
  }
}

async function doctorCmd(args: string[]): Promise<number> {
  const ref = args[0];
  let fail = false;
  const check = (label: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) fail = true;
  };

  // 1. workflow resolution
  if (ref === undefined) {
    check("workflow ref", false, "usage: darkf doctor <workflow-ref-or-path>");
    return Promise.resolve(1);
  }
  const candidates = workflowCandidates(ref);
  let resolved: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "workflow.ts"))) {
      resolved = candidate;
      break;
    }
  }
  check("workflow resolves", resolved !== null, resolved ?? candidates.join(", "));

  // 2. module loads + exports
  if (resolved) {
    try {
      const mod = await loadWorkflow(resolved);
      check("workflow.ts loads", true);
      check(
        "exports `workflow`",
        typeof mod.workflow?.states === "object" && typeof mod.workflow?.initial === "string",
      );
      check(
        "exports `agentRunner`",
        typeof mod.agentRunner?.run === "function",
        "agent states need a runner; built-ins live in src/agents/",
      );
      if (typeof mod.workflow?.states === "object" && typeof mod.workflow?.initial === "string") {
        try {
          const registry = buildRegistry(mod.workflow);
          const errors = validateWorkflow(registry, mod.workflow.initial);
          if (errors.length === 0) {
            check("workflow structure", true);
          } else {
            for (const err of errors) {
              check("workflow structure", false, describeValidationError(err));
            }
          }
        } catch (err) {
          check("workflow structure", false, err instanceof Error ? err.message : String(err));
        }
      } else {
        check("workflow structure", false, "skipped — invalid or missing `workflow` export");
      }
    } catch (err) {
      check("workflow.ts loads", false, err instanceof Error ? err.message : String(err));
      check("exports `workflow`", false, "skipped — module failed to load");
      check("exports `agentRunner`", false, "skipped — module failed to load");
      check("workflow structure", false, "skipped — module failed to load");
    }
  } else {
    check("workflow.ts loads", false, "skipped — no resolved workflow");
    check("exports `workflow`", false, "skipped — no resolved workflow");
    check("exports `agentRunner`", false, "skipped — no resolved workflow");
  }

  // 3. agent binaries
  for (const bin of ["claude", "opencode"]) {
    check(`agent binary '${bin}'`, Bun.which(bin) !== null);
  }

  // 4. cwd sanity — the run-1 mistake: targeting a repo while sitting in the darkf checkout
  const cwd = process.cwd();
  const insideSelf = cwd.startsWith(selfRoot());
  check(
    "cwd is not inside the darkf checkout",
    !insideSelf,
    insideSelf ? `${cwd} is inside ${selfRoot()} — agent cwd follows rootDir (= this cwd)` : cwd,
  );
  const gitRoot = projectRoot();
  check("cwd is inside a git repo", existsSync(join(gitRoot, ".git")), gitRoot);

  return Promise.resolve(fail ? 1 : 0);
}

function workflowsCmd(): void {
  const workflows = listWorkflows();
  if (workflows.length === 0) {
    console.log(
      "no workflows found — add <repo>/darkf/<name>/workflow.ts or darkf/workflows/<name>/workflow.ts",
    );
    return;
  }
  for (const w of workflows) console.log(`${w.name.padEnd(24)} ${w.source}`);
}

async function renderCmd(dir: string): Promise<void> {
  const { workflow } = await loadWorkflow(dir);
  console.log(renderMermaid(workflow));
}

// The one arg parser `run` and `start` share so the two can't drift: a `<dir>`
// and an optional `[message]`. A given `message` overrides the workflow
// module's own `input` export; omitted, the module's `input` (or `{}`) is used.
function parseRunArgs(args: string[]): {
  dir: string;
  message?: string;
  allowDirtyWorkflow: boolean;
} {
  const allowDirtyWorkflow = args.includes("--allow-dirty-workflow");
  const positional = args.filter((a) => a !== "--allow-dirty-workflow");
  return { dir: positional[0] ?? ".", message: positional[1], allowDirtyWorkflow };
}

// Start-time config guard (registry-lifecycle, lesson-2 companion): a
// workflow config edit left uncommitted *will* be swept into a run commit or
// reset away by the run itself — a consumer repo lost config edits both ways.
// Scoped to the bare `darkf/` directory — the user/consumer-repo convention
// for versioned workflow config — never `.darkf` (dot-prefixed), which is
// darkf's own runtime/run-storage directory (registry, journals, this very
// `ready`/`worker.log` pair) and is expected to be gitignored entirely, not
// checked for "config drift."
// Fails OPEN (returns null) on anything that isn't a clean, unambiguous
// "yes, these files are dirty": not a git repo, git not installed, or no
// `darkf/` directory at all — never blocks a run over something this check
// can't actually verify.
function dirtyWorkflowConfigFiles(rootDir: string): string[] | null {
  if (!existsSync(join(rootDir, "darkf"))) return null;
  let out: { exitCode: number; stdout: Buffer };
  try {
    out = Bun.spawnSync(["git", "status", "--porcelain", "--", "darkf"], {
      cwd: rootDir,
    });
  } catch {
    return null;
  }
  if (out.exitCode !== 0) return null;
  const text = new TextDecoder().decode(out.stdout).trim();
  return text.length > 0 ? text.split("\n") : null;
}

function inputFor(
  message: string | undefined,
  moduleInput: NodeResult | undefined,
): NodeResult | undefined {
  return message !== undefined ? { output: { message } } : moduleInput;
}

async function runCmd(dir: string, message?: string): Promise<void> {
  const { workflow, input, agentRunner, scriptRunner } = await loadWorkflow(dir);

  // Pre-generated (rather than left to `run()`'s own default) and written to
  // the registry *before* dispatch starts, mirroring `startCmd`'s own
  // sequencing — this is the blocking-run path's equivalent of a detached
  // run's worker entry, so a live run started via `darkf run` is just as
  // discoverable (e.g. by a visualizer) as one started via `darkf start`,
  // not only visible after the fact via the final `journal:` line below.
  const runId = randomUUID();
  const root = projectRoot();
  const rootDir = process.cwd();
  writeEntry(root, {
    schemaVersion: SCHEMA_VERSION,
    runId,
    pid: process.pid,
    rootDir,
    workflowDir: dir,
    startedAt: Date.now(),
    message: message !== undefined ? truncateMessage(message) : undefined,
    status: "running",
    finishedAt: null,
    agentRunnerKind: agentRunner?.kind,
    ...detectSupervisorSignal(),
  });

  const result = await run({
    workflow,
    input: inputFor(message, input),
    agentRunner,
    scriptRunner,
    baseDir: resolve(dir, "scripts"),
    // Run artifacts live under the invocation cwd (RunOptions' documented
    // default), NOT the workflow dir — repo-targeting workflows are invoked
    // from their target repo, and agent runners use rootDir as their cwd.
    rootDir,
    runId,
  });

  const finalStatus: RegistryStatus =
    result.node.phase === "succeeded"
      ? "succeeded"
      : result.node.phase === "failed"
        ? "failed"
        : "crashed";
  try {
    const entry = readEntry(root, runId);
    if (entry) writeEntry(root, { ...entry, status: finalStatus, finishedAt: Date.now() });
  } catch {
    // best-effort, same as workerCmd — the journal already records the outcome
  }

  for (const step of result.trace) {
    const scope = step.scopePath.length ? `${step.scopePath.join(">")} > ` : "";
    console.log(`${scope}${step.state} -> event=${step.result.event ?? "(none)"}`);
  }

  console.log(`\nstatus: ${result.node.phase}`);
  if (result.node.phase === "crashed") {
    console.log(`reason: ${JSON.stringify(result.node.reason)} (attempt ${result.node.attempt})`);
  }
  if (result.node.phase === "succeeded" || result.node.phase === "failed") {
    console.log("output:", result.node.result.output);
  }
  console.log(`journal: ${resolve(dir, ".darkf", "run", result.runId, "journal.jsonl")}`);

  const lastState = result.trace.at(-1)?.state;
  if (lastState) {
    await mkdir(`${dir}/.darkf`, { recursive: true });
    await writeFile(`${dir}/.darkf/last-run.mmd`, renderActive(workflow, lastState));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncateMessage(message: string): string {
  return message.length > MESSAGE_MAX_LEN ? message.slice(0, MESSAGE_MAX_LEN) : message;
}

async function startCmd(
  dir: string,
  message?: string,
  allowDirtyWorkflow = false,
): Promise<number> {
  const rootDir = process.cwd();
  const root = projectRoot();

  if (!allowDirtyWorkflow) {
    const dirty = dirtyWorkflowConfigFiles(rootDir);
    if (dirty) {
      console.error(
        `darkf start: darkf/ has uncommitted changes — a run can sweep them into a ` +
          `commit or reset them away:\n${dirty.map((f) => `  ${f}`).join("\n")}\n` +
          `Commit or stash first, or pass --allow-dirty-workflow to proceed anyway.`,
      );
      return 1;
    }
  }

  const runId = randomUUID();
  const startedAt = Date.now();
  const bootId = currentBootId();

  await mkdir(runArtifactsDir(rootDir, runId), { recursive: true });
  const workerLogFd = openSync(workerLogPath(rootDir, runId), "w");

  const workerArgs = [INDEX_PATH, "__worker", dir, runId];
  if (message !== undefined) workerArgs.push(message);
  const child = Bun.spawn([process.execPath, ...workerArgs], {
    detached: true,
    // stdout stays discarded (never the failure signal this guards
    // against); stderr goes to worker.log instead of `ignore` — see
    // docs/specs/_built/registry-lifecycle/spec.md.
    stdio: ["ignore", "ignore", workerLogFd],
  });
  closeSync(workerLogFd); // the child keeps its own fd; the parent's copy is done
  child.unref();
  const pid = child.pid;

  // Wait for positive evidence the workflow module actually loaded (the
  // `ready` file `workerCmd` writes), not just "the pid still exists at some
  // arbitrary moment" — a live pid at +250ms proved nothing about whether the
  // module import had even finished, let alone succeeded.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  for (;;) {
    if (existsSync(readyPath(rootDir, runId))) {
      ready = true;
      break;
    }
    if (!isPidAlive(pid)) break; // died before ever signaling ready
    if (Date.now() >= deadline) break; // timed out — still alive, see below
    await sleep(READY_POLL_MS);
  }

  if (!ready && !isPidAlive(pid)) {
    // Confirmed dead before ever loading the workflow module — the one
    // case `failed-start` exists for. No fake "running" identity printed.
    const tail = readFileSync(workerLogPath(rootDir, runId), "utf8")
      .trim()
      .slice(-WORKER_LOG_TAIL_CHARS);
    console.error(
      `darkf start: worker (pid ${pid}) exited during startup, before loading the workflow:\n${tail}`,
    );
    writeEntry(root, {
      schemaVersion: SCHEMA_VERSION,
      runId,
      pid,
      rootDir,
      workflowDir: dir,
      startedAt,
      message: message !== undefined ? truncateMessage(message) : undefined,
      status: "failed-start",
      finishedAt: Date.now(),
      startFailureDetail: tail,
      bootId,
      ...detectSupervisorSignal(),
    });
    return 1;
  }

  if (!ready) {
    // Timed out but still alive: a slow module import, not a failure. Proceed
    // optimistically — the alternative (killing a live, legitimately-working
    // process) is worse than occasionally missing a slow-but-real success
    // within this window. See spec's open question on the timeout value.
    console.error(
      `darkf start: worker (pid ${pid}) had not signaled ready after ${READY_TIMEOUT_MS}ms but is still alive; proceeding`,
    );
  }

  // `agentRunnerKind` isn't known here — this process never loads the
  // workflow module, only spawns the worker that does — so `workerCmd`
  // merges it in once it has (see there).
  writeEntry(root, {
    schemaVersion: SCHEMA_VERSION,
    runId,
    pid,
    rootDir,
    workflowDir: dir,
    startedAt,
    message: message !== undefined ? truncateMessage(message) : undefined,
    status: "running",
    finishedAt: null,
    bootId,
    ...detectSupervisorSignal(),
  });

  console.log(JSON.stringify({ runId, pid }));
  return 0;
}

// The detached worker: the process that actually calls run(), then best-effort
// updates the registry. Its own exit code is not the point — the journal is the
// one durable record — so a registry-update failure is swallowed, not fatal.
async function workerCmd(dir: string, runId: string, message?: string): Promise<void> {
  const rootDir = process.cwd();
  const { workflow, input, agentRunner, scriptRunner } = await loadWorkflow(dir);

  // The one piece of positive evidence `startCmd`'s readiness wait is
  // watching for — written only once the workflow module has actually
  // loaded (if `loadWorkflow` above throws, this line never runs, and
  // `startCmd` reports `failed-start` instead of a fake `running`).
  await mkdir(runArtifactsDir(rootDir, runId), { recursive: true });
  await writeFile(readyPath(rootDir, runId), "");

  // `startCmd` wrote the entry before this worker loaded the workflow module,
  // so it couldn't know the runner's `kind` yet — merge it in now, best-effort
  // like every other registry update here (the journal stays authoritative).
  if (agentRunner?.kind !== undefined) {
    try {
      const entry = readEntry(projectRoot(), runId);
      if (entry) writeEntry(projectRoot(), { ...entry, agentRunnerKind: agentRunner.kind });
    } catch {
      // best-effort, same as the final status update below
    }
  }

  const result = await run({
    workflow,
    input: inputFor(message, input),
    agentRunner,
    scriptRunner,
    baseDir: resolve(dir, "scripts"),
    rootDir,
    runId,
  });

  const status: RegistryStatus =
    result.node.phase === "succeeded"
      ? "succeeded"
      : result.node.phase === "failed"
        ? "failed"
        : "crashed";
  try {
    const entry = readEntry(projectRoot(), runId);
    if (entry) writeEntry(projectRoot(), { ...entry, status, finishedAt: Date.now() });
  } catch {
    // best-effort: the journal already records the outcome; never fatal here
  }
}

function parseFlags(args: string[]): { runId?: string; window?: number; once?: boolean } {
  let runId: string | undefined;
  let window: number | undefined;
  let once = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--run") runId = args[++i];
    else if (arg === "--window") window = Number(args[++i]);
    else if (arg === "--once") once = true;
  }
  return { runId, window, once };
}

function statusExit(state: TerminalState): number {
  switch (state) {
    case "succeeded":
      return 0;
    case "crashed":
      return 1;
    case "orphaned":
      return 2;
    case "running":
      return 3;
    case "failed":
      return 4;
    case "host-died":
      return 5;
    case "failed-start":
      return 6;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function printDigest(entry: RegistryEntry, state: TerminalState, journalText: string): void {
  const digest = foldJournal(journalText);
  console.log(`run: ${entry.runId}`);
  console.log(`root: ${entry.rootDir}`);
  if (entry.message) console.log(`message: ${entry.message}`);
  console.log(`state: ${state}`);
  if (digest.current) {
    console.log(`current node: ${digest.current.state} (${digest.current.phase})`);
  }
  if (digest.crash) {
    console.log(
      `crash: attempt=${digest.crash.attempt} reason=${JSON.stringify(digest.crash.reason)}`,
    );
  }
  if (Object.keys(digest.visits).length > 0) {
    console.log(`visits: ${JSON.stringify(digest.visits)}`);
    const [node, count] = Object.entries(digest.visits).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (count !== undefined && count >= 4) {
      console.log(
        `warn: ${node} visited ${count}x — possible review/thrash cycling (check the journal, or wrap the loop in a composite with maxCycles)`,
      );
    }
  }
  if (digest.current?.phase === "running" && digest.current.startedAt !== undefined) {
    // Live elapsed, computed at print time — journal-frozen runtime goes stale
    // during long nodes (spec: docs/specs/live-runtime).
    console.log(
      `elapsed: ${formatMs(Date.now() - digest.current.startedAt)} (node ${digest.current.state})`,
    );
    const stall = stallWarning(digest);
    if (stall) console.log(`warn: ${stall}`);
    const agentStall = agentStallWarning(digest);
    if (agentStall) console.log(`warn: ${agentStall}`);
    const nudge = nudgeWarning(digest);
    if (nudge) console.log(`warn: ${nudge}`);
  }
  if (digest.runtimeMs !== null) console.log(`runtime: ${formatMs(digest.runtimeMs)}`);
  if (state === "orphaned") console.log("orphaned: true");
  if (state === "host-died") {
    const lastTs = parseEventLog(journalText).at(-1)?.timestamp;
    const since =
      lastTs !== undefined ? ` (last journal event ${new Date(lastTs).toISOString()})` : "";
    console.log(`host-died: true${since}`);
  }
  if (state === "failed-start") {
    console.log("failed-start: true");
    if (entry.startFailureDetail) console.log(`worker log tail:\n${entry.startFailureDetail}`);
  }
}

async function statusCmd(args: string[]): Promise<number> {
  const { runId } = parseFlags(args);
  const res = resolveRun(projectRoot(), runId);

  switch (res.kind) {
    case "none":
      console.log(
        res.recentFinished
          ? `nothing to monitor (most recent finished run: ${res.recentFinished.runId})`
          : "nothing to monitor",
      );
      return 7;
    case "noSuchRun":
      console.error(`no such run: ${runId}`);
      return 4;
    case "ambiguous": {
      console.error(`ambiguous: multiple runs are cached "running"; use --run <runId>`);
      for (const e of res.entries) console.error(`  ${e.runId}  ${e.rootDir}`);
      return 5;
    }
    default: {
      const journalText = readJournalText(res.journalPath);
      const state = classifyTerminal(journalText, isPidAlive(res.entry.pid), {
        cachedStatus: res.entry.status,
        hostDied: hostDiedSince(res.entry),
      });
      printDigest(res.entry, state, journalText);
      return statusExit(state);
    }
  }
}

function printTransition(e: NodeEvent, prevTs: number | null, isHeartbeat = false): void {
  const dwell = prevTs !== null ? ` (dwell ${e.timestamp - prevTs}ms)` : "";
  const status = e.status;
  if (isHeartbeat) {
    // A heartbeat is a liveness pulse on an open dispatch, not a transition —
    // one compact line, or it drowns the monitor every 30s.
    const startedAt = status.phase === "running" ? status.startedAt : undefined;
    const idle = startedAt !== undefined ? e.timestamp - startedAt : 0;
    let line = `${e.state} still running — ${(idle / 1000).toFixed(0)}s elapsed`;
    // Agent-level liveness, distinct from the engine-heartbeat idle above —
    // see docs/specs/agent-liveness/spec.md. Absent for script dispatches or
    // runners that don't report progress.
    if (status.phase === "running" && status.agentIdleMs !== undefined) {
      const agentIdleSec = Math.round(status.agentIdleMs / 1000);
      line += `, agent step ${status.agentStepCount ?? 0}, idle ${agentIdleSec}s`;
      if (status.agentIdleMs > AGENT_STALL_MS) line += " — warn: agent stall suspected";
    }
    console.log(line);
    return;
  }
  let line = `${e.state} ${status.phase}`;
  if (status.phase === "running") line += ` attempt=${status.attempt}`;
  else if (status.phase === "succeeded" && status.result?.event)
    line += ` event=${status.result.event}`;
  console.log(`${line}${dwell}`);
}

/** A `running` event whose dispatch is already open is a heartbeat, not a
 *  transition: same state+attempt seen running in the previous event window. */
function isHeartbeatEvent(events: NodeEvent[], index: number): boolean {
  const e = events[index]!;
  if (e.state === DONE || e.status.phase !== "running") return false;
  for (let i = index - 1; i >= 0; i--) {
    const prev = events[i]!;
    if (
      prev.state === e.state &&
      (prev.scopePath ?? []).join(">") === (e.scopePath ?? []).join(">")
    ) {
      return prev.status.phase === "running" && prev.status.attempt === e.status.attempt;
    }
  }
  return false;
}

// Dwell hint (P2): flag an open dispatch whose elapsed time exceeds 3× the
// median of that node's completed visits (floor 2 min) — the supervisor's
// cue to inspect or `steer`, printed once per visit. An unattended run: a
// GREEN agent thrashed for 35 minutes before anyone looked; a hint at
// minute 10 would have surfaced it. Purely advisory — never exits.
function dwellHint(events: NodeEvent[], runId: string, hinted: Set<string>): void {
  const durations: Record<string, number[]> = {};
  let open: { state: string; startedAt: number } | null = null;
  for (const e of events) {
    if (e.state === DONE) continue;
    const phase = e.status.phase;
    if (phase === "running") {
      if (open === null || open.state !== e.state) {
        open = { state: e.state, startedAt: e.status.startedAt ?? e.timestamp };
      }
      continue;
    }
    if ((phase === "succeeded" || phase === "crashed") && open && open.state === e.state) {
      durations[e.state] ??= [];
      durations[e.state]!.push(Math.max(0, e.timestamp - open.startedAt));
      open = null;
    }
  }
  if (!open) return;
  const ds = durations[open.state] ?? [];
  if (ds.length === 0) return;
  const sorted = [...ds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const dwell = Date.now() - open.startedAt;
  const threshold = Math.max(median * 3, 120_000);
  const key = `${open.state}:${open.startedAt}`;
  if (dwell > threshold && !hinted.has(key)) {
    hinted.add(key);
    const mins = (ms: number) => Math.round(ms / 60_000);
    console.log(
      `hint: ${open.state} running ${mins(dwell)}m (median ${mins(median)}m) — inspect with darkf recent/status, or nudge: darkf steer ${runId} "<message>"`,
    );
  }
}

async function monitorRun(entry: RegistryEntry, windowSec: number, once: boolean): Promise<number> {
  const journalPath = journalPathFor(entry);
  const pid = entry.pid;
  const deadline = Date.now() + windowSec * 1000;
  const hinted = new Set<string>();

  // Open the window: if the begin marker is already there, print it once as
  // context (not a transition) and tail only lines added from this point on.
  let text = readJournalText(journalPath);
  let events = parseEventLog(text);
  const begin = events[0];
  if (begin && begin.state === DONE && begin.status.phase === "succeeded") {
    console.log(`started with: ${JSON.stringify(begin.status.result)}`);
  }
  let lastSeen = events.length;
  let lastTs = events.at(-1)?.timestamp ?? null;

  for (;;) {
    text = readJournalText(journalPath);
    events = parseEventLog(text);
    for (let i = lastSeen; i < events.length; i++) {
      const e = events[i]!;
      printTransition(e, lastTs, isHeartbeatEvent(events, i));
      lastTs = e.timestamp;
    }
    lastSeen = events.length;
    dwellHint(events, entry.runId, hinted);

    // Re-check liveness every sub-poll: the journal's last line is authoritative
    // for succeeded/crashed, and a dead PID with no terminal marker is
    // orphaned/host-died.
    const state = classifyTerminal(text, isPidAlive(pid), {
      cachedStatus: entry.status,
      hostDied: hostDiedSince(entry),
    });
    if (state === "succeeded") {
      console.log("succeeded");
      return 0;
    }
    if (state === "failed") {
      const digest = foldJournal(text);
      console.log(
        `failed: ${digest.finalResult ? JSON.stringify(digest.finalResult) : "(no result)"}`,
      );
      return 3;
    }
    if (state === "crashed") {
      const digest = foldJournal(text);
      console.log(`crashed: ${digest.crash ? JSON.stringify(digest.crash.reason) : "(no reason)"}`);
      return 1;
    }
    if (state === "host-died") {
      const lastTs = parseEventLog(text).at(-1)?.timestamp;
      const since =
        lastTs !== undefined ? ` (last journal event ${new Date(lastTs).toISOString()})` : "";
      console.log(`host-died: true${since}`);
      return 4;
    }
    if (state === "failed-start") {
      console.log("failed-start: true");
      if (entry.startFailureDetail) console.log(`worker log tail:\n${entry.startFailureDetail}`);
      return 5;
    }
    if (state === "orphaned") {
      console.log("orphaned: worker PID is gone and the journal has no terminal marker");
      return 2;
    }

    if (Date.now() >= deadline) {
      console.log(`window of ${windowSec}s elapsed, still running`);
      return 6;
    }
    if (once) {
      console.log("still running");
      return 6;
    }
    await sleep(MONITOR_SUB_POLL_MS);
  }
}

async function monitorCmd(args: string[]): Promise<number> {
  const { runId, window, once } = parseFlags(args);
  const windowSec = window ?? DEFAULT_MONITOR_WINDOW_S;
  const res = resolveRun(projectRoot(), runId);

  switch (res.kind) {
    case "none":
      console.log("nothing to monitor");
      return 7;
    case "noSuchRun":
      console.error(`no such run: ${runId}`);
      return 4;
    case "ambiguous": {
      console.error(`ambiguous: multiple runs are cached "running"; use --run <runId>`);
      for (const e of res.entries) console.error(`  ${e.runId}  ${e.rootDir}`);
      return 5;
    }
    case "terminal": {
      const digest = foldJournal(readJournalText(res.journalPath));
      if (res.outcome === "succeeded") {
        console.log("succeeded");
        return 0;
      }
      if (res.outcome === "failed") {
        console.log(
          `failed: ${digest.finalResult ? JSON.stringify(digest.finalResult) : "(no result)"}`,
        );
        return 3;
      }
      console.log(`crashed: ${digest.crash ? JSON.stringify(digest.crash.reason) : "(no reason)"}`);
      return 1;
    }
    case "orphaned": {
      const journalText = readJournalText(res.journalPath);
      const state = classifyTerminal(journalText, false, {
        cachedStatus: res.entry.status,
        hostDied: hostDiedSince(res.entry),
      });
      if (state === "host-died") {
        const lastTs = parseEventLog(journalText).at(-1)?.timestamp;
        const since =
          lastTs !== undefined ? ` (last journal event ${new Date(lastTs).toISOString()})` : "";
        console.log(`host-died: true${since}`);
        return 4;
      }
      if (state === "failed-start") {
        console.log("failed-start: true");
        if (res.entry.startFailureDetail) {
          console.log(`worker log tail:\n${res.entry.startFailureDetail}`);
        }
        return 5;
      }
      console.log("orphaned: worker PID is gone and the journal has no terminal marker");
      return 2;
    }
    case "resolved":
      return await monitorRun(res.entry, windowSec, once ?? false);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "workflows") {
    workflowsCmd();
    return;
  }
  if (cmd === "report") {
    await reportCmd(rest);
    return;
  }
  if (cmd === "doctor") {
    process.exit(await doctorCmd(rest));
    return;
  }
  if (cmd === "render") {
    await renderCmd(resolveWorkflowDir(rest[0] ?? "."));
    return;
  }
  if (cmd === "run") {
    const { dir, message } = parseRunArgs(rest);
    await runCmd(resolveWorkflowDir(dir), message);
    return;
  }
  if (cmd === "start") {
    const { dir, message, allowDirtyWorkflow } = parseRunArgs(rest);
    process.exit(await startCmd(resolveWorkflowDir(dir), message, allowDirtyWorkflow));
    return;
  }
  if (cmd === "status") {
    process.exit(await statusCmd(rest));
    return;
  }
  if (cmd === "monitor") {
    process.exit(await monitorCmd(rest));
    return;
  }
  if (cmd === "__worker") {
    await workerCmd(rest[0] ?? ".", rest[1] ?? "", rest[2]);
    return;
  }
  // back-compat: `darkf <dir>` defaults to run
  await runCmd(resolveWorkflowDir(cmd ?? "."), undefined);
}

main();
