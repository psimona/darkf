import { describe, expect, test } from "bun:test";
import { DONE, FAILED, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { buildWorkflowGraph } from "./workflow-graph.ts";

// A small synthetic workflow, not a bundled example — deliberately: importing
// an example owned by a different package would be the exact
// reach-through-import pattern the repo's quality-scaffold spec flags (same
// reason digest.test.ts builds its own fixture). This one exercises every
// shape the walk handles: `on` edges to a state, to DONE, and to FAILED; a
// `next` fallback (to a sentinel and to a state, one crossing a composite
// boundary); a composite with nested states; a leaf with no transitions at
// all; and an edge to a state id that doesn't exist.
const WORKFLOW: WorkflowDef = {
  initial: "Begin",
  states: {
    Begin: {
      type: "script",
      file: "begin.ts",
      on: { started: "Lane", branch_failed: DONE },
      next: FAILED,
    },
    Lane: {
      initial: "Do",
      states: {
        Do: { type: "agent", prompt: "do", on: { done: "Check" }, next: "Begin" },
        Check: { type: "script", file: "check.ts", on: { ok: "MarkDone" } },
        MarkDone: { type: "script", file: "mark.ts", on: { marked: "Begin" } },
      },
    },
    LooseEnd: { type: "agent", prompt: "no transitions" },
    Broken: { type: "script", file: "broken.ts", on: { gone: "Nowhere" } },
  },
};

function nodeById(graph: ReturnType<typeof buildWorkflowGraph>, id: string) {
  return graph.nodes.find((n) => n.id === id)!;
}

describe("buildWorkflowGraph", () => {
  test("root initial surfaces; every root state appears, declaration order preserved", () => {
    const graph = buildWorkflowGraph(WORKFLOW);
    expect(graph.initial).toBe("Begin");
    expect(graph.nodes.map((n) => n.id)).toEqual(["Begin", "Lane", "LooseEnd", "Broken"]);
  });

  test("`on` edges keep declaration order; DONE/FAILED become terminal targets, not state ids; `next` fallback is last and eventless", () => {
    const begin = nodeById(buildWorkflowGraph(WORKFLOW), "Begin");
    expect(begin.kind).toBe("script");
    expect(begin.edges).toEqual([
      { event: "started", target: { kind: "state", id: "Lane" } },
      { event: "branch_failed", target: { kind: "done" } },
      { target: { kind: "failed" } },
    ]);
  });

  test("composites nest children with their initial and own no edges; leaves carry the transitions", () => {
    const graph = buildWorkflowGraph(WORKFLOW);
    const lane = nodeById(graph, "Lane");
    expect(lane.kind).toBe("composite");
    expect(lane.initial).toBe("Do");
    expect(lane.edges).toEqual([]);
    expect(lane.children!.map((n) => n.id)).toEqual(["Do", "Check", "MarkDone"]);
    // A boundary-crossing edge lives on the leaf that owns it (MarkDone →
    // the root-level Begin), never hoisted onto the composite.
    const markDone = lane.children!.find((n) => n.id === "MarkDone")!;
    expect(markDone.edges).toEqual([{ event: "marked", target: { kind: "state", id: "Begin" } }]);
  });

  test("a leaf inside a composite: `on` edge then the `next` fallback, which may cross the boundary", () => {
    const doNode = nodeById(buildWorkflowGraph(WORKFLOW), "Lane").children!.find(
      (n) => n.id === "Do",
    )!;
    expect(doNode.kind).toBe("agent");
    expect(doNode.edges).toEqual([
      { event: "done", target: { kind: "state", id: "Check" } },
      { target: { kind: "state", id: "Begin" } },
    ]);
  });

  test("a leaf with no `on` and no `next` still appears, with no edges", () => {
    const looseEnd = nodeById(buildWorkflowGraph(WORKFLOW), "LooseEnd");
    expect(looseEnd.kind).toBe("agent");
    expect(looseEnd.edges).toEqual([]);
  });

  test("targets are recorded as written — an unresolved state id stays a state target (validation is buildRegistry's job)", () => {
    const broken = nodeById(buildWorkflowGraph(WORKFLOW), "Broken");
    expect(broken.edges).toEqual([{ event: "gone", target: { kind: "state", id: "Nowhere" } }]);
  });

  test("pure: the same definition walks to an equal tree every time", () => {
    expect(buildWorkflowGraph(WORKFLOW)).toEqual(buildWorkflowGraph(WORKFLOW));
  });
});
