---
type: C4 Component
title: Overlay
status: stable
groma:
  id: overlay
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/overlay.tsx
  group: Overlay
description: 'The expandable overlay dialog: hosts the runs and workflows tabs.'
---

Opened/closed by toggle.tsx (openOverlay/closeOverlay are module-level since both ends of the toggle call them). Composes RunsTabContent (run-detail.tsx) and WorkflowsTab behind its own tab switcher.
