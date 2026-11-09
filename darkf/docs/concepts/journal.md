---
title: Journal
description: The one durable, authoritative record of a run.
---

Every run writes an unconditional, append-only JSONL journal to
`.darkf/run/<runId>/journal.jsonl`. One line per transition of any
node's execution machine, at any depth: a dispatch starting, a retry
re-entering `running`, a terminal `succeeded`/`crashed`.

Each line is one `NodeEvent`:

```ts
export interface NodeEvent {
  runId: string;
  state: string;
  scopePath: string[];
  status: NodeStatus;
  timestamp: number;
}
```

| Field | Required | What it is |
|---|---|---|
| `runId` | Yes | Which run this line belongs to. |
| `state` | Yes | The id of the node whose transition this line records. |
| `scopePath` | Yes | The chain of enclosing composite ids, outermost first — empty at the top level. |
| `status` | Yes | A [`NodeStatus`](../failure-modes/) — `pending`, `running`, `succeeded`, or `crashed`, with that phase's own payload. |
| `timestamp` | Yes | When this transition was written. |

Every field here is required — a journal line never omits one. What
varies line to line is only the shape nested inside `status`.

The journal always opens with a begin marker — the run's seed input. On
success, it closes with an end marker — the final `NodeResult`. Both
are tagged with the engine's `EXIT` sentinel.

A crash writes no end marker. The crashing leaf's own `crashed` line is
the file's last line. That asymmetry is deliberate: the file alone
answers "did it finish, and how," with no separate state to go stale.

This is why darkf's CLI commands — `status`, `monitor`, `report` — all
read the journal directly, rather than querying a live process. `darkf
status` classifies a run as `succeeded`, `crashed`, `orphaned` (the
worker PID is gone and the journal has no terminal marker), or
`running`, purely from the journal plus a liveness check on the
recorded PID. Nothing comes from in-memory state of its own.

```sh
bunx darkf status
```

```
run: 7e1c9b2a-...
root: /path/to/your/project
state: succeeded
visits: {"Write":1,"Test":1,"Review":1}
runtime: 4.2s
```

A detached run (`darkf start`) and an in-process run (`darkf run`)
write the exact same journal shape. The only difference is whether the
caller blocks on it. See [Run detached and monitor it](../../guides/run-detached-and-monitor/).

## What's automatic, and what you'd still add

Nothing is needed from a workflow author. The journal isn't a feature
you opt into. Every run writes one, unconditionally, whether or not
anything ever reads it back. There's no flag that turns it off, and no
per-state configuration that changes what gets logged.

darkf writes three things to it without being asked:

- Every phase transition of every node, at every depth. Not just
  leaves — a composite's own `running`/`succeeded` lines are in there
  too.
- A **heartbeat** every 30 seconds, for any dispatch still `running`.
  It updates `lastHeartbeat` on that same line's status. This is what
  lets `darkf status` tell "still working" apart from "silently
  stuck," without asking the worker process anything.
- A **usage sidecar** (`.darkf/run/<runId>/usage/<step>-<nodeId>.json`)
  for every agent dispatch — cost and token counts. It's written next
  to the journal, not into it, since usage is telemetry about a
  dispatch, deliberately kept out of the `NodeResult` data flow
  `on`/`next` route on.

The journal is deliberately not a queryable database. Reading it back
for anything beyond what `status`/`monitor`/`report` already show —
say, a dashboard of every `Classify` outcome across a run — means
writing that read yourself. `parseEventLog` from `@psimona/darkf/src/core` is the
function to start from; it's the same one those commands use
internally.
