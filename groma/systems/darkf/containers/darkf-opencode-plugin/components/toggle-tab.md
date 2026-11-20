---
type: C4 Component
title: Toggle tab
status: stable
groma:
  id: toggle-tab
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/toggle-tab.tsx
      symbol: ToggleTab
  group: Plugin shell
description: The shared 'df' badge rendered at both ends of the overlay toggle.
---

One component used by both the closed (prompt footer) and open (overlay dialog) states so the toggle reads as one button that flips state, not two visually different ones.
