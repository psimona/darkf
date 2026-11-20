---
type: C4 Component
title: Status
status: stable
groma:
  id: status
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/kit/status.ts
  group: Kit
description: Builds a run's live status digest from its journal and task list.
---

JournalDigest reports the run's current state, phase, and heartbeat; stallWarning flags a dispatch that has gone quiet. Shared by the CLI's status/monitor output and the OpenCode plugin's digest.ts, so both report the same notion of 'what state is this run in.'
