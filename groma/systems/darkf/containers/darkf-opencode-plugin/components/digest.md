---
type: C4 Component
title: Digest
status: stable
groma:
  id: digest
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/digest.ts
  group: Live state
description: Builds the plugin's UI view-models from a run's journal and task list, with no rendering of its own.
---

foldJournal/foldTaskList (from @psimona/darkf) produce PlanNode/PlanView/TaskListView and SupervisorStatus/SupervisorView; depends on darkf-core's buildRegistry/isComposite/parseTaskList to walk the same workflow structure the engine itself uses. Consumed by store.ts and read directly by sidebar.tsx and run-detail.tsx.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/digest.ts](../../../../../../darkf-opencode-plugin/src/digest.ts) | [darkf/src/exports.ts](../../../../../../darkf/src/exports.ts) | Reads journal digests | npm package import |
| [darkf-opencode-plugin/src/digest.ts](../../../../../../darkf-opencode-plugin/src/digest.ts) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Uses workflow types | npm package import |
