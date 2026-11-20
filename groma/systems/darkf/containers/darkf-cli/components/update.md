---
type: C4 Component
title: Update
status: stable
groma:
  id: update
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/cli/update.ts
  group: CLI commands
description: Checks for and applies darkf CLI version updates.
---

A daily startup version check plus the darkf upgrade command. Every dependency arrives via an UpdateDeps object, so the module runs in tests without network access, a real clock, or a real package manager.

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf/src/cli/update.ts](../../../../../../darkf/src/cli/update.ts) | [darkf/src/cli/index.ts](../../../../../../darkf/src/cli/index.ts) | Invokes supplied callback: now | typescript |
