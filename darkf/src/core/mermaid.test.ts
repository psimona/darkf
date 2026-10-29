import { expect, test } from "bun:test";
import { renderMermaid } from "./mermaid.ts";
import { DONE, FAILED, type WorkflowDef } from "./types.ts";

test("renderMermaid maps DONE to mermaid's own end pseudostate", () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: DONE } } },
  };
  const out = renderMermaid(workflow);
  expect(out).toContain("Solo --> [*] : ok");
  expect(out).not.toContain("FAILED");
});

test("renderMermaid gives FAILED a real, styled node instead of the literal '[-]' token", () => {
  const workflow: WorkflowDef = {
    initial: "RunFailure",
    states: { RunFailure: { type: "script", file: "run_failure.ts", on: { gave_up: FAILED } } },
  };
  const out = renderMermaid(workflow);
  expect(out).not.toContain("[-]");
  expect(out).toContain("RunFailure --> FAILED : gave_up");
  expect(out).toContain("FAILED : ✗ failed");
  expect(out).toContain("class FAILED darkfFailed");
});

test("renderMermaid omits the FAILED node entirely when no edge targets it", () => {
  const workflow: WorkflowDef = {
    initial: "Solo",
    states: { Solo: { type: "script", file: "solo.ts", on: { ok: DONE } } },
  };
  const out = renderMermaid(workflow);
  expect(out).not.toContain("darkfFailed");
});
