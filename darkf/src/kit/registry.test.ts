import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CrashReason, EXIT, FAILED, type NodeEvent, type NodeResult } from "../core/index.ts";
import {
  detectSupervisorSignal,
  isPidAlive,
  journalPathFor,
  journalTerminal,
  listEntries,
  projectRoot,
  type RegistryEntry,
  type RunResolution,
  readEntry,
  resolveRun,
  SCHEMA_VERSION,
  writeEntry,
} from "./registry.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "darkf-registry-test-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

// A pid that is guaranteed gone by the time the matrix runs: spawn a child,
// await its exit, reuse its (now-dead) pid.
const deadChild = Bun.spawn(["bun", "-e", "setTimeout(()=>{},20)"]);
await deadChild.exited;
const deadPid: number = deadChild.pid;
const livePid = process.pid;

let scenario = 0;
function freshRoot(): string {
  const root = join(tmpRoot, `s${scenario++}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function makeEntry(
  runId: string,
  pid: number,
  rootDir: string,
  overrides?: Partial<RegistryEntry>,
): RegistryEntry {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    pid,
    rootDir,
    startedAt: Date.now(),
    status: "running",
    finishedAt: null,
    ...overrides,
  };
}

const R = "run-id";
function begin(seed: NodeResult = {}): NodeEvent {
  return {
    runId: R,
    state: EXIT,
    scopePath: [],
    status: { phase: "succeeded", result: seed },
    timestamp: 1000,
  };
}
function end(final: NodeResult = {}): NodeEvent {
  return {
    runId: R,
    state: EXIT,
    scopePath: [],
    status: { phase: "succeeded", result: final },
    timestamp: 3000,
  };
}
function running(state: string, ts: number, attempt = 1): NodeEvent {
  return {
    runId: R,
    state,
    scopePath: [],
    status: { phase: "running", attempt, startedAt: ts, lastHeartbeat: ts },
    timestamp: ts,
  };
}
function succeeded(state: string, ts: number, result: NodeResult = {}): NodeEvent {
  return { runId: R, state, scopePath: [], status: { phase: "succeeded", result }, timestamp: ts };
}
function failedEnd(result: NodeResult = {}): NodeEvent {
  return {
    runId: R,
    state: FAILED,
    scopePath: [],
    status: { phase: "failed", result },
    timestamp: 3000,
  };
}
function crashed(state: string, ts: number, reason: CrashReason, attempt = 1): NodeEvent {
  return {
    runId: R,
    state,
    scopePath: [],
    status: { phase: "crashed", reason, attempt },
    timestamp: ts,
  };
}
function writeJournal(rootDir: string, runId: string, events: NodeEvent[]): string {
  const dir = join(rootDir, ".darkf", "run", runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "journal.jsonl");
  writeFileSync(
    path,
    events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""),
  );
  return path;
}
// entry + journal wired together under one scenario root
function seeded(
  runId: string,
  pid: number,
  events: NodeEvent[],
  overrides?: Partial<RegistryEntry>,
): {
  root: string;
  entry: RegistryEntry;
} {
  const root = freshRoot();
  const rootDir = join(root, "wf");
  const entry = makeEntry(runId, pid, rootDir, overrides);
  writeEntry(root, entry);
  writeJournal(rootDir, runId, events);
  return { root, entry };
}

test("projectRoot walks up to the nearest ancestor with a .git, else returns cwd", () => {
  const proj = join(tmpRoot, "proj");
  mkdirSync(join(proj, ".git"), { recursive: true });
  const deep = join(proj, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  expect(projectRoot(deep)).toBe(proj);
  expect(projectRoot(proj)).toBe(proj);
  // no .git anywhere up from an os tmpdir path -> fall back to the given dir
  const lone = join(tmpRoot, "no-git-here");
  mkdirSync(lone, { recursive: true });
  expect(projectRoot(lone)).toBe(lone);
});

test("registry entry round-trips through write/read, listEntries includes it", () => {
  const root = freshRoot();
  const entry = makeEntry("r1", livePid, "/some/root", { message: "hello" });
  writeEntry(root, entry);
  expect(readEntry(root, "r1")).toEqual(entry);
  expect(listEntries(root)).toEqual([entry]);
  // an entry without a message round-trips with message undefined, not ""
  writeEntry(root, makeEntry("r2", livePid, "/r2"));
  const r2 = readEntry(root, "r2");
  expect(r2?.message).toBeUndefined();
  expect(
    listEntries(root)
      .map((e) => e.runId)
      .sort(),
  ).toEqual(["r1", "r2"]);
});

test("readEntry returns undefined for a missing runId", () => {
  const root = freshRoot();
  writeEntry(root, makeEntry("present", livePid, "/p"));
  expect(readEntry(root, "absent")).toBeUndefined();
});

test("unknown schemaVersion is skipped with a warning, not a crash", () => {
  const root = freshRoot();
  const dir = join(root, ".darkf", "registry");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "old.json"),
    JSON.stringify({ schemaVersion: 2, runId: "old", pid: 1, rootDir: "/x" }),
  );
  writeEntry(root, makeEntry("new", livePid, "/n"));

  const orig = console.warn;
  let warned = "";
  console.warn = (msg: string) => {
    warned += msg;
  };
  let entries: RegistryEntry[] = [];
  try {
    entries = listEntries(root);
  } finally {
    console.warn = orig;
  }
  expect(entries.map((e) => e.runId)).toEqual(["new"]);
  expect(readEntry(root, "old")).toBeUndefined();
  expect(warned).toContain("schemaVersion");
});

test("listEntries skips malformed JSON and structurally-bad entries without crashing", () => {
  const root = freshRoot();
  const dir = join(root, ".darkf", "registry");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "garbage.json"), "{not json at all");
  writeFileSync(
    join(dir, "badshape.json"),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId: 42, pid: 1, rootDir: "/x" }),
  );
  writeEntry(root, makeEntry("good", livePid, "/g"));
  expect(listEntries(root).map((e) => e.runId)).toEqual(["good"]);
});

test("listEntries returns [] when the registry directory does not exist", () => {
  expect(listEntries(join(tmpRoot, "never-created"))).toEqual([]);
});

test("isPidAlive is true for a live pid and false for a dead one", () => {
  expect(isPidAlive(livePid)).toBe(true);
  expect(isPidAlive(deadPid)).toBe(false);
});

function journal(events: NodeEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
}

test("journalTerminal reads the last line: EXIT-succeeded, crashed, else undefined", () => {
  expect(journalTerminal(journal([end({ output: "done" })]))).toBe("succeeded");
  expect(
    journalTerminal(
      journal([begin(), crashed("Solo", 2000, { kind: "no-transition", state: "Solo" })]),
    ),
  ).toBe("crashed");
  expect(journalTerminal(journal([begin(), running("Solo", 2000)]))).toBeUndefined();
  expect(journalTerminal("")).toBeUndefined();
  // A journal whose last line is an EXIT-succeeded marker reads as succeeded —
  // position, not a field, is what the spec keys off. (A run that only ever
  // wrote its begin marker therefore reads "succeeded" here; the orphan test
  // below avoids that degenerate shape by killing after the journal has grown.)
  expect(journalTerminal(journal([begin()]))).toBe("succeeded");
});

test("journalTerminal reads a FAILED-tagged last line as failed, not crashed", () => {
  expect(
    journalTerminal(journal([begin(), succeeded("RunFailure", 2000), failedEnd({ output: "x" })])),
  ).toBe("failed");
});

// --- the full 9-case resolution matrix ---

test("case 1: no registry dir / empty -> nothing to monitor", () => {
  expect(resolveRun(join(tmpRoot, "no-such-dir"))).toEqual({
    kind: "none",
    recentFinished: undefined,
  });
  const empty = freshRoot();
  mkdirSync(join(empty, ".darkf", "registry"), { recursive: true });
  expect(resolveRun(empty)).toEqual({ kind: "none", recentFinished: undefined });
});

test("case 2: --run given, no matching entry -> no such run", () => {
  const { root } = seeded("a", livePid, [begin(), running("S", 2000)]);
  expect(resolveRun(root, "missing")).toEqual({ kind: "noSuchRun" });
});

test("case 3: --run matches and is already terminal -> short-circuit (even with a dead PID)", () => {
  const ok = seeded("ok", deadPid, [
    begin(),
    succeeded("S", 2500, { output: "x" }),
    end({ output: "x" }),
  ]);
  expect(resolveRun(ok.root, "ok").kind).toBe("terminal");
  const okRes = resolveRun(ok.root, "ok");
  if (okRes.kind === "terminal") expect(okRes.outcome).toBe("succeeded");

  const bad = seeded("bad", deadPid, [
    begin(),
    crashed("S", 2500, { kind: "runner-error", error: "boom" }),
  ]);
  const badRes = resolveRun(bad.root, "bad");
  expect(badRes.kind).toBe("terminal");
  if (badRes.kind === "terminal") expect(badRes.outcome).toBe("crashed");

  const failed = seeded("failed-run", deadPid, [
    begin(),
    succeeded("RunFailure", 2500, { output: "x" }),
    failedEnd({ output: "x" }),
  ]);
  const failedRes = resolveRun(failed.root, "failed-run");
  expect(failedRes.kind).toBe("terminal");
  if (failedRes.kind === "terminal") expect(failedRes.outcome).toBe("failed");
});

test("case 4: --run, cached running, dead PID, journal not EXIT-succeeded -> orphaned", () => {
  const { root } = seeded("orphan", deadPid, [begin(), running("S", 2000)]);
  expect(resolveRun(root, "orphan")).toEqual({
    kind: "orphaned",
    entry: expect.anything(),
    journalPath: expect.anything(),
  } as never);
});

test("case 5: no --run, entries exist but none running -> nothing, mentioning most recent finished", () => {
  const root = freshRoot();
  const done = makeEntry("done", deadPid, "/d", { status: "succeeded", finishedAt: 9999 });
  writeEntry(root, done);
  const res = resolveRun(root);
  expect(res.kind).toBe("none");
  if (res.kind === "none") expect(res.recentFinished?.runId).toBe("done");
});

test("case 6: no --run, exactly one cached running with a live PID -> resolve to it", () => {
  const { root, entry } = seeded("live", livePid, [begin(), running("S", 2000)]);
  const res = resolveRun(root);
  expect(res.kind).toBe("resolved");
  if (res.kind === "resolved") expect(res.entry.runId).toBe(entry.runId);
});

test("case 7: no --run, one cached running, dead PID -> journal decides (succeeded / crashed / orphaned)", () => {
  const ok = seeded("ok", deadPid, [begin(), succeeded("S", 2500, {}), end({})]);
  const okRes = resolveRun(ok.root);
  expect(okRes.kind).toBe("terminal");
  if (okRes.kind === "terminal") expect(okRes.outcome).toBe("succeeded");

  const bad = seeded("bad", deadPid, [
    begin(),
    crashed("S", 2500, { kind: "no-transition", state: "S" }),
  ]);
  const badRes = resolveRun(bad.root);
  expect(badRes.kind).toBe("terminal");
  if (badRes.kind === "terminal") expect(badRes.outcome).toBe("crashed");

  const gone = seeded("gone", deadPid, [begin(), running("S", 2000)]);
  expect(resolveRun(gone.root).kind).toBe("orphaned");
});

test("case 8: no --run, 2+ cached running with live PIDs -> ambiguous, listing the live ones", () => {
  const root = freshRoot();
  const a = makeEntry("a", livePid, "/a");
  const b = makeEntry("b", livePid, "/b");
  writeEntry(root, a);
  writeEntry(root, b);
  const res = resolveRun(root);
  expect(res.kind).toBe("ambiguous");
  if (res.kind === "ambiguous") expect(res.entries.map((e) => e.runId).sort()).toEqual(["a", "b"]);
});

test("case 9: no --run, 2+ cached running, only one live -> resolve to the live one, warn about the rest", () => {
  const root = freshRoot();
  writeEntry(root, makeEntry("dead-one", deadPid, "/d"));
  writeEntry(root, makeEntry("live-one", livePid, "/l"));
  writeJournal(join(root, "/l"), "live-one", [begin(), running("S", 2000)]);
  const orig = console.warn;
  let warned = "";
  console.warn = (msg: string) => {
    warned += msg;
  };
  let res: RunResolution;
  try {
    res = resolveRun(root);
  } finally {
    console.warn = orig;
  }
  expect(res.kind).toBe("resolved");
  if (res.kind === "resolved") expect(res.entry.runId).toBe("live-one");
  expect(warned).toContain("dead-one");
});

test("no --run, 2+ cached running, none live -> ambiguous (refuse to guess between dead runs)", () => {
  const root = freshRoot();
  writeEntry(root, makeEntry("d1", deadPid, "/d1"));
  writeEntry(root, makeEntry("d2", deadPid, "/d2"));
  const res = resolveRun(root);
  expect(res.kind).toBe("ambiguous");
  if (res.kind === "ambiguous")
    expect(res.entries.map((e) => e.runId).sort()).toEqual(["d1", "d2"]);
});

test("journalPathFor points at the run's journal under its rootDir", () => {
  const entry = makeEntry("r1", livePid, "/root");
  expect(journalPathFor(entry)).toBe(join("/root", ".darkf", "run", "r1", "journal.jsonl"));
});

test("detectSupervisorSignal matches CLAUDE_CODE_SESSION_ID, else leaves both fields unset", () => {
  expect(detectSupervisorSignal({ CLAUDE_CODE_SESSION_ID: "sess-abc" })).toEqual({
    supervisorSessionID: "sess-abc",
    supervisorHarness: "claude-code",
  });
  expect(detectSupervisorSignal({})).toEqual({});
  expect(detectSupervisorSignal({ CLAUDE_CODE_SESSION_ID: "" })).toEqual({});
  expect(detectSupervisorSignal({ SOME_OTHER_VAR: "x" })).toEqual({});
});
