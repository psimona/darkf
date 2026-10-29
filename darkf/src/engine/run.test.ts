import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentFailure,
  type AgentRunner,
  type DispatchInfo,
  EXIT,
  FAILED,
  type NodeEvent,
  type NodeResult,
  type ScriptRunner,
  type WorkflowDef,
} from "../core/index.ts";
import { run as engineRun, type RunOptions } from "./run.ts";

const noopAgent: AgentRunner = { run: async () => ({}) };
const noopScript: ScriptRunner = { run: async () => ({}) };

// Every run journals unconditionally now — keep that out of the repo by
// rooting every test run under a scratch temp dir instead of cwd.
const testRootDir = mkdtempSync(join(tmpdir(), "darkf-engine-test-"));
afterAll(() => rmSync(testRootDir, { recursive: true, force: true }));

function run(opts: Omit<RunOptions, "rootDir">) {
  return engineRun({ ...opts, rootDir: testRootDir });
}

test("runs a flat workflow to completion via on/next", async () => {
  const workflow: WorkflowDef = {
    initial: "Plan",
    states: {
      Plan: { type: "agent", prompt: "plan", on: { approved: "Build" } },
      Build: { type: "script", file: "build.ts", next: "Review" },
      Review: { type: "agent", prompt: "review", on: { done: EXIT, changes_requested: "Build" } },
    },
  };

  let reviewCalls = 0;
  const agentRunner: AgentRunner = {
    run: async (id) => {
      if (id === "Plan") return { event: "approved" };
      reviewCalls++;
      return { event: reviewCalls === 1 ? "changes_requested" : "done" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(result.node.phase).toBe("succeeded");
  expect(result.trace.map((t) => t.state)).toEqual(["Plan", "Build", "Review", "Build", "Review"]);
});

test("supports a cross-scope edge directly out of a composite", async () => {
  const workflow: WorkflowDef = {
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

  const agentRunner: AgentRunner = {
    run: async (id) => (id === "Plan" ? { event: "approved" } : { event: "done" }),
  };
  const scriptRunner: ScriptRunner = {
    run: async (id) => (id === "Test" ? { event: "passed" } : {}),
  };

  const result = await run({ workflow, agentRunner, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
  expect(result.trace.map((t) => t.state)).toEqual(["Plan", "Write", "Test", "Review"]);
});

test("supports re-entry into a leaf inside a different composite", async () => {
  const workflow: WorkflowDef = {
    initial: "Implement",
    states: {
      Implement: {
        initial: "Write",
        states: {
          Write: { type: "script", file: "write.ts", next: "Test" },
          Test: { type: "script", file: "test.ts", on: { passed: "Review", failed: "Write" } },
        },
      },
      Review: { type: "agent", prompt: "review", on: { done: EXIT, changes_requested: "Write" } },
    },
  };

  let testAttempts = 0;
  let reviewCalls = 0;
  const scriptRunner: ScriptRunner = {
    run: async (id) => {
      if (id === "Test") {
        testAttempts++;
        return { event: testAttempts === 1 ? "failed" : "passed" };
      }
      return {};
    },
  };
  const agentRunner: AgentRunner = {
    run: async () => {
      reviewCalls++;
      return { event: reviewCalls === 1 ? "changes_requested" : "done" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
  expect(result.trace.map((t) => t.state)).toEqual([
    "Write",
    "Test",
    "Write",
    "Test",
    "Review",
    "Write",
    "Test",
    "Review",
  ]);
});

test("crashes with a no-transition reason when a returned event matches no route", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: EXIT } } },
  };
  const scriptRunner: ScriptRunner = { run: async () => ({ event: "not_ok" }) };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "no-transition", state: "Solo", event: "not_ok" });
  }
});

test("crashes eagerly with invalid-workflow for a dead-end leaf, before any dispatch", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts" } }, // no on, no next
  };
  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async () => {
      calls++;
      return {};
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(calls).toBe(0); // never dispatched — caught before the first enter()
  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({
      kind: "invalid-workflow",
      errors: [{ kind: "dead-end-leaf", state: "Solo" }],
    });
  }
});

