---
type: C4 Component
title: Engine
status: stable
groma:
  id: engine
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/engine/run.ts
    - scanner: typescript
      file: darkf/src/engine/index.ts
    - scanner: typescript
      file: darkf/src/engine/eventLog.ts
      symbol: createJsonlEventLogger
  group: Workflow model
description: 'Executes a workflow run: dispatches each state in turn and appends every step to the run''s event log.'
---

run.ts drives one run from its initial state to DONE/FAILED, calling the workflow's agent or script runner for each state and advancing on the event it returns; eventLog.ts appends each NodeEvent to the run's JSONL journal as it happens. index.ts is the module's public re-export surface, imported by the CLI to start and resume runs.
