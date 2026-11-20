---
type: C4 Component
title: Handoff
status: stable
groma:
  id: handoff
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/agents/handoff.ts
  group: Agent adapters
description: The harness-agnostic half of the agent-handoff file contract.
---

Defines the handoff file's path convention (.darkf/run/<runId>/handoff/<step>-<nodeId>.json) and shared read/write helpers. Each per-harness runner (claude-code.ts, opencode.ts) owns everything harness-specific: invocation, native structured output vs. prompt fallback, session id, and subprocess lifecycle.
