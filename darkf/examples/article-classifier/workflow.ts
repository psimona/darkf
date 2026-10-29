import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";

// Real LLM calls, one per article in data/articles.ts (6 by default) — this
// example is the one demo actually wired to claudeCodeRunner. See
// docs/specs/_built/agent-handoff/spec.md.
export const agentRunner = claudeCodeRunner;

export const workflow: WorkflowDef = {
  initial: "Loop",
  states: {
    Loop: {
      initial: "Next",
      // Safety net for the whole Next/Classify/Record cycle, not a tuning
      // knob: 6 articles x 3 leaf dispatches each + the final "done" check
      // is 19 in the normal case, so 30 never trips unless something is
      // actually stuck flapping.
      maxCycles: 30,
      states: {
        Next: {
          type: "script",
          file: "next.ts",
          on: { have_item: "Classify", done: DONE },
        },
        Classify: {
          type: "agent",
          prompt: "Classify the topic of the given article.",
          retries: 1,
          on: {
            tech: "Record",
            science: "Record",
            business: "Record",
            other: "Record",
          },
        },
        Record: {
          type: "script",
          file: "record.ts",
          next: "Next",
        },
      },
    },
  },
};
