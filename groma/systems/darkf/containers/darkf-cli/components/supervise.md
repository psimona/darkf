---
type: C4 Component
title: Task queue supervisor
status: stable
groma:
  id: supervise
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/examples/task-queue/supervise.ts
  group: Example workflows
description: A minimal standalone supervisor for the task-queue example's detached run.
---

Starts the workflow via darkf start, then polls and reacts to conditions darkf monitor only warns about (a stalled or orphaned worker) instead of leaving a human to notice. Demonstrates the 'supervisor' role darkf's own CLI output already assumes exists; an agent harness invoking darkf start directly is a supervisor too, which darkf detects via SUPERVISOR_ENV_SIGNALS so a UI like the OpenCode plugin can show which session is driving a run.
