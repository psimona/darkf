---
type: C4 Container
title: darkf
status: stable
groma:
  id: darkf-cli
  parent: darkf
  technology: TypeScript, Bun
description: 'The published @psimona/darkf npm package: the darkf CLI, its workflow engine, and the agent/script runners workflows dispatch to.'
---

Bun/TypeScript. Ships as the npm package @psimona/darkf (bin: darkf). Holds the CLI commands, the workflow state-graph model (types, graph validation, journal parsing, mermaid rendering, task-list parsing), the run engine, the kit (agent-runner adapters for Claude Code and OpenCode, the handoff-file contract, the run registry, run status/digest logic, and a Zod output-schema adapter), and the workflow definitions that exercise all of it: user-facing examples under darkf/examples/ (not published) and the project's own dogfood workflows under darkf/workflows/ (published as reference templates).
