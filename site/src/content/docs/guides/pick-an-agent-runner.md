---
title: Pick an agent runner
description: The two built-in AgentRunner adapters, and the contract they implement.
---

Any `agent` state needs a workflow-supplied `AgentRunner`:

```ts
export interface AgentRunner {
  kind?: string;
  run(id: string, def: AgentStateDef, handoff: NodeResult, info: DispatchInfo): Promise<NodeResult>;
}
```

darkf ships two concrete adapters in @psimona/darkf/src/kit/agents/`.

### `claudeCodeRunner`

Shells out to the `claude` CLI. Builds a prompt from the state's `prompt`,
the handoff, and the set of valid events, writes a handoff-file contract
the agent is instructed to fill in, and reads that file back as the
`NodeResult`. Reuses the CLI's own `session_id` across retries via
`sessionId` so a repair turn resumes context instead of starting cold.

```ts
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";

export const agentRunner = claudeCodeRunner;
```

### `opencodeRunner`

Shells out to the `opencode` CLI (`opencode run -m <provider/model>
--format json`) — useful for pointing a workflow at any model OpenCode
supports, including a self-hosted one. Same handoff-file contract as
`claudeCodeRunner`. Parses OpenCode's NDJSON output stream and surfaces a
turn's finish reason (`stop`, `tool-calls`, `length`) directly in a crash,
rather than letting a silently-incomplete turn look like a clean exit with
a missing handoff file.

```ts
import { opencodeRunner } from "@psimona/darkf/src/kit/agents/opencode.ts";

export const agentRunner = opencodeRunner;
```

### Writing your own

Both adapters follow the same two moves: build a prompt that includes the
handoff and the valid events, then read back a result the harness wrote
somewhere durable. A third harness (pi, codex, or anything else with a
headless CLI or API) implements the same `AgentRunner` interface — nothing
in core or engine is specific to either shipped adapter.

For demos and tests, skip a real harness entirely — a plain object
satisfying `AgentRunner` is enough, as the `haiku-readme` example's stub
runner shows (see [Quickstart](../../start-here/quickstart/)).
