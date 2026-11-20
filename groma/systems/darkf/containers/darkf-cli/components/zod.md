---
type: C4 Component
title: Zod
status: stable
groma:
  id: zod
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/validation/zod.ts
      symbol: zodOutputType
  group: Kit
  technology: Zod
description: Adapts a Zod schema to the engine's agent-output validation interface.
---

zodOutputType wraps a Zod schema as an OutputSchema (AgentStateDef.outputType), joining every failed-parse issue into one message so a single retry nudge can name every failing field at once.
