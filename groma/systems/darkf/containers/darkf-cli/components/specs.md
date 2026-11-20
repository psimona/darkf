---
type: C4 Component
title: Specs
status: stable
groma:
  id: specs
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/specs.ts
  group: Kit
description: Typed model of the backplane spec-workspace format (docs/specs/).
---

Types every file the backplane spec convention names — one spec per folder under docs/specs/, a backlog.json, and a project.json for harness/sandbox defaults — and validators reject anything the format doesn't name, so a workflow importing this module sees the same shape the backplane itself enforces.
