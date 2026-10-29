#!/usr/bin/env bun
// A minimal supervisor: start the workflow, then react to things `darkf
// monitor` only warns about (a stalled or orphaned worker) instead of
// leaving a human to notice. Run from the same directory as tasks.json —
// the workflow's rootDir — exactly like `darkf start` itself:
//
//   bunx bun examples/task-queue/supervise.ts
//
// This is the "supervisor" the rest of darkf's CLI output already assumes
// exists (status/monitor call stalls "warn-only — the supervisor decides").
// It doesn't have to be a script like this one — an agent harness invoking
// `darkf start` directly is a supervisor too, and darkf detects that case
// (see SUPERVISOR_ENV_SIGNALS in darkf-cli/src/registry.ts) so a UI like the
// OpenCode plugin can show which session is driving a run.
const WORKFLOW = new URL(".", import.meta.url).pathname;
const POLL_MS = 5_000;

async function darkf(...args: string[]): Promise<number> {
  const proc = Bun.spawn(["bunx", "darkf", ...args], { stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

async function start(): Promise<string> {
  const proc = Bun.spawn(["bunx", "darkf", "start", WORKFLOW], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return (JSON.parse(stdout) as { runId: string }).runId;
}

let runId = await start();
console.log(`started run ${runId}`);

for (;;) {
  const code = await darkf("monitor", "--run", runId, "--once");
  if (code === 0) {
    console.log("succeeded");
    await darkf("report", "--run", runId);
    break;
  }
  if (code === 1) {
    console.log("crashed — see report before deciding whether to resume");
    await darkf("report", "--run", runId);
    break;
  }
  if (code === 2) {
    console.log("orphaned — worker died without a terminal journal entry; restarting");
    runId = await start();
    continue;
  }
  // 6: the run is still going. darkf status --run would also show a
  // stall-suspected warning here once a dispatch sits past its heartbeat
  // window — that's this script's cue to act, not darkf's.
  await Bun.sleep(POLL_MS);
}
