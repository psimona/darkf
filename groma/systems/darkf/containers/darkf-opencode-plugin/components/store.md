---
type: C4 Component
title: Store
status: stable
groma:
  id: store
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/store.ts
  group: Live state
description: 'The plugin''s central reactive state: watches a run''s journal and tasks.json and holds the derived view models.'
---

Watches the on-disk files (node:fs watch) for the bound run, rebuilds digest.ts's PlanView/TaskListView on change, and exposes them as SolidJS signals (LiveStore) that every UI component reads. Also caches loaded workflow definitions for workflows-tab.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/store.ts](../../../../../../darkf-opencode-plugin/src/store.ts) | [darkf/src/exports.ts](../../../../../../darkf/src/exports.ts) | Reads journal path, registry | npm package import |
| [darkf-opencode-plugin/src/store.ts](../../../../../../darkf-opencode-plugin/src/store.ts) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Uses workflow types | npm package import |
