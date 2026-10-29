import { type AgentRunner, DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";

let reviewCalls = 0;

export const agentRunner: AgentRunner = {
  async run(id) {
    if (id === "Plan") return { event: "approved" };
    // Review
    reviewCalls++;
    return { event: reviewCalls === 1 ? "changes_requested" : "done" };
  },
};

export const workflow: WorkflowDef = {
  initial: "Plan",
  states: {
    Plan: {
      type: "agent",
      // The goal is a durable fact about this workflow, not per-run data —
      // it belongs in the prompt an author wrote, not in a data channel.
      prompt: "Plan the change needed to add a haiku to the README.",
      on: { approved: "Implement" },
    },
    Implement: {
      initial: "Write",
      states: {
        Write: { type: "script", file: "write.ts", next: "Test" },
        Test: {
          type: "script",
          file: "test.ts",
          on: { passed: "Review", failed: "Write" },
        },
      },
    },
    Review: {
      type: "agent",
      prompt: "Review the implementation against the goal.",
      on: { done: DONE, changes_requested: "Write" },
    },
  },
};
