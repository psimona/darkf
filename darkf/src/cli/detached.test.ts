import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEventLog } from "../core/index.ts";
import {
  isPidAlive,
  journalPathFor,
  journalTerminal,
  listEntries,
  readEntry,
  readJournalText,
  SCHEMA_VERSION,
  writeEntry,
} from "../kit/registry.ts";

// --- paths (the CLI entry is spawned as a subprocess; never imported here) ---
const pkgDir = resolve(import.meta.dir, "..", "..");
const repoRoot = resolve(pkgDir, "..");
const indexTs = join(pkgDir, "src", "cli", "index.ts");
const haikuExample = join(pkgDir, "examples", "haiku-readme");

const roots: string[] = [];
const workerPids: number[] = [];
afterAll(() => {
  for (const pid of workerPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "darkf-cli-int-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "node_modules", "@psimona"), { recursive: true });
  symlinkSync(join(repoRoot, "darkf"), join(root, "node_modules", "@psimona", "darkf"));
  return root;
}

function writeFixture(root: string, name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, indexTs, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function startRun(root: string, dir: string): Promise<{ runId: string; pid: number }> {
  return runCli(["start", dir], root).then((res) => {
    expect(res.code, `start ${dir} should exit 0, got ${res.code}: ${res.stderr}`).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { runId: string; pid: number };
    workerPids.push(parsed.pid);
    return parsed;
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function journalLineCount(root: string, runId: string): number {
  const entry = readEntry(root, runId);
  if (!entry) return 0;
  return parseEventLog(readJournalText(journalPathFor(entry))).length;
}
function journalTerminalState(
  root: string,
  runId: string,
): "succeeded" | "failed" | "crashed" | undefined {
  const entry = readEntry(root, runId);
  if (!entry) return undefined;
  return journalTerminal(readJournalText(journalPathFor(entry)));
}
async function waitForTerminal(root: string, runId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const term = journalTerminalState(root, runId);
    if (term) return term;
    await sleep(50);
  }
  throw new Error(`run ${runId} did not reach a terminal state within ${timeoutMs}ms`);
}
async function waitFor(fn: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for: ${what}`);
}
function killWorker(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

// --- fixtures (all use a stub agentRunner / no LLM) ---
const SUCCEED: Record<string, string> = {
  "workflow.ts": `import { type AgentRunner, EXIT, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
export const agentRunner: AgentRunner = {
  async run(id) {
    if (id === "Plan") return { event: "approved" };
    return { event: "done" };
  },
};
export const workflow: WorkflowDef = {
  initial: "Plan",
  states: {
    Plan: { type: "agent", prompt: "plan", on: { approved: "Implement" } },
    Implement: {
      initial: "Write",
      states: {
        Write: { type: "script", file: "write.ts", next: "Test" },
        Test: { type: "script", file: "test.ts", on: { passed: "Review" } },
      },
    },
    Review: { type: "agent", prompt: "review", on: { done: EXIT } },
  },
};
`,
  "scripts/write.ts": `import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
export default async function write(): Promise<NodeResult> {
  await new Promise((r) => setTimeout(r, 600));
  return {};
}
`,
  "scripts/test.ts": `import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
export default function test(): NodeResult {
  return { event: "passed" };
}
`,
};
const CRASH: Record<string, string> = {
  "workflow.ts": `import { EXIT, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
export const workflow: WorkflowDef = {
  initial: "Warmup",
  states: {
    Warmup: { type: "script", file: "warmup.ts", next: "Boom" },
    Boom: { type: "script", file: "does-not-exist.ts", on: { ok: EXIT } },
  },
};
`,
  "scripts/warmup.ts": `import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
export default async function warmup(): Promise<NodeResult> {
  await new Promise((r) => setTimeout(r, 600));
  return {};
}
`,
};
const SLOW: Record<string, string> = {
  "workflow.ts": `import { EXIT, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
export const workflow: WorkflowDef = {
  initial: "S",
  states: { S: { type: "script", file: "sleep.ts", on: { ok: EXIT } } },
};
`,
  "scripts/sleep.ts": `import type { NodeResult } from "@psimona/darkf/src/core/index.ts";
export default async function sleep(): Promise<NodeResult> {
  await new Promise((r) => setTimeout(r, 4000));
  return { event: "ok", output: "woke" };
}
`,
};
const BROKEN: Record<string, string> = {
  "workflow.ts": `throw new Error("boom at module load");
export const workflow = null as never;
`,
};

// --- start ordering ---

test("start fails loudly (nonzero, no fake identity) when the worker crashes on startup", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "broken", BROKEN);

  const res = await runCli(["start", "broken"], root);
  expect(res.code).not.toBe(0);
  expect(res.stdout.trim()).toBe(""); // no {runId,pid} printed for a confirmed-dead worker
  expect(res.stderr).toContain("exited during startup");
  expect(res.stderr).toContain("boom at module load"); // worker.log tail, self-documenting

  // registry-lifecycle: no "running" entry is left behind — instead, a
  // self-documenting "failed-start" entry carrying the same failure detail,
  // so RCA never needs a foreground reproduction.
  const entries = listEntries(root);
  expect(entries.length).toBe(1);
  expect(entries[0]?.status).toBe("failed-start");
  expect(entries[0]?.startFailureDetail).toContain("boom at module load");
  expect(entries[0]?.finishedAt).not.toBeNull();
  expect(entries[0]?.bootId).toBeDefined();
});

test("status and monitor report failed-start for a worker that crashed before loading the workflow", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "broken", BROKEN);
  await runCli(["start", "broken"], root);
  const [entry] = listEntries(root);
  expect(entry).toBeDefined();
  const runId = entry!.runId;

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(6);
  expect(st.stdout).toContain("state: failed-start");
  expect(st.stdout).toContain("failed-start: true");
  expect(st.stdout).toContain("boom at module load");

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(5);
  expect(mon.stdout).toContain("failed-start: true");
});

// --- succeeded (detached run that runs past the grace window) ---

test("status and monitor report succeeded for a detached run", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "succeed", SUCCEED);
  const { runId } = await startRun(root, "succeed");

  // while it is still mid-run (the fixture sleeps 600ms, start returned at
  // ~250ms), a bare `status` auto-resolves the single running run
  const stRunning = await runCli(["status"], root);
  expect(stRunning.code).toBe(3);
  expect(stRunning.stdout).toContain("state: running");

  expect(await waitForTerminal(root, runId, 5000)).toBe("succeeded");

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(0);
  expect(st.stdout).toContain("state: succeeded");
  expect(st.stdout).toContain(`run: ${runId}`);

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(0);
  expect(mon.stdout).toContain("succeeded");

  // once the only run has finished, a bare `status` is "nothing to monitor"
  await waitFor(
    () => readEntry(root, runId)?.status === "succeeded",
    3000,
    "registry to cache succeeded",
  );
  const bare = await runCli(["status"], root);
  expect(bare.code).toBe(7);
  expect(bare.stdout).toContain(runId); // mentioned as the most recent finished run
});

// --- succeeded (the actual haiku-readme example, via a real worker run) ---

test("status and monitor report succeeded for a run of the haiku-readme example", async () => {
  const root = makeProjectRoot();
  cpSync(haikuExample, join(root, "haiku-readme"), { recursive: true });
  const runId = randomUUID();
  writeEntry(root, {
    schemaVersion: SCHEMA_VERSION,
    runId,
    pid: process.pid,
    // rootDir is the invocation cwd (the project root), not the workflow dir
    rootDir: root,
    startedAt: Date.now(),
    status: "running",
    finishedAt: null,
  });

  const worker = await runCli(["__worker", "haiku-readme", runId], root);
  expect(worker.code).toBe(0);
  expect(journalTerminalState(root, runId)).toBe("succeeded");

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(0);
  expect(st.stdout).toContain("state: succeeded");

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(0);
  expect(mon.stdout).toContain("succeeded");
});

// --- crashed ---

test("status and monitor report crashed (with reason) for a run that crashes mid-run", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "crash", CRASH);
  const { runId } = await startRun(root, "crash");
  expect(await waitForTerminal(root, runId, 5000)).toBe("crashed");

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(1);
  expect(st.stdout).toContain("state: crashed");
  expect(st.stdout).toContain("runner-error");

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(1);
  expect(mon.stdout).toContain("crashed");
  expect(mon.stdout).toContain("runner-error");
});

// --- orphan (kill the worker while it is mid-run, journal has no end marker) ---

test("status and monitor report orphaned when the worker is killed mid-run", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "slow", SLOW);
  const { runId, pid } = await startRun(root, "slow");

  // wait until the journal has grown past its begin marker (last line is a
  // live node's running event, not an EXIT-succeeded marker)
  await waitFor(
    () => journalLineCount(root, runId) >= 2,
    3000,
    "journal to hold begin + a running line",
  );
  killWorker(pid);
  await waitFor(() => !isPidAlive(pid), 3000, "worker to be confirmed dead");

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(2);
  expect(st.stdout).toContain("state: orphaned");
  expect(st.stdout).toContain("orphaned: true");

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(2);
  expect(mon.stdout).toContain("orphaned");
});

// --- host-died (registry's bootId doesn't match the current host) ---

test("status and monitor report host-died, not orphaned, when the recorded bootId doesn't match", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "slow", SLOW);
  const { runId, pid } = await startRun(root, "slow");

  await waitFor(
    () => journalLineCount(root, runId) >= 2,
    3000,
    "journal to hold begin + a running line",
  );
  killWorker(pid);
  await waitFor(() => !isPidAlive(pid), 3000, "worker to be confirmed dead");

  // Simulate "this entry was written on a boot that's no longer current" —
  // the real trigger (an actual host reboot) can't be reproduced in a test.
  const entry = readEntry(root, runId)!;
  writeEntry(root, { ...entry, bootId: "not-the-real-boot-id" });

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(5);
  expect(st.stdout).toContain("state: host-died");
  expect(st.stdout).toContain("host-died: true");

  const mon = await runCli(["monitor", "--run", runId], root);
  expect(mon.code).toBe(4);
  expect(mon.stdout).toContain("host-died: true");
});

test("status still reports orphaned (not host-died) when bootId is absent (pre-this-change entry)", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "slow", SLOW);
  const { runId, pid } = await startRun(root, "slow");

  await waitFor(
    () => journalLineCount(root, runId) >= 2,
    3000,
    "journal to hold begin + a running line",
  );
  killWorker(pid);
  await waitFor(() => !isPidAlive(pid), 3000, "worker to be confirmed dead");

  const entry = readEntry(root, runId)!;
  writeEntry(root, { ...entry, bootId: undefined });

  const st = await runCli(["status", "--run", runId], root);
  expect(st.code).toBe(2);
  expect(st.stdout).toContain("state: orphaned");
});

// --- ambiguous (two concurrent detached runs) ---

test("status and monitor are ambiguous with two concurrent detached runs, no --run", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "slow", SLOW);
  const a = await startRun(root, "slow");
  const b = await startRun(root, "slow");
  try {
    const st = await runCli(["status"], root);
    expect(st.code).toBe(5);
    expect(st.stderr).toContain(a.runId);
    expect(st.stderr).toContain(b.runId);

    const mon = await runCli(["monitor"], root);
    expect(mon.code).toBe(5);

    // but --run disambiguates and resolves to a live run
    const stOne = await runCli(["status", "--run", a.runId], root);
    expect(stOne.code).toBe(3); // still running
  } finally {
    killWorker(a.pid);
    killWorker(b.pid);
  }
});

// --- no such run ---

test("status and monitor report no-such-run for an unknown --run", async () => {
  const root = makeProjectRoot();
  const st = await runCli(["status", "--run", "does-not-exist"], root);
  expect(st.code).toBe(4);
  expect(st.stderr).toContain("no such run");

  const mon = await runCli(["monitor", "--run", "does-not-exist"], root);
  expect(mon.code).toBe(4);
});

// --- nothing to monitor ---

test("status and monitor report nothing-to-monitor with zero runs", async () => {
  const root = makeProjectRoot();
  const st = await runCli(["status"], root);
  expect(st.code).toBe(7);
  expect(st.stdout).toContain("nothing to monitor");

  const mon = await runCli(["monitor"], root);
  expect(mon.code).toBe(7);
});

// --- workflow reference resolution: darkf/<name> ---

test("a bare name resolves against <cwd>/darkf/<name>", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "darkf/succeed", SUCCEED);

  const res = await runCli(["render", "succeed"], root);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("stateDiagram-v2");
});

test("darkf workflows lists workspace entries from darkf/", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "darkf/current-style", SUCCEED);

  const res = await runCli(["workflows"], root);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("current-style");
});

test("the old <cwd>/.darkf/workflows/<name> location is no longer resolved — removed, not kept as a fallback", async () => {
  const root = makeProjectRoot();
  writeFixture(root, ".darkf/workflows/legacy-style", SUCCEED);

  const res = await runCli(["render", "legacy-style"], root);
  expect(res.code).not.toBe(0);
  expect(res.stderr).toContain("no workflow for 'legacy-style'");

  const list = await runCli(["workflows"], root);
  expect(list.stdout).not.toContain("legacy-style");
});

// --- start-time dirty-workflow-config guard ---

function git(args: string[], cwd: string): void {
  const res = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (!res.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(res.stderr)}`);
  }
}

function makeRealGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "darkf-cli-git-int-"));
  roots.push(root);
  git(["init", "-q"], root);
  mkdirSync(join(root, "node_modules", "@psimona"), { recursive: true });
  symlinkSync(join(repoRoot, "darkf"), join(root, "node_modules", "@psimona", "darkf"));
  return root;
}

test("start refuses to launch when darkf/ has uncommitted changes, names the files", async () => {
  const root = makeRealGitRoot();
  writeFixture(root, "darkf/succeed", SUCCEED);
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "init"], root);

  // Dirty an already-committed workflow file.
  writeFileSync(join(root, "darkf/succeed/workflow.ts"), "// edited, uncommitted\n");

  const res = await runCli(["start", "darkf/succeed"], root);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("uncommitted changes");
  expect(res.stderr).toContain("workflow.ts");
  expect(res.stderr).toContain("--allow-dirty-workflow");
  expect(listEntries(root)).toEqual([]); // refused before ever spawning a worker
});

test("--allow-dirty-workflow overrides the guard", async () => {
  const root = makeRealGitRoot();
  writeFixture(root, "darkf/succeed", SUCCEED);
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "init"], root);
  writeFileSync(
    join(root, "darkf/succeed/workflow.ts"),
    `${SUCCEED["workflow.ts"]}\n// uncommitted edit\n`,
  );

  const res = await runCli(["start", "darkf/succeed", "--allow-dirty-workflow"], root);
  expect(res.code).toBe(0);
  const parsed = JSON.parse(res.stdout.trim()) as { runId: string; pid: number };
  workerPids.push(parsed.pid);
});

// --- detached survival ---

test("the detached worker keeps running (and the journal grows) after the launcher exits", async () => {
  const root = makeProjectRoot();
  writeFixture(root, "slow", SLOW);
  const { runId, pid } = await startRun(root, "slow"); // the `start` process has already exited here

  // the launcher is gone, but the worker is still alive and past its begin marker
  expect(isPidAlive(pid)).toBe(true);
  await waitFor(
    () => journalLineCount(root, runId) >= 2,
    3000,
    "journal to grow past the begin marker",
  );

  // it completes on its own once the launcher is no longer around
  expect(await waitForTerminal(root, runId, 8000)).toBe("succeeded");
});
