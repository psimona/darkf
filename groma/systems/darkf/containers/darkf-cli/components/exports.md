---
type: C4 Component
title: Exports
status: stable
groma:
  id: exports
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/exports.ts
description: The package's public library entry point (package.json main/types).
---

Re-exports listWorkflows (workflow discovery, shared with the CLI's own run/render scan) plus the kit's registry, specs, and status modules — the surface other code imports as @psimona/darkf, as opposed to the CLI binary or a deep src/... import.