test("crashes eagerly with invalid-workflow for an unresolved on/next target", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", next: "Nope" } },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner: noopScript });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({
      kind: "invalid-workflow",
      errors: [{ kind: "unresolved-target", from: "Solo", target: "Nope" }],
    });
  }
});

test("crashes eagerly with invalid-workflow for a composite initial-cycle, instead of hanging", async () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { initial: "B", states: { LeafA: { type: "script", file: "leaf.ts", next: EXIT } } },
      B: { initial: "A", states: { LeafB: { type: "script", file: "leaf.ts", next: EXIT } } },
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner: noopScript });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({
      kind: "invalid-workflow",
      errors: [{ kind: "initial-cycle", cycle: ["A", "B"] }],
    });
  }
});

test("crashes with a duplicate-id reason instead of throwing", async () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { type: "script", file: "a.ts", next: "B" },
      Wrapper: {
        initial: "A",
        states: { A: { type: "script", file: "a.ts" } },
      },
    },
  } as unknown as WorkflowDef;

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner: noopScript });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "duplicate-id", id: "A" });
  }
});

test("retries a crashing leaf up to `retries` times then succeeds", async () => {
  const workflow: WorkflowDef = {
    initial: "Flaky",
    states: { Flaky: { type: "script", file: "flaky.ts", retries: 2, on: { ok: EXIT } } },
  };

  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async () => {
      calls++;
      if (calls < 3) throw new Error("transient boom");
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
  expect(calls).toBe(3);
});

test("crashes with runner-error after exhausting retries", async () => {
  const workflow: WorkflowDef = {
    initial: "Flaky",
    states: { Flaky: { type: "script", file: "flaky.ts", retries: 1, on: { ok: EXIT } } },
  };

  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async () => {
      calls++;
      throw new Error("always boom");
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(calls).toBe(2); // 1 initial attempt + 1 retry
  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "runner-error", error: "always boom" });
    expect(result.node.attempt).toBe(2);
  }
});

test("crashes with a timeout reason when a runner exceeds timeoutMs", async () => {
  const workflow: WorkflowDef = {
    initial: "Slow",
    states: { Slow: { type: "script", file: "slow.ts", timeoutMs: 10, on: { ok: EXIT } } },
  };

  const scriptRunner: ScriptRunner = {
    run: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "timeout", elapsedMs: 10 });
  }
});

test("onEvent fires for every transition, including retries", async () => {
  const workflow: WorkflowDef = {
    initial: "Flaky",
    states: { Flaky: { type: "script", file: "flaky.ts", retries: 1, on: { ok: EXIT } } },
  };

  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { event: "ok" };
    },
  };

  const events: NodeEvent[] = [];
  await run({ workflow, agentRunner: noopAgent, scriptRunner, onEvent: (e) => events.push(e) });

  // The run's own begin/end markers (state EXIT) bookend the leaf's events.
  expect(events.map((e) => e.status.phase)).toEqual([
    "succeeded", // begin marker (EXIT)
    "running", // attempt 1
    "running", // attempt 2 (retry)
    "succeeded", // leaf success (Flaky)
    "succeeded", // end marker (EXIT)
  ]);
  expect(events.filter((e) => e.state === "Flaky").length).toBe(3);
  expect(events[0]!.state).toBe(EXIT);
  expect(events.at(-1)!.state).toBe(EXIT);
});

test("always journals to .darkf/run/<runId>/journal.jsonl, unconditionally", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: EXIT } } },
  };
  const scriptRunner: ScriptRunner = { run: async () => ({ event: "ok" }) };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  const parsed = lines.map((l) => JSON.parse(l) as NodeEvent);
  // begin (EXIT) + running + succeeded (Solo) + end (EXIT)
  expect(parsed.map((e) => e.status.phase)).toEqual([
    "succeeded",
    "running",
    "succeeded",
    "succeeded",
  ]);
  expect(parsed[0]!.state).toBe(EXIT); // begin marker is the first line
  expect(parsed.at(-1)!.state).toBe(EXIT); // end marker is the last line
  expect(parsed.every((e) => e.runId === result.runId)).toBe(true);
});

