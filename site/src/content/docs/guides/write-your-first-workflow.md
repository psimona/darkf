---
title: Write your first workflow
description: The minimum shape darkf needs to run.
---

A workflow is a directory containing a `workflow.ts` that exports a
`WorkflowDef`, plus a `scripts/` directory holding anything your `script`
states reference.

```ts
// darkf/my-workflow/workflow.ts
import { EXIT, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";

export const workflow: WorkflowDef = {
  initial: "Greet",
  states: {
    Greet: {
      type: "script",
      file: "greet.ts",
      next: EXIT,
    },
  },
};
```

```ts
// darkf/my-workflow/scripts/greet.ts
import type { NodeResult } from "@psimona/darkf/src/core/index.ts";

export default function greet(handoff: NodeResult): NodeResult {
  return { output: { greeting: "hello" } };
}
```

`darkf/` (no dot) is where this lives in your project — commit it like any
other source. It's a different directory from `.darkf/` (dot-prefixed),
which darkf writes its own run artifacts into (journal, handoff files,
registry) and which you gitignore wholesale.

Render it before running anything — this catches unresolved targets and
duplicate ids without spending an agent call:

```sh
bunx darkf render my-workflow
```

Run it:

```sh
bunx darkf run my-workflow
```

A workflow module can also export `input` (the seed `NodeResult` for the
first dispatch), `agentRunner` (required if any state is `type: "agent"`),
and `scriptRunner` (optional — only needed if a script needs run-aware
`DispatchInfo`, not just the plain handoff).

### Adding an agent state

An `agent` state needs a `prompt` and a configured `agentRunner`:

```ts
Greet: {
  type: "agent",
  prompt: "Write a one-sentence greeting.",
  on: { done: EXIT },
},
```

```ts
export const agentRunner: AgentRunner = claudeCodeRunner; // or opencodeRunner
```

See [Pick an agent runner](../pick-an-agent-runner/) for the two
built-in options.

### Branching and retrying

- `on: { eventName: "NextState" }` routes by the event a node's result
  carries; `next: "NextState"` is the unconditional shorthand for a node
  that always has exactly one way forward.
- `retries: 2` on a leaf bounds reattempts after a crash (default: 0, no
  retry).
- `timeoutMs` caps one dispatch attempt (default: 1 hour).
- `validate(result, handoff)` runs a plain code check against a result
  before it's accepted as `succeeded`; returning a string rejects it as a
  crash, consuming a retry attempt exactly like a runner throwing would.

There is no condition-expression or YAML config layer here on purpose — see
the repo's `PHILOSOPHY.md` for why. Anything more conditional than a plain
`on` map belongs in a script's own code.
