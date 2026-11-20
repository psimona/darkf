---
type: C4 Component
title: Sidebar
status: stable
groma:
  id: sidebar
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/sidebar.tsx
      symbol: registerSidebar
  group: Overlay
description: An always-visible sidebar showing the active run's plan tree.
---

Flattens digest.ts's PlanNode tree into rows with depth-based indent and an agent/script icon per node, independent of whether the overlay is open.