test("validate rejects a well-formed but semantically bad result, consuming a retry", async () => {
  const workflow: WorkflowDef = {
    initial: "Picky",
    states: {
      Picky: {
        type: "script",
        file: "picky.ts",
        retries: 1,
        on: { ok: EXIT },
        validate: (result) =>
          result.output === "good" ? undefined : "expected output to be 'good'",
      },
    },
  };

  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async () => {
      calls++;
      return { event: "ok", output: calls === 1 ? "bad" : "good" };
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(calls).toBe(2);
  expect(result.node.phase).toBe("succeeded");
});

test("crashes with cycle-limit when a multi-leaf loop exceeds a composite's maxCycles", async () => {
  const workflow: WorkflowDef = {
    initial: "Implement",
    states: {
      Implement: {
        initial: "Write",
        maxCycles: 3,
        states: {
          Write: { type: "script", file: "write.ts", next: "Test" },
          Test: { type: "script", file: "test.ts", on: { failed: "Write" } },
        },
      },
    },
  };

  const scriptRunner: ScriptRunner = {
    run: async (id) => (id === "Test" ? { event: "failed" } : {}),
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "cycle-limit", composite: "Implement", cycles: 3 });
  }
});

test("maxCycles does not fire when the loop finishes within budget", async () => {
  const workflow: WorkflowDef = {
    initial: "Implement",
    states: {
      Implement: {
        initial: "Write",
        maxCycles: 10,
        states: {
          Write: { type: "script", file: "write.ts", next: "Test" },
          Test: { type: "script", file: "test.ts", on: { passed: EXIT, failed: "Write" } },
        },
      },
    },
  };

  let calls = 0;
  const scriptRunner: ScriptRunner = {
    run: async (id) => {
      if (id !== "Test") return {};
      calls++;
      return { event: calls === 1 ? "failed" : "passed" };
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
});

test("maxCycles resets when a composite is re-entered after leaving it", async () => {
  // Router dispatches Implement twice; each pass is exactly 4 leaf dispatches
  // (Write, Test-failed, Write, Test-passed) under maxCycles: 4 — individually
  // within budget, but 8 combined would exceed it if the counter never reset
  // between passes (the exact bug cluster-tdd-loop-port reproduced: a cap
  // sized for one scope's dispatch count tripping on a second, healthy scope).
  const workflow: WorkflowDef = {
    initial: "Router",
    states: {
      Router: { type: "script", file: "router.ts", on: { go: "Implement", done: EXIT } },
      Implement: {
        initial: "Write",
        maxCycles: 4,
        states: {
          Write: { type: "script", file: "write.ts", next: "Test" },
          Test: { type: "script", file: "test.ts", on: { failed: "Write", passed: "Router" } },
        },
      },
    },
  };

  let routerCalls = 0;
  let testCalls = 0;
  const scriptRunner: ScriptRunner = {
    run: async (id) => {
      if (id === "Router") {
        routerCalls++;
        return { event: routerCalls <= 2 ? "go" : "done" };
      }
      if (id === "Test") {
        testCalls++;
        return { event: testCalls % 2 === 1 ? "failed" : "passed" };
      }
      return {};
    },
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
  expect(result.trace.map((t) => t.state)).toEqual([
    "Router",
    "Write",
    "Test",
    "Write",
    "Test",
    "Router",
    "Write",
    "Test",
    "Write",
    "Test",
    "Router",
  ]);
});

test("maxCycles still fires for a genuinely runaway single pass, unaffected by the reset", async () => {
  // Same shape as the re-entry test above, but Test never passes — one
  // continuous pass through Implement must still trip its own maxCycles,
  // proving the fix didn't weaken the breaker for its original job.
  const workflow: WorkflowDef = {
    initial: "Implement",
    states: {
      Implement: {
        initial: "Write",
        maxCycles: 4,
        states: {
          Write: { type: "script", file: "write.ts", next: "Test" },
          Test: { type: "script", file: "test.ts", on: { failed: "Write" } },
        },
      },
    },
  };

  const scriptRunner: ScriptRunner = {
    run: async (id) => (id === "Test" ? { event: "failed" } : {}),
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "cycle-limit", composite: "Implement", cycles: 4 });
  }
});

test("a composite's cycle counter is not reset just because a nested composite is freshly entered", async () => {
  // A (inside Outer) -> Inner (nested inside Outer, generous maxCycles) -> back
  // to A. Outer's own counter must keep accumulating across that hop into
  // Inner and back — proving composites reset independently by their own
  // presence in the previous dispatch's scopePath, not by a descendant's.
  const workflow: WorkflowDef = {
    initial: "Outer",
    states: {
      Outer: {
        initial: "A",
        maxCycles: 2,
        states: {
          A: { type: "script", file: "a.ts", on: { toInner: "Inner" } },
          Inner: {
            initial: "B",
            maxCycles: 10,
            states: {
              B: { type: "script", file: "b.ts", on: { back: "A" } },
            },
          },
        },
      },
    },
  };

  const scriptRunner: ScriptRunner = {
    run: async (id) => (id === "A" ? { event: "toInner" } : { event: "back" }),
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "cycle-limit", composite: "Outer", cycles: 2 });
  }
  expect(result.trace.map((t) => t.state)).toEqual(["A", "B"]);
});

