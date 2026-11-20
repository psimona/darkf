---
type: C4 Component
title: Toggle
status: stable
groma:
  id: toggle
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/toggle.tsx
      symbol: registerPromptToggle
  group: Plugin shell
description: The closed-state half of the overlay toggle, in the prompt footer's corner.
---

Opens the overlay (openOverlay) and resolves which run belongs to the current session, so toggling from a given chat session opens that session's run.
