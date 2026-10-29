import { expect, test } from "bun:test";
import { buildRegistry, validateWorkflow } from "./graph.ts";
import { DONE, EXIT, FAILED, type WorkflowDef } from "./types.ts";

function registryFor(workflow: WorkflowDef) {
  return buildRegistry(workflow);
}

test("reports no errors for a well-formed workflow", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { type: "script", file: "a.ts", next: "B" },
      B: { type: "agent", prompt: "b", on: { ok: DONE, bad: FAILED } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([]);
});

test("flags an unresolved top-level initial, with from: null", () => {
  const workflow: WorkflowDef = {
    initial: "Nope",
    states: { A: { type: "script", file: "a.ts", next: DONE } },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "unresolved-target", from: null, target: "Nope" },
  ]);
});

test("flags an unresolved leaf on/next target", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: { A: { type: "script", file: "a.ts", on: { ok: "Missing" }, next: "AlsoMissing" } },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "unresolved-target", from: "A", target: "Missing" },
    { kind: "unresolved-target", from: "A", target: "AlsoMissing" },
  ]);
});

test("flags an unresolved composite initial", () => {
  const workflow: WorkflowDef = {
    initial: "Outer",
    states: {
      Outer: { initial: "Missing", states: { Leaf: { type: "script", file: "l.ts", next: DONE } } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "unresolved-target", from: "Outer", target: "Missing" },
  ]);
});

test("DONE/FAILED/deprecated-EXIT-alias are valid leaf on/next targets", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { type: "script", file: "a.ts", on: { ok: DONE, bad: FAILED, legacy: EXIT } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([]);
});

test("DONE/FAILED are never valid as a top-level initial", () => {
  const states: WorkflowDef["states"] = { A: { type: "script", file: "a.ts", next: DONE } };

  expect(validateWorkflow(registryFor({ initial: DONE, states }), DONE)).toEqual([
    { kind: "unresolved-target", from: null, target: DONE },
  ]);
  expect(validateWorkflow(registryFor({ initial: FAILED, states }), FAILED)).toEqual([
    { kind: "unresolved-target", from: null, target: FAILED },
  ]);
});

test("DONE/FAILED are never valid as a composite initial", () => {
  const workflow: WorkflowDef = {
    initial: "Outer",
    states: {
      Outer: { initial: FAILED, states: { Leaf: { type: "script", file: "l.ts", next: DONE } } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "unresolved-target", from: "Outer", target: FAILED },
  ]);
});

test("flags a dead-end leaf with neither on nor next", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: { A: { type: "script", file: "a.ts" } },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "dead-end-leaf", state: "A" },
  ]);
});

test("an empty on map with no next is still a dead-end leaf", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: { A: { type: "script", file: "a.ts", on: {} } },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "dead-end-leaf", state: "A" },
  ]);
});

test("finds a two-composite initial cycle exactly once, regardless of which feeder it's discovered from", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { initial: "B", states: { LeafA: { type: "script", file: "l.ts", next: DONE } } },
      B: { initial: "A", states: { LeafB: { type: "script", file: "l.ts", next: DONE } } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "initial-cycle", cycle: ["A", "B"] },
  ]);
});

test("finds a self-referential composite initial cycle", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: { A: { initial: "A", states: { Leaf: { type: "script", file: "l.ts", next: DONE } } } },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "initial-cycle", cycle: ["A"] },
  ]);
});

test("a cycle mid-chain that resolves to an unresolved id reports unresolved-target, not a cycle", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { initial: "B", states: { LeafA: { type: "script", file: "l.ts", next: DONE } } },
      B: { initial: "Missing", states: { LeafB: { type: "script", file: "l.ts", next: DONE } } },
    },
  };

  expect(validateWorkflow(registryFor(workflow), workflow.initial)).toEqual([
    { kind: "unresolved-target", from: "B", target: "Missing" },
  ]);
});

test("collects every problem in one pass instead of stopping at the first", () => {
  const workflow: WorkflowDef = {
    initial: "A",
    states: {
      A: { type: "script", file: "a.ts", next: "Missing1" },
      B: { type: "script", file: "b.ts" }, // dead-end
      Loop: { initial: "Loop", states: { Leaf: { type: "script", file: "l.ts", next: DONE } } },
    },
  };

  const errors = validateWorkflow(registryFor(workflow), workflow.initial);
  expect(errors).toEqual(
    expect.arrayContaining([
      { kind: "unresolved-target", from: "A", target: "Missing1" },
      { kind: "dead-end-leaf", state: "B" },
      { kind: "initial-cycle", cycle: ["Loop"] },
    ]),
  );
  expect(errors.length).toBe(3);
});