test("crashes with validation-failed after exhausting retries", async () => {
  const workflow: WorkflowDef = {
    initial: "Picky",
    states: {
      Picky: {
        type: "script",
        file: "picky.ts",
        on: { ok: EXIT },
        validate: () => "always rejected",
      },
    },
  };

  const scriptRunner: ScriptRunner = { run: async () => ({ event: "ok" }) };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "validation-failed", message: "always rejected" });
    expect(result.node.attempt).toBe(1);
  }
});

test("threads agentSessionId and previousFailure into DispatchInfo across retries", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: {
      Agentic: {
        type: "agent",
        prompt: "do it",
        retries: 1,
        on: { ok: EXIT },
        validate: (result) => (result.event === "ok" ? undefined : "expected event 'ok'"),
      },
    },
  };

  const infos: DispatchInfo[] = [];
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, info) => {
      infos.push(info);
      if (info.attempt === 1) return { event: "retry_me", agentSessionId: "sess-123" };
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(result.node.phase).toBe("succeeded");
  expect(infos[0]).toMatchObject({
    attempt: 1,
    agentSessionId: undefined,
    previousFailure: undefined,
  });
  expect(infos[1]).toMatchObject({
    attempt: 2,
    agentSessionId: "sess-123",
    previousFailure: { kind: "validation-failed", message: "expected event 'ok'" },
  });
});

test("threads step and rootDir into DispatchInfo, step constant across retries of one visit", async () => {
  const workflow: WorkflowDef = {
    initial: "Plan",
    states: {
      Plan: {
        type: "agent",
        prompt: "plan",
        retries: 1,
        on: { approved: "Build" },
        validate: (result) => (result.event === "approved" ? undefined : "expected 'approved'"),
      },
      Build: { type: "script", file: "build.ts", on: { done: EXIT } },
    },
  };

  const infos: DispatchInfo[] = [];
  let planCalls = 0;
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, info) => {
      infos.push(info);
      planCalls++;
      if (planCalls === 1) return { event: "retry_me" };
      return { event: "approved" };
    },
  };
  const scriptRunner: ScriptRunner = {
    run: async (_id, _def, _handoff, _baseDir, info) => {
      infos.push(info);
      return { event: "done" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner });

  expect(result.node.phase).toBe("succeeded");
  expect(infos.map((i) => i.step)).toEqual([1, 1, 2]);
  expect(infos.every((i) => i.rootDir === testRootDir)).toBe(true);
});

test("begin marker is the journal's first line and carries the run's seed input", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: EXIT } } },
  };
  const scriptRunner: ScriptRunner = { run: async () => ({ event: "ok" }) };
  const seed = { output: { hello: "world" } };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner, input: seed });

  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const parsed = readFileSync(journalPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  expect(parsed[0]!.state).toBe(EXIT);
  expect(parsed[0]!.status).toEqual({ phase: "succeeded", result: seed });
});

