---
type: C4 Component
title: Band
status: stable
groma:
  id: band
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/band.tsx
      symbol: registerBand
  group: Plugin shell
description: The always-visible compact status row in the prompt footer.
---

Shows one line of run status (via summary.ts's shared status vocabulary) when a run is live, and renders nothing otherwise.
