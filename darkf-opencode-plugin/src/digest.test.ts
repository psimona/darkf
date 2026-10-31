import { describe, expect, test } from "bun:test";
import {
  type CrashReason,
  EXIT,
  type NodeEvent,
  type NodeResult,
  type WorkflowDef,
} from "@psimona/darkf/src/core/index.ts";
import { buildPlanView, buildTaskListView } from "./digest.ts";

// A small synthetic workflow, not darkf-cli's `series-ordering` example —
// deliberately: importing an example owned by a different package would be
// the exact reach-through-import pattern the repo's quality-scaffold spec
// flags as the one thing worth banning. This fixture has the one structural
// feature the ancestor-highlighting logic actually depends on — a leaf
// nested inside a composite — without that coupling.
const WORKFLOW: WorkflowDef = {
  initial: "Fix",
  states: {
    Fix: {
      initial: "Implement",
      states: {
        Implement: { type: "agent", prompt: "implement", on: { implemented: "Verify" } },
        Verify: { type: "script", file: "verify.ts", on: { green: "Review" } },
      },
    },
    Review: { type: "agent", prompt: "review", on: { done: EXIT } },
  },
};

const DUPLICATE_ID_WORKFLOW: WorkflowDef = {
  initial: "A",
  states: {
    A: {
      initial: "X",
      states: { X: { type: "agent", prompt: "x", on: { done: EXIT } } },
    },
    B: {
      initial: "X",
      states: { X: { type: "agent", prompt: "x again", on: { done: EXIT } } },
    },
  },
};

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
function running(state: string, scopePath: string[], ts: number, attempt = 1): NodeEvent {
  return {
    runId: R,
    state,
    scopePath,
    status: { phase: "running", attempt, startedAt: ts, lastHeartbeat: ts },
    timestamp: ts,
  };
}
function succeeded(
  state: string,
  scopePath: string[],
  ts: number,
  result: NodeResult = {},
): NodeEvent {
  return { runId: R, state, scopePath, status: { phase: "succeeded", result }, timestamp: ts };
}
function crashed(
  state: string,
  scopePath: string[],
  ts: number,
  reason: CrashReason,
  attempt = 1,
): NodeEvent {
  return {
    runId: R,
    state,
    scopePath,
    status: { phase: "crashed", reason, attempt },
    timestamp: ts,
  };
}
function journalText(events: NodeEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

describe("buildPlanView", () => {
  test("no journal events: nothing to highlight, not an error", () => {
    const view = buildPlanView(R, WORKFLOW, "");
    expect(view.workflowError).toBeUndefined();
    expect(view.current).toBeNull();
    const fix = view.root.find((n) => n.id === "Fix")!;
    expect(fix.active).toBe(false);
    expect(fix.kind).toBe("composite");
  });

  test("mid-run on a leaf inside a composite: leaf and its composite ancestor are both active", () => {
    const text = journalText([begin(), running("Implement", ["Fix"], 1500)]);
    const view = buildPlanView(R, WORKFLOW, text);

    const fix = view.root.find((n) => n.id === "Fix")!;
    expect(fix.active).toBe(true);
    const implement = fix.children!.find((n) => n.id === "Implement")!;
    expect(implement.active).toBe(true);
    expect(implement.isCurrentLeaf).toBe(true);
    const verify = fix.children!.find((n) => n.id === "Verify")!;
    expect(verify.active).toBe(false);
    const review = view.root.find((n) => n.id === "Review")!;
    expect(review.active).toBe(false);
  });

  test("finished successfully (journal ends on EXIT): nothing highlighted, not a crash", () => {
    const text = journalText([
      begin(),
      running("Implement", ["Fix"], 1500),
      succeeded("Implement", ["Fix"], 1600, { event: "implemented" }),
      running("Verify", ["Fix"], 1700),
      succeeded("Verify", ["Fix"], 1800, { event: "green" }),
      running("Review", [], 1900),
      succeeded("Review", [], 2000, { event: "done" }),
      end({ event: "done" }),
    ]);
    const view = buildPlanView(R, WORKFLOW, text);

    expect(view.current?.state).toBe(EXIT);
    expect(view.crash).toBeUndefined();
    for (const node of view.root) {
      expect(node.active).toBe(false);
    }
  });

  test("crashed leaf: crash digest surfaces, crashed leaf is still highlighted", () => {
    const reason: CrashReason = { kind: "timeout", elapsedMs: 60_000 };
    const text = journalText([
      begin(),
      running("Implement", ["Fix"], 1500),
      crashed("Implement", ["Fix"], 1600, reason),
    ]);
    const view = buildPlanView(R, WORKFLOW, text);

    expect(view.crash).toEqual({ attempt: 1, reason });
    const implement = view.root
      .find((n) => n.id === "Fix")!
      .children!.find((n) => n.id === "Implement")!;
    expect(implement.active).toBe(true);
  });

  test("supervisor overlay passes through untouched when present, absent when not given", () => {
    const text = journalText([begin(), running("Implement", ["Fix"], 1500)]);
    const withSupervisor = buildPlanView(R, WORKFLOW, text, {
      sessionID: "sess-1",
      status: { type: "busy" },
      lastMessage: "working on it",
    });
    expect(withSupervisor.supervisor?.sessionID).toBe("sess-1");

    const withoutSupervisor = buildPlanView(R, WORKFLOW, text);
    expect(withoutSupervisor.supervisor).toBeUndefined();
  });

  test("a broken workflow definition (duplicate state id) degrades to workflowError, not a throw — crash/current still computed from the journal", () => {
    const reason: CrashReason = { kind: "timeout", elapsedMs: 1000 };
    const text = journalText([
      begin(),
      running("X", ["A"], 1500),
      crashed("X", ["A"], 1600, reason),
    ]);
    expect(() => buildPlanView(R, DUPLICATE_ID_WORKFLOW, text)).not.toThrow();
    const view = buildPlanView(R, DUPLICATE_ID_WORKFLOW, text);
    expect(view.workflowError).toContain("X");
    expect(view.root).toEqual([]);
    expect(view.crash).toEqual({ attempt: 1, reason });
  });

  test("no workflow at all (registry entry has no workflowDir): no graph, darkf-only fields still computed", () => {
    const text = journalText([begin(), running("Implement", ["Fix"], 1500)]);
    const view = buildPlanView(R, undefined, text);
    expect(view.workflowError).toBeUndefined();
    expect(view.root).toEqual([]);
    expect(view.current?.state).toBe("Implement");
  });
});

describe("buildTaskListView", () => {
  const TASKS = JSON.stringify({
    id: "x",
    tasks: [
      { id: "T-1", title: "a", status: "done", satisfies: ["REQ-1"], priority: "must" },
      { id: "T-2", title: "b", status: "in-progress", satisfies: ["REQ-2"] },
      { id: "T-3", title: "c", status: "pending" },
      { id: "T-4", title: "d", status: "failed" },
    ],
  });

  test("no file (undefined text): absent — the state that hides the tasks tab", () => {
    expect(buildTaskListView(R, undefined)).toEqual({ runId: R, state: "absent" });
  });

  test("unparseable JSON: invalid, with the parse error", () => {
    const view = buildTaskListView(R, "{not json");
    expect(view.state).toBe("invalid");
    expect(view.state === "invalid" && view.error.length > 0).toBe(true);
  });

  test("valid JSON the validator rejects (bad status union): invalid, with the narrowing error", () => {
    const view = buildTaskListView(
      R,
      JSON.stringify({ id: "x", tasks: [{ id: "T-1", title: "a", status: "archived" }] }),
    );
    expect(view.state).toBe("invalid");
    expect(view.state === "invalid" && view.error).toContain("tasks[0].status");
  });

  test("valid: strict done/total, current straight from the file's in-progress status", () => {
    const view = buildTaskListView(R, TASKS);
    expect(view).toEqual({
      runId: R,
      state: "valid",
      tasks: [
        { id: "T-1", title: "a", status: "done", satisfies: ["REQ-1"], priority: "must" },
        { id: "T-2", title: "b", status: "in-progress", satisfies: ["REQ-2"] },
        { id: "T-3", title: "c", status: "pending" },
        { id: "T-4", title: "d", status: "failed" },
      ],
      done: 1,
      total: 4,
      current: { id: "T-2", title: "b", status: "in-progress", satisfies: ["REQ-2"] },
      stall: null,
    });
  });

  test("valid but ambiguous about the current task: the stall warning surfaces", () => {
    const view = buildTaskListView(
      R,
      JSON.stringify({
        id: "x",
        tasks: [
          { id: "T-1", title: "a", status: "in-progress" },
          { id: "T-2", title: "b", status: "in-progress" },
        ],
      }),
    );
    expect(view.state).toBe("valid");
    expect(view.state === "valid" && view.stall).toContain("2 tasks in-progress");
  });
});