test("end marker is the journal's last line and carries the final NodeResult on success", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: EXIT } } },
  };
  const finalResult = { event: "ok", output: "done" };
  const scriptRunner: ScriptRunner = { run: async () => finalResult };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const parsed = readFileSync(journalPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  const last = parsed.at(-1)!;
  expect(last.state).toBe(EXIT);
  expect(last.status).toEqual({ phase: "succeeded", result: finalResult });
});

test("a crashed run has no end marker, only the crashing leaf's own crashed line", async () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts" } }, // no on/next -> no-transition
  };
  const scriptRunner: ScriptRunner = { run: async () => ({}) };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("crashed");
  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const parsed = readFileSync(journalPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  expect(parsed[0]!.state).toBe(EXIT); // begin marker still present
  const last = parsed.at(-1)!;
  expect(last.state).toBe("Solo");
  expect(last.status.phase).toBe("crashed"); // no EXIT end marker after the crash
});

test("a duplicate-id crash still journals the begin marker as its first line", async () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { type: "script", file: "a.ts", next: "B" },
      Wrapper: { initial: "A", states: { A: { type: "script", file: "a.ts" } } },
    },
  } as unknown as WorkflowDef;

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner: noopScript });

  expect(result.node.phase).toBe("crashed");
  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const parsed = readFileSync(journalPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  expect(parsed[0]!.state).toBe(EXIT); // emitted before buildRegistry
  expect(parsed[0]!.status.phase).toBe("succeeded");
  const last = parsed.at(-1)!;
  expect(last.status.phase).toBe("crashed"); // no end marker
});

test("script nodes receive DispatchInfo (rootDir) as their second argument", async () => {
  const workflow: WorkflowDef = {
    initial: "S",
    states: {
      S: { type: "script", file: "probe.ts", next: EXIT },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "darkf-script-info-"));
  await writeFileSync(
    join(dir, "probe.ts"),
    "export default function (handoff, info) {\n  return { output: { rootDir: info?.rootDir ?? null } };\n}\n",
  );
  const rootDir = mkdtempSync(join(tmpdir(), "darkf-script-root-"));
  const opts: RunOptions = {
    workflow,
    scriptRunner: {
      async run(_id, def, handoff, baseDir, info) {
        const url = pathToFileURL(`${baseDir}/${def.file}`).href;
        const mod = await import(url);
        const fn = mod.default as (h: NodeResult, i: DispatchInfo) => NodeResult;
        return await fn(handoff, info);
      },
    },
    baseDir: dir,
    rootDir,
  };
  const result = await engineRun(opts);
  const finalStatus = result.node;
  const out =
    finalStatus.phase === "succeeded"
      ? (finalStatus.result?.output as { rootDir?: string } | undefined)
      : undefined;
  expect(out?.rootDir).toBe(rootDir);
  rmSync(dir, { recursive: true, force: true });
  rmSync(rootDir, { recursive: true, force: true });
});

test("an agent runner's onProgress is folded into the running heartbeat as agentStepCount/agentIdleMs", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "go", next: EXIT } },
  };
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, _info, onProgress) => {
      onProgress?.({ at: Date.now(), stepCount: 7, lastEvent: "step-finish" });
      await new Promise((r) => setTimeout(r, 250));
      return {};
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript, heartbeatMs: 50 });
  expect(result.node.phase).toBe("succeeded");

  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const events = readFileSync(journalPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  const heartbeats = events.filter((e) => e.state === "Agentic" && e.status.phase === "running");
  expect(heartbeats.length).toBeGreaterThanOrEqual(2);
  const last = heartbeats.at(-1)!;
  expect(last.status.phase === "running" && last.status.agentStepCount).toBe(7);
  expect(last.status.phase === "running" && typeof last.status.agentIdleMs).toBe("number");
});

