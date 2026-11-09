---
name: darkf-writing-workflows
description: Use when authoring or editing a darkf workflow.ts state graph of agent, script, and composite states, especially to bound implement-verify-review loops, design events, or wire agent runners and the handoff contract
---

# Writing darkf Workflows

## Overview

A darkf workflow is a TypeScript module. It exports a state graph. `agent` states dispatch an AI agent. `script` states run TypeScript. `composite` states nest subgraphs. Put deterministic checks in scripts. Reserve agent states for judgment.

Shipped workflows live in `workflows/` inside the darkf package. Find the package: `readlink -f "$(which darkf)"`. Treat them as examples. Check any example against the bounded-loops rule before you copy its shape.

## Bounded loops: the critical rule

Every state that can route backward must live inside ONE composite. `maxCycles` counts leaf dispatches per continuous pass. It resets when execution re-enters the composite. A composite `Fix{Implement,Verify}` with `Review` outside it has no cycle cap. `changes_requested → Implement` re-enters `Fix` and clears the counter. Put Implement, Verify, and Review inside one composite.

- `maxCycles` counts dispatches, not cycles. 15 means five rounds of three states.
- `retries` do not consume the cycle budget. Give every agent and script state `retries: 1`. A transient spawn failure then costs one attempt, not the run.
- An event with no matching `on` route is a terminal `no-transition` crash. Cover every declared event.

## Skeleton

```ts
import { EXIT, type AgentRunner, type WorkflowDef } from "/abs/path/to/darkf/src/core/index.ts";
import { claudeCodeRunner } from "/abs/path/to/darkf/src/kit/agents/claude-code.ts";

export const agentRunner: AgentRunner = claudeCodeRunner;

export const workflow: WorkflowDef = {
  initial: "Loop",
  states: {
    Loop: {
      initial: "Implement",
      // maxCycles counts dispatches: rounds = maxCycles / states-per-round.
      // Budget above your expected worst case. Legitimate review loops can
      // exceed 5 rounds; a tight budget trips the breaker mid-run.
      maxCycles: 24,
      states: {
        Implement: {
          type: "agent", retries: 1, prompt: IMPL,
          on: { implemented: "Verify", disputed: EXIT, blocked: EXIT },
        },
        Verify: {
          // Review only sees Verify output. Relay what Implement reported:
          // return { event: "green", output: { implemented: handoff.output } }
          type: "script", file: "verify.ts", retries: 1,
          on: { green: "Review", red: "Implement", blocked: EXIT },
        },
        Review: {
          type: "agent", retries: 1, prompt: REVIEW,
          on: { done: EXIT, changes_requested: "Implement" },
        },
      },
    },
  },
};
```

## Imports

Workflows outside the darkf package use absolute paths into the package, as in the skeleton. A target repo with `@psimona/darkf` as a dependency can import the package name instead: `@psimona/darkf/src/core/index.ts`. Other bare imports do not resolve through node_modules from other directories.

## Runners and the handoff contract

- Use the built-in runners (`claudeCodeRunner`, `opencodeRunner` from `src/kit/agents/`). Never parse agent stdout. The runner injects the event contract into the prompt and reads the handoff JSON file the agent writes.
- The handoff contains only the immediate predecessor result. If Verify must report what Implement did, Verify must relay it in its own output. Nothing carries forward unless each node re-emits it.
- Do not ask the agent to echo events in prose. Describe the event semantics. The runner appends the mechanics.

## Scripts

A script default export receives `(handoff, info)` and returns a `NodeResult`. `info.rootDir` is the invocation cwd (the target repo). Use it for every repo path so the workflow stays location-independent. `file:` resolves against `<workflow-dir>/scripts/`, not the workflow dir.

## Event design

Keep event sets small and semantic: `implemented`/`blocked`, `green`/`red`, `done`/`changes_requested`. Use `EXIT` for terminal human gates. A crash is not a verdict. A blocked agent is not a crash either: exit cleanly and let a human re-enter.

### The `disputed` event

Give the implementer a reserved `disputed` event. When a review demand contradicts the spec, the implementer objects and routes `disputed → EXIT`. The demand and a spec-grounded rationale go in `output`. The run ends with the disagreement recorded for a human. Compliance must never be the only path.

## Review prompts

Agent-authored extra files are invisible to `git diff`. Every review prompt must say: inspect `git status --porcelain` in addition to `git diff`.

## Verify before you run

From the target repo: `darkf validate <ref>`, then `darkf render <ref>`. The packaged guide is the long form: `docs/guides/write-your-first-workflow.md` inside the darkf package.
