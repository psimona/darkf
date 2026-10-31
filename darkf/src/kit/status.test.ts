import { describe, expect, test } from "bun:test";
import {
  type CrashReason,
  EXIT,
  FAILED,
  type NodeEvent,
  type NodeResult,
  type TaskList,
} from "../core/index.ts";
import {
  agentStallWarning,
  classifyTerminal,
  foldJournal,
  foldReport,
  foldTaskList,
  nudgeWarning,
  stallWarning,
} from "./status.ts";

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
function running(
  state: string,
  ts: number,
  attempt = 1,
  agentSessionId?: string,
  nudgeAttempt?: number,
  nudgeReason?: CrashReason["kind"],
): NodeEvent {
  return {
    runId: R,
    state,
    scopePath: [],
    status: {
      phase: "running",
      attempt,
      startedAt: ts,
      lastHeartbeat: ts,
      agentSessionId,
      nudgeAttempt,
      nudgeReason,
    },
    timestamp: ts,
  };
}
function succeeded(state: string, ts: number, result: NodeResult = {}): NodeEvent {
  return { runId: R, state, scopePath: [], status: { phase: "succeeded", result }, timestamp: ts };
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
function failedEnd(result: NodeResult = {}): NodeEvent {
  return {
    runId: R,
    state: FAILED,
    scopePath: [],
    status: { phase: "failed", result },
    timestamp: 3000,
  };
}
function journalText(events: NodeEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

test("foldJournal on an empty journal returns the empty digest", () => {
  expect(foldJournal("")).toEqual({
    current: null,
    visits: {},
    runtimeMs: null,
    hasBegin: false,
    hasEnd: false,
  });
});

test("foldJournal on a succeeded journal detects begin/end, final node, visits, runtime", () => {
  const seed = { output: { message: "hi" } };
  const final = { output: "done" };
  const digest = foldJournal(
    journalText([begin(seed), running("S", 2000), succeeded("S", 2500, final), end(final)]),
  );
  expect(digest.hasBegin).toBe(true);
  expect(digest.hasEnd).toBe(true);
  expect(digest.seed).toEqual(seed);
  expect(digest.finalResult).toEqual(final);
  expect(digest.current).toEqual({ state: EXIT, phase: "succeeded" });
  expect(digest.visits).toEqual({ S: 1 });
  expect(digest.runtimeMs).toBe(3000 - 1000);
});

test("foldJournal on a crashed journal records the crash and no end marker", () => {
  const reason: CrashReason = { kind: "runner-error", error: "boom" };
  const digest = foldJournal(
    journalText([begin(), running("Solo", 2000), crashed("Solo", 2600, reason, 2)]),
  );
  expect(digest.hasBegin).toBe(true);
  expect(digest.hasEnd).toBe(false);
  expect(digest.current).toEqual({ state: "Solo", phase: "crashed" });
  expect(digest.crash).toEqual({ attempt: 2, reason });
  expect(digest.visits).toEqual({ Solo: 1 });
});

test("foldJournal on a FAILED-terminated journal detects hasEnd/finalResult, same as succeeded", () => {
  const final = { output: { kind: "stuck_signature" } };
  const digest = foldJournal(
    journalText([
      begin(),
      running("RunFailure", 2000),
      succeeded("RunFailure", 2500),
      failedEnd(final),
    ]),
  );
  expect(digest.hasBegin).toBe(true);
  expect(digest.hasEnd).toBe(true);
  expect(digest.finalResult).toEqual(final);
  expect(digest.current).toEqual({ state: FAILED, phase: "failed" });
});

test("foldJournal on a still-running journal shows the running node", () => {
  const digest = foldJournal(journalText([begin(), running("Write", 2000)]));
  expect(digest.current).toEqual({
    state: "Write",
    phase: "running",
    startedAt: 2000,
    lastHeartbeat: 2000,
  });
  expect(digest.hasEnd).toBe(false);
  expect(digest.visits).toEqual({ Write: 1 });
});

test("foldJournal surfaces a running node's agentSessionId, omits it when absent", () => {
  const withSession = foldJournal(journalText([begin(), running("Write", 2000, 1, "sess-123")]));
  expect(withSession.current).toEqual({
    state: "Write",
    phase: "running",
    startedAt: 2000,
    lastHeartbeat: 2000,
    agentSessionId: "sess-123",
  });

  const withoutSession = foldJournal(journalText([begin(), running("Write", 2000)]));
  expect(withoutSession.current?.agentSessionId).toBeUndefined();
});

test("foldJournal: heartbeats neither inflate visits nor reset liveness", () => {
  const digest = foldJournal(
    journalText([
      begin(),
      running("Write", 2000),
      running("Write", 2030), // heartbeat — same dispatch still open
      running("Write", 2060), // heartbeat
    ]),
  );
  expect(digest.visits).toEqual({ Write: 1 });
  expect(digest.current?.phase).toBe("running");
  expect(digest.current?.lastHeartbeat).toBe(2060);
  expect(digest.runtimeMs).toBe(2060 - 1000); // heartbeats advance the span
});

test("stallWarning fires only for a running node with stale heartbeats", () => {
  const NOW = 200_000;
  const stale = foldJournal(journalText([begin(), running("Write", 2000)]));
  // lastHeartbeat = 2000, now = 200_000 → far past the 90s stall window
  expect(stallWarning(stale, NOW)).toContain("stall suspected");
  const fresh = foldJournal(journalText([begin(), running("Write", NOW - 1000)]));
  expect(stallWarning(fresh, NOW)).toBeNull();
  const done = foldJournal(
    journalText([
      begin(),
      running("Write", 2000),
      {
        runId: R,
        state: "Write",
        scopePath: [],
        status: { phase: "succeeded", result: {} },
        timestamp: 3000,
      },
    ]),
  );
  expect(stallWarning(done, NOW)).toBeNull();
});

test("foldJournal surfaces a running node's nudgeAttempt/nudgeReason, omits them when absent", () => {
  const nudging = foldJournal(
    journalText([begin(), running("Write", 2000, 1, "sess-1", 2, "handoff-missing")]),
  );
  expect(nudging.current).toEqual({
    state: "Write",
    phase: "running",
    startedAt: 2000,
    lastHeartbeat: 2000,
    agentSessionId: "sess-1",
    nudgeAttempt: 2,
    nudgeReason: "handoff-missing",
  });

  const plain = foldJournal(journalText([begin(), running("Write", 2000)]));
  expect(plain.current?.nudgeAttempt).toBeUndefined();
  expect(plain.current?.nudgeReason).toBeUndefined();
});

function runningWithAgentProgress(
  state: string,
  heartbeatTs: number,
  agentStepCount: number,
  agentIdleMs: number,
): NodeEvent {
  return {
    runId: R,
    state,
    scopePath: [],
    status: {
      phase: "running",
      attempt: 1,
      startedAt: heartbeatTs,
      lastHeartbeat: heartbeatTs,
      agentStepCount,
      agentIdleMs,
    },
    timestamp: heartbeatTs,
  };
}

test("foldJournal surfaces a running node's agentStepCount/agentIdleMs, omits them when absent", () => {
  const withProgress = foldJournal(
    journalText([begin(), runningWithAgentProgress("Write", 2000, 5, 1200)]),
  );
  expect(withProgress.current?.agentStepCount).toBe(5);
  expect(withProgress.current?.agentIdleMs).toBe(1200);

  const plain = foldJournal(journalText([begin(), running("Write", 2000)]));
  expect(plain.current?.agentStepCount).toBeUndefined();
  expect(plain.current?.agentIdleMs).toBeUndefined();
});

test("agentStallWarning fires only once agent idle time (as of now) exceeds the threshold", () => {
  const NOW = 20 * 60_000; // 20 minutes
  // lastHeartbeat at t=0, agentIdleMs=1000 as of that heartbeat → live idle
  // is ~20 minutes by `now`, past the 15-minute default.
  const stale = foldJournal(journalText([begin(), runningWithAgentProgress("Write", 0, 3, 1000)]));
  const warning = agentStallWarning(stale, NOW);
  expect(warning).toContain("agent stall suspected");
  expect(warning).toContain("steps so far: 3");

  // Fresh heartbeat, same idle-as-of-heartbeat value → live idle is small.
  const fresh = foldJournal(
    journalText([begin(), runningWithAgentProgress("Write", NOW - 1000, 3, 1000)]),
  );
  expect(agentStallWarning(fresh, NOW)).toBeNull();
});

test("agentStallWarning never fires without agentIdleMs evidence (script dispatch, or no progress reported yet)", () => {
  const NOW = 20 * 60_000;
  const noProgress = foldJournal(journalText([begin(), running("Build", 0)]));
  expect(agentStallWarning(noProgress, NOW)).toBeNull();
});

test("nudgeWarning fires only for a running node with an active nudge", () => {
  const nudging = foldJournal(
    journalText([begin(), running("Write", 2000, 1, "sess-1", 2, "handoff-missing")]),
  );
  expect(nudgeWarning(nudging)).toBe("nudging attempt 2/3 (handoff-missing) — supervisor decides");

  const plain = foldJournal(journalText([begin(), running("Write", 2000)]));
  expect(nudgeWarning(plain)).toBeNull();

  const done = foldJournal(
    journalText([
      begin(),
      running("Write", 2000, 1, "sess-1", 2, "handoff-missing"),
      succeeded("Write", 2500, {}),
    ]),
  );
  expect(nudgeWarning(done)).toBeNull();
});

test("foldJournal counts distinct visits, not retry attempts", () => {
  // Write visited once (two attempts), then Test visited once
  const events = [
    begin(),
    running("Write", 1100, 1),
    running("Write", 1200, 2),
    succeeded("Write", 1300),
    running("Test", 1400, 1),
  ];
  const digest = foldJournal(journalText(events));
  expect(digest.visits).toEqual({ Write: 1, Test: 1 });
});

test("foldJournal tolerates a torn trailing line (parseEventLog skips it)", () => {
  const digest = foldJournal(`${journalText([begin(), running("S", 2000)])}\n{torn`);
  expect(digest.current).toEqual({
    state: "S",
    phase: "running",
    startedAt: 2000,
    lastHeartbeat: 2000,
  });
});

test("classifyTerminal: journal's last line is authoritative for succeeded/crashed", () => {
  expect(classifyTerminal(journalText([begin(), end()]), false)).toBe("succeeded");
  expect(classifyTerminal(journalText([begin(), end()]), true)).toBe("succeeded"); // PID state irrelevant
  expect(
    classifyTerminal(
      journalText([begin(), crashed("S", 2000, { kind: "timeout", elapsedMs: 1 })]),
      true,
    ),
  ).toBe("crashed");
});

test("classifyTerminal: a FAILED-tagged last line reads as failed, not crashed", () => {
  expect(
    classifyTerminal(journalText([begin(), succeeded("RunFailure", 2000), failedEnd()]), true),
  ).toBe("failed");
  expect(
    classifyTerminal(journalText([begin(), succeeded("RunFailure", 2000), failedEnd()]), false),
  ).toBe("failed"); // PID state irrelevant, same as succeeded/crashed
});

test("classifyTerminal: no terminal marker -> running if PID alive, else orphaned", () => {
  const notDone = journalText([begin(), running("S", 2000)]);
  expect(classifyTerminal(notDone, true)).toBe("running");
  expect(classifyTerminal(notDone, false)).toBe("orphaned");
  expect(classifyTerminal("", false)).toBe("orphaned"); // missing journal + dead PID
  expect(classifyTerminal("", true)).toBe("running");
});

describe("foldReport", () => {
  test("one dispatch row per running->terminal pair, attempt-normalized", () => {
    // Terminal journal events do NOT carry `attempt` — only running events do.
    // The fold must match them despite that (regression: rows were dropped).
    const journal = [
      {
        runId: "r",
        state: "[*]",
        scopePath: [],
        status: { phase: "succeeded", result: {} },
        timestamp: 0,
      },
      {
        runId: "r",
        state: "Implement",
        scopePath: [],
        status: { phase: "running", attempt: 1 },
        timestamp: 100,
      },
      {
        runId: "r",
        state: "Implement",
        scopePath: [],
        status: { phase: "succeeded", result: { event: "implemented" } },
        timestamp: 600,
      },
      {
        runId: "r",
        state: "Verify",
        scopePath: [],
        status: { phase: "running", attempt: 1 },
        timestamp: 600,
      },
      {
        runId: "r",
        state: "Verify",
        scopePath: [],
        status: { phase: "succeeded", result: { event: "green" } },
        timestamp: 1600,
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");

    const report = foldReport(journal);
    expect(report.spanMs).toBe(1600);
    expect(report.dispatches).toHaveLength(2);
    expect(report.dispatches[0]).toEqual({
      state: "Implement",
      durationMs: 500,
      phase: "succeeded",
      event: "implemented",
      reason: undefined,
    });
    expect(report.dispatches[1]).toEqual({
      state: "Verify",
      durationMs: 1000,
      phase: "succeeded",
      event: "green",
      reason: undefined,
    });
    expect(report.visits).toEqual({ Implement: 1, Verify: 1 });
  });

  test("a FAILED-tagged end marker is its own dispatch row, not silently dropped", () => {
    const journal = journalText([
      begin(),
      running("RunFailure", 100),
      succeeded("RunFailure", 600, { event: "gave_up" }),
      failedEnd({ event: "gave_up", output: { kind: "cap_exceeded" } }),
    ]);

    const report = foldReport(journal);
    expect(report.dispatches).toHaveLength(2);
    expect(report.dispatches[1]).toEqual({
      state: FAILED,
      durationMs: 0,
      phase: "failed",
      event: "gave_up",
    });
  });
});

describe("foldTaskList", () => {
  const LIST: TaskList = {
    id: "x",
    tasks: [
      { id: "T-1", title: "a", status: "done" },
      { id: "T-2", title: "b", status: "done" },
      { id: "T-3", title: "c", status: "in-progress" },
      { id: "T-4", title: "d", status: "pending" },
      { id: "T-5", title: "e", status: "failed" },
    ],
  };

  test("strict counts: done only; failed/pending/in-progress are all not-done", () => {
    expect(foldTaskList(LIST).done).toBe(2);
    expect(foldTaskList(LIST).total).toBe(5);
  });

  test("current is the file's in-progress task, null when nothing is in-progress", () => {
    expect(foldTaskList(LIST).current?.id).toBe("T-3");
    expect(
      foldTaskList({ id: "x", tasks: [{ id: "T-1", title: "a", status: "pending" }] }).current,
    ).toBeNull();
  });

  test("no stall when exactly one (or zero) task is in-progress", () => {
    expect(foldTaskList(LIST).stall).toBeNull();
    expect(foldTaskList({ id: "x", tasks: [] }).stall).toBeNull();
  });

  test("stall when the list names more than one current task", () => {
    const digest = foldTaskList({
      id: "x",
      tasks: [
        { id: "T-1", title: "a", status: "in-progress" },
        { id: "T-2", title: "b", status: "in-progress" },
      ],
    });
    expect(digest.stall).toContain("2 tasks in-progress");
    expect(digest.current?.id).toBe("T-1");
  });
});
