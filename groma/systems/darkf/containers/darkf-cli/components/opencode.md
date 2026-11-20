---
type: C4 Component
title: Opencode
status: stable
groma:
  id: opencode
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/agents/opencode.ts
  group: Agent adapters
  technology: OpenCode
description: AgentRunner adapter that dispatches a workflow's agent steps to OpenCode.
---

Invokes OpenCode as a subprocess per dispatch and reads its result back through the handoff-file contract (handoff.ts), mirroring claude-code.ts's timeout handling for the same reason.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf/src/kit/agents/opencode.ts](../../../../../../darkf/src/kit/agents/opencode.ts) | [darkf/src/kit/agents/handoff.ts](../../../../../../darkf/src/kit/agents/handoff.ts) | Reads and writes handoffs | TypeScript import |
