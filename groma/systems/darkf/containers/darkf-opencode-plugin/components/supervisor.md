---
type: C4 Component
title: Supervisor
status: stable
groma:
  id: supervisor
  parent: darkf-opencode-plugin
  code:
    - scanner: typescript
      file: darkf-opencode-plugin/src/supervisor.ts
      symbol: supervisorViewFor
  group: Live state
description: Reads the bound supervisor session's own chat messages for the panel's status synopsis.
---

Fetches the host's synced message rows for the session locate.ts bound to this run, and extracts the last assistant message's text (truncated) as the synopsis shown in SupervisorPanel.
