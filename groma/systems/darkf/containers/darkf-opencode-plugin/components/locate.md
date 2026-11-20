---
type: C4 Component
title: Locate
status: stable
groma:
  id: locate
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/locate.ts
  group: Live state
description: Determines which chat session is 'the supervisor' driving a given run, and orders runs for the picker.
---

Binds a run to its supervisor session on first detection and never rebinds (in-memory only; losing the binding on a plugin reload is an acceptable, cheap degradation since this plugin is observational by design). Also classifies and orders runs for the runs-tab picker.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf-opencode-plugin/src/locate.ts](../../../../../../darkf-opencode-plugin/src/locate.ts) | [darkf/src/exports.ts](../../../../../../darkf/src/exports.ts) | Reads run registry | npm package import |
