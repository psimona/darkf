---
type: C4 Component
title: CLI entry
status: stable
groma:
  id: cli-index
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/cli/index.ts
  group: CLI commands
description: The darkf CLI's entry point and command dispatch.
---

The package's bin (darkf). Wires up the subcommands (run/start/validate/status/monitor/render and more) on top of the engine and kit, handling detached runs, workflow discovery, and process lifecycle for the CLI surface a user or an agent harness invokes.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [darkf/src/cli/index.ts](../../../../../../darkf/src/cli/index.ts) | [darkf/src/engine/index.ts](../../../../../../darkf/src/engine/index.ts) | Starts and resumes runs | TypeScript import |
| [darkf/src/cli/index.ts](../../../../../../darkf/src/cli/index.ts) | [darkf/src/kit/registry.ts](../../../../../../darkf/src/kit/registry.ts) | Tracks detached runs | TypeScript import |
| [darkf/src/cli/index.ts](../../../../../../darkf/src/cli/index.ts) | [darkf/src/kit/status.ts](../../../../../../darkf/src/kit/status.ts) | Reports run status | TypeScript import |
| [darkf/src/cli/index.ts](../../../../../../darkf/src/cli/index.ts) | [darkf/src/core/index.ts](../../../../../../darkf/src/core/index.ts) | Uses workflow types | TypeScript import |
