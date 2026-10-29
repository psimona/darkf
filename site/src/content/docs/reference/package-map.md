---
title: Package map
description: What each package and source folder is responsible for.
---

darkf ships two packages:

- **`@psimona/darkf`** — everything a workflow author or the `darkf` binary
  needs (npm publishes the unscoped `darkf` name as blocked).
  One package, four source folders under `src/`, laid out as one strict
  dependency chain:
  - **`core/`** — the shared vocabulary: `types.ts` (every type on this
    site's [Core types](../core-types/) page), `graph.ts`
    (registry-building and target resolution), `mermaid.ts` (render-only,
    never parsed back), `journal.ts` (the JSONL event shape). Zero
    runtime dependencies — nothing it depends on, by design.
  - **`engine/`** — the interpreter. `run.ts` is the dispatch loop:
    retries, per-attempt timeouts, the `validate` hook, cycle-limit and
    `maxSteps` circuit breakers, unconditional journaling. Depends only
    on `core/`.
  - **`kit/`** — the workflow-authoring library: the two built-in
    `AgentRunner` adapters (`claudeCodeRunner`, `opencodeRunner`), the
    handoff contract, and the run registry/status helpers behind
    [CLI commands](../cli-commands/). Depends on `core/` and `engine/`.
  - **`cli/`** — the `darkf` binary itself. Depends on all three.
- **`darkf-opencode-plugin`** — an OpenCode TUI integration (a live pane
  showing run status inside the OpenCode editor). Its own package,
  because its peer dependencies (`@opencode-ai/plugin`, `@opentui/*`,
  `solid-js`) are real and optional — no other consumer needs them.

A dependency-cruiser rule enforces the one-way chain
`core → engine → kit → cli` in CI; `core/` can never import any of its
own consumers, and `engine/` can never import the harness.
