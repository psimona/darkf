---
type: C4 Component
title: Tasks
status: stable
groma:
  id: tasks
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/core/tasks.ts
      symbol: parseTaskList
  group: Workflow model
description: Hand-written parser that narrows unknown JSON into a validated TaskList.
---

Zero dependencies, no legacy-shape tolerance: a malformed task list becomes an explicit { error } result rather than a crash. Shared by the engine's own item-loop dispatch path and the OpenCode plugin, so both read exactly the same validated shape.
