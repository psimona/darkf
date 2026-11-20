---
type: C4 Component
title: Runs tab
status: stable
groma:
  id: runs-tab
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/runs-tab.tsx
  group: Overlay
description: 'The runs tab''s list: every known run with its date, title, and live status.'
---

Lists runs from the registry (RegistryEntry), using locate.ts's picker ordering to rank them; selecting one switches the overlay to run-detail.tsx's two-pane view.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/runs-tab.tsx](../../../../../../darkf-opencode-plugin/src/runs-tab.tsx) | [darkf/src/exports.ts](../../../../../../darkf/src/exports.ts) | Reads run registry | npm package import |
