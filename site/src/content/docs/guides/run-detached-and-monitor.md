---
title: Run detached and monitor it
description: Start a long-running workflow in the background, then watch it.
---

`darkf run` blocks until the workflow finishes — fine for a quick demo,
not for a workflow that runs longer than you want to keep a terminal open.
`darkf start` launches the same workflow as a detached worker that
survives the launching process exiting, and returns immediately.

```sh
bunx darkf start my-workflow "optional seed message"
```

```json
{"runId":"7e1c9b2a-...","pid":48213}
```

If the worker dies during its own startup (bad import, missing workflow
export), `start` catches that and reports failure instead of leaving a
stale "running" entry behind.

### Checking in

```sh
bunx darkf status
```

Reads the journal directly — no connection to the worker process is
needed. Exit code doubles as the answer: `0` succeeded, `1` crashed, `2`
orphaned (worker PID is gone, journal has no terminal marker), `3`
running. Pass `--run <runId>` when more than one run is live.

### Watching live

```sh
bunx darkf monitor --window 60
```

Tails the journal and prints each transition as it's written, for up to
`--window` seconds (default 30) before returning `6` ("still running") so
a calling script can decide whether to keep waiting. `--once` checks and
returns immediately instead of polling. Exit codes match `status`'s.

### After it's done

```sh
bunx darkf report
```

Prints a timeline of every dispatch (state, duration, outcome), visit
counts, any crash reasons, and — if any agent dispatch wrote a usage
sidecar — a token/cost summary. Useful after the fact, whether the run
succeeded or crashed.

### Before any of this

```sh
bunx darkf doctor my-workflow
```

Checks that the workflow resolves, that `workflow.ts` loads and exports
`workflow` (and `agentRunner`, if any state needs one), that the `claude`
and `opencode` binaries are on `PATH`, and that you're not accidentally
running from inside the darkf checkout itself (a workflow's agent runner
uses the invocation `cwd` as its working directory — a common mistake
when first wiring a workflow against another repo).