test("open dispatches heartbeat the journal (live runtime)", async () => {
  const workflow: WorkflowDef = {
    initial: "S",
    states: { S: { type: "script", file: "slow.ts", next: EXIT } },
  };
  const dir = mkdtempSync(join(tmpdir(), "darkf-hb-scripts-"));
  await writeFileSync(
    join(dir, "slow.ts"),
    "export default async function () { await new Promise((r) => setTimeout(r, 700)); return {}; }\n",
  );
  const rootDir = mkdtempSync(join(tmpdir(), "darkf-hb-root-"));
  const result = await engineRun({ workflow, baseDir: dir, rootDir, heartbeatMs: 200 });
  expect(result.node.phase).toBe("succeeded");

  const journal = readFileSync(
    join(rootDir, ".darkf", "run", result.runId, "journal.jsonl"),
    "utf8",
  );
  const events = journal
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as NodeEvent);
  const running = events.filter((e) => e.status.phase === "running");
  // initial dispatch + >= 2 heartbeats during a 700ms node at 200ms cadence
  expect(running.length).toBeGreaterThanOrEqual(3);
  const beats = running.map((e) => (e.status.phase === "running" ? e.status.lastHeartbeat : 0));
  expect(beats.at(-1)!).toBeGreaterThan(beats[0]!);
  rmSync(dir, { recursive: true, force: true });
  rmSync(rootDir, { recursive: true, force: true });
});

// --- session-nudge (docs/specs/session-nudge/spec.md) ---

test("nudges a handoff-missing AgentFailure in-session, consuming no retry", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", on: { ok: EXIT } } },
  };

  const infos: DispatchInfo[] = [];
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, info) => {
      infos.push(info);
      if (infos.length === 1) {
        throw new AgentFailure("handoff not written", {
          agentSessionId: "sess-1",
          crashReason: { kind: "handoff-missing" },
        });
      }
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(result.node.phase).toBe("succeeded");
  expect(infos.length).toBe(2);
  // Both calls belong to the same outer attempt — no `def.retries` was spent.
  expect(infos[0]).toMatchObject({
    attempt: 1,
    agentSessionId: undefined,
    previousFailure: undefined,
  });
  expect(infos[1]).toMatchObject({
    attempt: 1,
    agentSessionId: "sess-1",
    previousFailure: { kind: "handoff-missing" },
  });
});

test("nudges no-transition when an unroutable event comes back in a returned NodeResult", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", on: { ok: EXIT } } },
  };

  const infos: DispatchInfo[] = [];
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, info) => {
      infos.push(info);
      if (infos.length === 1) return { event: "not_a_route", agentSessionId: "sess-2" };
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(result.node.phase).toBe("succeeded");
  expect(infos.length).toBe(2);
  expect(infos[1]).toMatchObject({
    attempt: 1,
    agentSessionId: "sess-2",
    previousFailure: { kind: "no-transition", state: "Agentic", event: "not_a_route" },
  });
});

test("exhausts the 3-nudge budget, then falls through and spends one def.retries slot", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", retries: 1, on: { ok: EXIT } } },
  };

  const infos: DispatchInfo[] = [];
  const agentRunner: AgentRunner = {
    run: async (_id, _def, _handoff, info) => {
      infos.push(info);
      if (infos.length <= 4) {
        throw new AgentFailure("handoff not written", {
          agentSessionId: "sess-3",
          crashReason: { kind: "handoff-missing" },
        });
      }
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(result.node.phase).toBe("succeeded");
  // 1 initial + 3 nudges, all on outer attempt 1; the 5th call is a fresh
  // outer attempt 2 (retries: 1 affords exactly one).
  expect(infos.length).toBe(5);
  expect(infos.slice(0, 4).map((i) => i.attempt)).toEqual([1, 1, 1, 1]);
  expect(infos[4]).toMatchObject({ attempt: 2 });
});

test("a nudge that fails with runner-error ends the nudge loop without spending further nudges", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", on: { ok: EXIT } } },
  };

  let calls = 0;
  const agentRunner: AgentRunner = {
    run: async () => {
      calls++;
      if (calls === 1) {
        throw new AgentFailure("handoff not written", {
          agentSessionId: "sess-4",
          crashReason: { kind: "handoff-missing" },
        });
      }
      throw new Error("provider died mid-nudge");
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(calls).toBe(2); // initial dispatch + exactly one nudge, which crashes non-nudgeably
  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "runner-error", error: "provider died mid-nudge" });
  }
});

