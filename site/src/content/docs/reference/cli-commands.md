---
title: CLI commands
description: Every darkf subcommand, its arguments, and its exit codes.
---

All commands take a workflow reference as their directory argument: a
filesystem path, or a bare name resolved against
`<cwd>/darkf/<name>` first, then `<darkf>/workflows/<name>`.

`darkf/` (no dot) is where your own workflow config lives — commit it.
`.darkf/` (dot-prefixed) is a different directory entirely: darkf's own
runtime/run-storage, gitignore it wholesale.

### `darkf render <dir>`

Prints the workflow's mermaid `stateDiagram-v2` to stdout. Never executes
anything.

### `darkf run <dir> [message]`

Runs the workflow in-process, blocking until it finishes. `message`
overrides the workflow module's own `input` export, becoming
`{ output: { message } }` for the first dispatch. Prints each dispatch's
event, the final status, and the journal path. Writes `.darkf/last-run.mmd`.

### `darkf start <dir> [message]`

Launches the workflow as a detached worker (survives the launching
process exiting) and returns immediately. Prints `{"runId", "pid"}` as
JSON. Exits `1` if the worker dies during its own startup.

### `darkf status [--run <runId>]`

Reads the journal for the given run and prints a digest: current node,
visit counts, any crash reason, elapsed/runtime. Without `--run`, resolves
to whichever run is currently cached as `running` — once a run has
finished, pass its id explicitly (exit `7`, "nothing to monitor", names
the most recent finished run as a hint if omitted).

| Exit code | Meaning |
|---|---|
| `0` | succeeded |
| `1` | crashed |
| `2` | orphaned — worker PID gone, journal has no terminal marker |
| `3` | running |
| `4` | no such run for the given `--run` |
| `5` | ambiguous — multiple runs cached as running; pass `--run` |
| `7` | nothing to monitor |

### `darkf monitor [--run <runId>] [--window <seconds>] [--once]`

Tails the journal, printing each new transition as it's written, until the
run finishes, `--window` elapses (default 30s), or `--once` is set.
Returns `6` ("still running") if the window elapses or `--once` is passed
without the run finishing; otherwise the same exit codes as `status`.

### `darkf report [--run <runId>]`

Prints a full dispatch timeline (state, duration, outcome per step), visit
counts, crash reasons, and a token/cost summary if any agent dispatch
wrote a usage sidecar. Works on any resolvable run, finished or not — but,
like `status`, needs `--run <runId>` once that run is no longer cached as
`running`.

### `darkf doctor <workflow-ref>`

Pre-flight checks: the workflow resolves, `workflow.ts` loads, it exports
`workflow` and (if needed) `agentRunner`, the `claude`/`opencode` binaries
are on `PATH`, the current working directory isn't inside the darkf
checkout itself, and it's inside a git repo (every run's artifacts live
under `.darkf/` in whatever directory you invoke from — this catches
running from somewhere that isn't actually a project). Exits `0` if every
check passes, `1` otherwise.

### `darkf workflows`

Lists every workflow darkf can resolve by bare name, from both
`<cwd>/darkf/` and the darkf package's own `workflows/`,
tagged `workspace` or `built-in`.
