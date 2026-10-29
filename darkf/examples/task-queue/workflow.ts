import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";

// The durable-queue version of the Next/Work/Record loop: article-classifier
// (../article-classifier) tracks its queue in in-memory module state, fine
// for a single blocking `darkf run`. This one tracks it in tasks.json on
// disk instead, so the same run survives being detached (`darkf start`) and
// re-entered by a different process checking status.
export const agentRunner = claudeCodeRunner;

export const workflow: WorkflowDef = {
  initial: "Next",
  states: {
    Next: {
      type: "script",
      file: "next.ts",
      on: { found: "Work", empty: DONE },
    },
    Work: {
      type: "agent",
      prompt:
        'Do the task named in the handoff\'s "title" field: append one ' +
        "sentence to notes.md describing what you did, creating the file " +
        "if it doesn't exist yet. Don't overwrite what's already there.",
      next: "Record",
    },
    Record: {
      type: "script",
      file: "record.ts",
      next: "Next",
    },
  },
};
