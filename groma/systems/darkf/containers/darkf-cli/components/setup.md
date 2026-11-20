---
type: C4 Component
title: Setup
status: stable
groma:
  id: setup
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/cli/setup.ts
  group: CLI commands
description: Installs and syncs darkf's bundled agent skills into detected host tools.
---

darkf setup copies the packaged darkf-usage/darkf-writing-workflows skills (darkf/skills/) into every detected host (Claude Code, OpenCode, codex, gemini, cursor); darkf upgrade re-syncs them after an update. Every dependency arrives as an explicit deps object, so the whole module is testable without a real HOME or filesystem.
