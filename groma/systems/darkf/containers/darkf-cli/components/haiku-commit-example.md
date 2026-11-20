---
type: C4 Component
title: Haiku commit example
status: stable
groma:
  id: haiku-commit-example
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/examples/haiku-commit/workflow.ts
    - scanner: typescript
      file: darkf/examples/haiku-commit/scripts/check.ts
      symbol: check
  group: Example workflows
description: 'The Quickstart demo: an agent writes a haiku to README.md, a script verifies and commits it.'
---

One real Claude Code dispatch per attempt (Write), then a script (Check) decides what actually happened by reading the file rather than trusting the agent's reported event, looping back to Write if the haiku is missing.
