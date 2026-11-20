---
type: C4 Component
title: Workflows tab
status: stable
groma:
  id: workflows-tab
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/workflows-tab.tsx
    - scanner: typescript
      file: darkf-opencode-plugin/src/workflow-graph.ts
  group: Overlay
description: 'The workflows tab: a catalog of known workflow definitions, each shown as its full static state graph.'
---

Lists workflows via listWorkflows (@psimona/darkf's shared discovery), then builds each one's node/edge tree (its own workflow-graph logic, combined here) by walking the same StateDef edges darkf-core's mermaid renderer walks — but kept as a tree instead of a Mermaid string, since the TUI renders it directly rather than reusing a diagram string.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/workflows-tab.tsx](../../../../../../darkf-opencode-plugin/src/workflows-tab.tsx) | [darkf/src/exports.ts](../../../../../../darkf/src/exports.ts) | Discovers workflows | npm package import |
| [darkf-opencode-plugin/src/workflows-tab.tsx](../../../../../../darkf-opencode-plugin/src/workflows-tab.tsx) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Walks workflow graphs | npm package import |
