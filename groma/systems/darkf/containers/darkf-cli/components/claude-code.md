---
type: C4 Component
title: Claude code
status: stable
groma:
  id: claude-code
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/agents/claude-code.ts
  group: Agent adapters
  technology: Claude Code CLI
description: AgentRunner adapter that dispatches a workflow's agent steps to the Claude Code CLI.
---

Invokes Claude Code as a subprocess per dispatch and reads its result back through the handoff-file contract (handoff.ts). Mirrors the engine's own DEFAULT_TIMEOUT_MS so it can kill its own subprocess in step with the engine's timeout.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf/src/kit/agents/claude-code.ts](../../../../../../darkf/src/kit/agents/claude-code.ts) | [darkf/src/kit/agents/handoff.ts](../../../../../../darkf/src/kit/agents/handoff.ts) | Reads and writes handoffs | TypeScript import |
