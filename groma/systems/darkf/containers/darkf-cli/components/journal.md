---
type: C4 Component
title: Journal
status: stable
groma:
  id: journal
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/core/journal.ts
      symbol: parseEventLog
  group: Workflow model
description: Parses a run's JSONL event log back into NodeEvents.
---

Pure and synchronous, no filesystem access, so callers (the engine when resuming, or a UI reading a file's text directly) can fetch the journal's bytes themselves. Tolerates a torn trailing line from a process that crashed mid-append.