test("nudge-start is emitted immediately with nudgeAttempt/nudgeReason, not gated behind a heartbeat", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", on: { ok: EXIT } } },
  };

  let calls = 0;
  const agentRunner: AgentRunner = {
    run: async () => {
      calls++;
      if (calls === 1) {
        throw new AgentFailure("handoff not written", {
          agentSessionId: "sess-5",
          crashReason: { kind: "handoff-missing" },
        });
      }
      return { event: "ok" };
    },
  };

  const events: NodeEvent[] = [];
  await run({ workflow, agentRunner, scriptRunner: noopScript, onEvent: (e) => events.push(e) });

  const running = events.filter((e) => e.state === "Agentic" && e.status.phase === "running");
  expect(running.length).toBe(2);
  expect(running[0]!.status).toMatchObject({ attempt: 1 });
  expect((running[0]!.status as { nudgeAttempt?: number }).nudgeAttempt).toBeUndefined();
  expect(running[1]!.status).toMatchObject({
    attempt: 1,
    nudgeAttempt: 1,
    nudgeReason: "handoff-missing",
  });
});

test("a shared per-attempt deadline bounds the whole nudge sequence, not a fresh timeout per nudge", async () => {
  const workflow: WorkflowDef = {
    initial: "Agentic",
    states: { Agentic: { type: "agent", prompt: "do it", timeoutMs: 100, on: { ok: EXIT } } },
  };

  let calls = 0;
  const agentRunner: AgentRunner = {
    run: async () => {
      calls++;
      if (calls === 1) {
        throw new AgentFailure("handoff not written", {
          agentSessionId: "sess-6",
          crashReason: { kind: "handoff-missing" },
        });
      }
      // The nudge itself runs past the attempt's remaining budget (~100ms
      // total, already spent on call 1 plus engine overhead) — this must
      // surface as `timeout`, not get a fresh 100ms of its own.
      await new Promise((r) => setTimeout(r, 300));
      return { event: "ok" };
    },
  };

  const result = await run({ workflow, agentRunner, scriptRunner: noopScript });

  expect(calls).toBe(2);
  expect(result.node.phase).toBe("crashed");
  if (result.node.phase === "crashed") {
    expect(result.node.reason).toEqual({ kind: "timeout", elapsedMs: 100 });
  }
});

test("a workflow routing to FAILED ends with phase 'failed', never crashed/unresolved-target", async () => {
  const workflow: WorkflowDef = {
    initial: "RunFailure",
    states: { RunFailure: { type: "script", file: "run_failure.ts", on: { gave_up: FAILED } } },
  };
  const scriptRunner: ScriptRunner = {
    run: async () => ({ event: "gave_up", output: { kind: "stuck_signature" } }),
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  expect(result.node.phase).toBe("failed");
  if (result.node.phase === "failed") {
    expect(result.node.result.output).toEqual({ kind: "stuck_signature" });
  }
});

test("FAILED's terminal journal entry carries the failing node's result as its end marker", async () => {
  const workflow: WorkflowDef = {
    initial: "RunFailure",
    states: { RunFailure: { type: "script", file: "run_failure.ts", on: { gave_up: FAILED } } },
  };
  const scriptRunner: ScriptRunner = {
    run: async () => ({ event: "gave_up", output: { kind: "cap_exceeded" } }),
  };

  const result = await run({ workflow, agentRunner: noopAgent, scriptRunner });

  const journalPath = join(testRootDir, ".darkf", "run", result.runId, "journal.jsonl");
  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  const parsed = lines.map((l) => JSON.parse(l) as NodeEvent);
  expect(parsed[0]!.state).toBe(EXIT); // begin marker, unchanged
  const last = parsed.at(-1)!;
  expect(last.state).toBe(FAILED);
  expect(last.status.phase).toBe("failed");
  if (last.status.phase === "failed") {
    expect(last.status.result.output).toEqual({ kind: "cap_exceeded" });
  }
});
