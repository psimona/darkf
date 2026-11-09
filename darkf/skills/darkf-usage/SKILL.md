---
name: darkf-usage
description: Use when starting, monitoring, or inspecting a darkf workflow run, checking whether a run is stuck, or reading a run report or journal
---

# Using darkf

## Overview

darkf runs a TypeScript workflow graph. It dispatches AI agents (Claude Code or opencode) against a target repo. Each run detaches from your terminal and writes a journal. One rule governs everything: run darkf from the target repo, never from the darkf checkout.

## The cwd rule

`rootDir` is the run-artifact root and the agent working directory. It is the invocation cwd. Start every run from the repo the agents will edit. `darkf validate <ref>` fails when run inside the darkf checkout. It catches the wrong-directory mistake before you waste a run.

## Quick reference

| Task | Command (from the target repo) |
|---|---|
| Preflight | `darkf validate <ref>` |
| List visible workflows | `darkf workflows` |
| Start a detached run | `darkf start <ref> "message"` |
| Run in foreground | `darkf run <ref> "message"` |
| One-shot status | `darkf status` (add `--run <id>` for a specific run) |
| Live tail | `darkf monitor --window 120` |
| Efficacy report | `darkf report` (add `--run <id>` for a specific run) |
| Show the graph | `darkf render <ref>` |

- `<ref>` resolves in order: a path, then `<cwd>/darkf/<ref>` (project workspace), then workflows shipped with darkf.
- There is no `--help` flag. Bare `darkf` is an error.
- There is no `resume` command. Resume semantics belong to each workflow. Check the journal and `git log` first. Never re-implement finished work by hand.
- `start` prints `{"runId":...,"pid":...}` and returns. The message is positional argument 2.
- `start` and `run` refuse to start when `darkf/` has uncommitted changes. Commit or stash first, or pass `--allow-dirty-workflow`.

## Exit codes

Exit codes for `status`. `monitor` shares most of them:

| Code | `status` says | `monitor` says |
|---|---|---|
| 0 | succeeded | succeeded |
| 1 | crashed | crashed |
| 2 | orphaned | orphaned |
| 3 | running | failed |
| 4 | failed | host-died |
| 5 | host-died | failed-start |
| 6 | failed-start | window elapsed, run still going |
| 7 | no run | no run |

A wrong `--run <id>` also exits 4. Multiple cached `running` entries make `status` exit 5 and ask for `--run <id>`.

## Run artifacts

Everything lands under the target repo:

- `.darkf/run/<runId>/journal.jsonl` is the event log. The journal is authoritative. The registry is only a pointer.
- `.darkf/run/<runId>/usage/` holds per-dispatch cost and token sidecars.
- `.darkf/registry/<runId>.json` is a pointer entry (runId, pid, rootDir).

Add `.darkf/` to the target repo `.gitignore`.

## Is the run alive?

Open dispatches write a heartbeat to the journal every 30 seconds. `darkf status` shows advancing `elapsed` for the open node.

- No heartbeat for more than 90 seconds → status prints `warn: stall suspected`. The warning only informs.
- Worker process gone and no terminal journal marker → status reports `orphaned` (exit 2). The outcome is unknown. Re-run.
- Journal ends with a terminal marker → `succeeded` (exit 0) or `crashed` (exit 1). The pid state does not matter.

`darkf report` shows per-dispatch spans, a visit histogram, and usage totals. Four or more visits to one state hints at a cycle.

## After launch

The run detaches. Watching is your job.

- Tail with `darkf monitor --window 120`. One-shot with `darkf status`. A silent 10 minutes is normal. Trust the heartbeat.
- Stay with the run until it reaches a terminal state.
- A terminal state is not a shipped feature. `succeeded` means the graph completed. What happened lives in the event of the last dispatch: `darkf report --run <id>`.
- Any event routed to `DONE` ends the run with exit 0. Whether an event means shipped, stopped, or a human gate is the decision of the workflow, recorded in its `on` routes.
- `darkf report` needs `--run <id>` for a finished run. The `runId` is in the `start` output and in `.darkf/registry/`.

## Gotchas

- A workflow may hardcode spec paths in its prompts. Read the workflow first. Check that those paths still exist in the target repo.
- Check git history first. A workflow will re-implement work that already shipped.
- The `start` message is only a label for some workflows. Check the prompts.
- Agents run for minutes per dispatch. A silent 10 minutes is normal. Trust the heartbeat, not the silence.
- The journal is authoritative. If cached registry state and the journal disagree, trust the journal. Delete nothing by hand.

## Deep reference

The darkf package ships its full docs. Find the package: `readlink -f "$(which darkf)"`. Start at `docs/guides/run-detached-and-monitor.md` inside that directory.
