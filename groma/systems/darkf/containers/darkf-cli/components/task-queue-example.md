---
type: C4 Component
title: Task queue example
status: stable
groma:
  id: task-queue-example
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/examples/task-queue/workflow.ts
    - scanner: typescript
      file: darkf/examples/task-queue/scripts/next.ts
      symbol: next
    - scanner: typescript
      file: darkf/examples/task-queue/scripts/record.ts
      symbol: record
  group: Example workflows
description: Demo of a durable, disk-backed task queue a detached run can be re-entered from a different process.
---

The Next/Work/Record loop, like article-classifier, but tracks its queue in tasks.json on disk instead of in-memory module state, so the same run survives darkf start (detached) and a later process checking its status.
