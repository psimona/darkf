---
type: C4 Component
title: Summary
status: stable
groma:
  id: summary
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/summary.ts
      symbol: summaryLine
  group: Live state
description: The one-line run-status vocabulary shared between the band and the runs tab.
---

Formats a run's current state using the same vocabulary darkf status/darkf monitor already use, so the plugin never invents a second way to say what state a run is in. A plain module (not .tsx) so it unit-tests without rendering.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/summary.ts](../../../../../../darkf-opencode-plugin/src/summary.ts) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Uses the exit sentinel | npm package import |
