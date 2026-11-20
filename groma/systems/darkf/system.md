---
type: C4 System
title: darkf
status: stable
groma:
  id: darkf
description: Deterministic automation engine for LLM agent + script state-graph workflows.
---

darkf runs automation as a typed state graph in TypeScript (a workflow): some steps dispatch an AI agent, some run plain code, and the engine journals every step to disk so a run's outcome is always readable from disk rather than a terminal. On a failure the run stops at the failing step (jidoka) instead of letting an agent continue on broken state.

The project ships three pieces: the darkf-cli container (the published @psimona/darkf npm package: CLI, engine, and workflow model, plus the example and dogfood workflows that exercise it), the darkf-opencode-plugin container (a terminal UI for the OpenCode editor that visualizes live and past runs), and the site container (the public documentation site).
