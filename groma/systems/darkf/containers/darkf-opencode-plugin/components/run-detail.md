---
type: C4 Component
title: Run detail view
status: stable
groma:
  id: run-detail
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/run-detail.tsx
    - scanner: typescript
      file: darkf-opencode-plugin/src/run-view.tsx
  group: Overlay
description: 'The runs tab''s detail view for one selected run: plan graph, task list, and supervisor synopsis.'
---

A two-pane layout: PlanGraph (the live plan tree, active node highlighted) and TaskPane (the tasks.json rows) on one side, SupervisorPanel (status plus the supervisor session's last-message synopsis) on the other. These building blocks were split out of overlay.tsx for size, not for independent responsibility, so they're combined with their composing view here.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/run-view.tsx](../../../../../../darkf-opencode-plugin/src/run-view.tsx) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Uses task types | npm package import |
