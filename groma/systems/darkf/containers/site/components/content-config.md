---
type: C4 Component
title: Content config
status: stable
groma:
  id: content-config
  parent: site
  code:
    - scanner: typescript
      file: site/src/content.config.ts
      symbol: collections
description: Points Starlight's docs collection at the package's shipped docs instead of a site-local copy.
---

Defines the docs content collection with a glob loader rebased to darkf/docs/ (the same directory npm ships inside @psimona/darkf), using Starlight's own docsSchema.
