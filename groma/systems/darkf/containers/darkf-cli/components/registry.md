---
type: C4 Component
title: Registry
status: stable
groma:
  id: registry
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/registry.ts
  group: Kit
description: Tracks detached runs so a later process can find and check on them.
---

Reads and writes the run registry file, recording each detached run's status (running/succeeded/failed/crashed/failed-start) as a best-effort cache a worker updates on completion; the journal, not the registry, is the actual source of truth for a run's outcome.
