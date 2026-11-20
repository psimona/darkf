---
type: C4 Component
title: Plugin entry
status: stable
groma:
  id: tui
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/tui.tsx
  group: Plugin shell
description: 'The plugin''s entry point: wires up the band, overlay, sidebar, store, and prompt toggle.'
---

Plugin.define's setup registers every UI piece against the OpenCode TUI's plugin context and starts the live store that feeds them all.
