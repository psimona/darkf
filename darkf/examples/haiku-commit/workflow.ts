import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";

// A real LLM call, not a stub — the docs site's Quickstart example. One
// cheap agent dispatch per attempt, so the cost is trivial; see
// docs/specs/docs-site/spec.md.
export const agentRunner = claudeCodeRunner;

export const workflow: WorkflowDef = {
  initial: "Write",
  states: {
    Write: {
      type: "agent",
      prompt:
        "Add a haiku about darkf to README.md, wrapped in HTML comments " +
        "<!-- haiku:start --> and <!-- haiku:end --> on their own lines, " +
        "so an automated check can find it.",
      // Unconditional: Check decides what actually happened by reading the
      // file, not by trusting whatever event the agent reports.
      next: "Check",
    },
    Check: {
      type: "script",
      file: "check.ts",
      on: { committed: DONE, missing: "Write" },
    },
  },
};
