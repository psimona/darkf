---
type: C4 Component
title: Mermaid
status: stable
groma:
  id: mermaid
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/core/mermaid.ts
  group: Workflow model
description: Renders a WorkflowDef as a Mermaid stateDiagram-v2 string.
---

Walks the same composite/edge structure graph.ts exposes and draws agent vs script nodes with distinct icons and colors, so every workflow stays visible as a diagram without a separate manual drawing to keep in sync.
