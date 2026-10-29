---
title: Failure modes
description: A mechanism failure is never confused with a workflow outcome.
---

Every node's execution goes through one lifecycle. It's used recursively
at every depth: a single leaf dispatch, a composite's currently-active
descendant, and the whole run's terminal outcome are all "a node
executing."

```ts
export type NodeStatus =
  | { phase: "pending" }
  | { phase: "running"; attempt: number; startedAt: number; lastHeartbeat: number; sessionId?: string }
  | { phase: "succeeded"; result: NodeResult }
  | { phase: "crashed"; reason: CrashReason; attempt: number };
```

`pending` carries nothing. `succeeded` carries one required field,
`result`. The other two phases carry more than one field each, and not
all of them are required:

| Phase | Field | Required | What it is |
|---|---|---|---|
| `running` | `attempt` | Yes | Which attempt number is in flight — `1` for the first try. |
| `running` | `startedAt` | Yes | Timestamp this attempt began. |
| `running` | `lastHeartbeat` | Yes | Timestamp of the latest heartbeat, updated every 30s. |
| `running` | `sessionId` | No | Only present once some earlier attempt's runner returned one. |
| `crashed` | `reason` | Yes | A `CrashReason` — which of the nine shapes below. |
| `crashed` | `attempt` | Yes | Which attempt number crashed. |

A **crash** means the mechanism itself failed. It doesn't mean the
workflow reached a bad outcome on purpose.

```ts
export type CrashReason =
  | { kind: "runner-error"; error: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "malformed-result" }
  | { kind: "validation-failed"; message: string }
  | { kind: "no-transition"; state: string; event?: string }
  | { kind: "unresolved-target"; from: string; target: string }
  | { kind: "duplicate-id"; id: string }
  | { kind: "max-steps"; steps: number; state: string }
  | { kind: "cycle-limit"; composite: string; cycles: number };
```

Every variant's `kind` is required — it's the discriminant. The rest
of each variant's payload is required too, with one exception:

| Kind | Payload | What it means |
|---|---|---|
| `runner-error` | `error` (required) | A runner itself threw. |
| `timeout` | `elapsedMs` (required) | The dispatch outran its `timeoutMs`. |
| `malformed-result` | none | The reply didn't parse as a well-formed `NodeResult`. |
| `validation-failed` | `message` (required) | The state's `validate` returned a rejection string. |
| `no-transition` | `state` (required), `event` (optional) | Nothing in `on`/`next` matched the returned event — `event` is absent if the result didn't carry one either. |
| `unresolved-target` | `from` (required), `target` (required) | An edge named a state id that doesn't exist anywhere in the workflow. |
| `duplicate-id` | `id` (required) | `buildRegistry` found two states sharing an id. |
| `max-steps` | `steps` (required), `state` (required) | The engine-wide `maxSteps` backstop tripped. |
| `cycle-limit` | `composite` (required), `cycles` (required) | A composite's own `maxCycles` tripped. |

A runner that throws, times out, returns something malformed, or fails
its state's `validate` hook produces a crash. It never produces a
routed transition.

Crashes never reach the routing layer. They're never confused with a
workflow-modeled outcome, like `{ event: "rejected" }`. Both are real
answers a node can produce — only one of them means the mechanism
itself failed.

This separation is why a workflow author can model "the reviewer
rejected the change" as a normal `on: { rejected: "Write" }` edge.
"The reviewer's CLI process hung for an hour," meanwhile, surfaces as a
`timeout` crash — not a silent-looking rejection.

## How failures propagate

Three independent bounds catch three different failure shapes. Each
one escalates to the next when it doesn't apply.

**`retries`** (default 0, per leaf) bounds reattempts of *one
dispatch*. A crash consumes an attempt — `maxAttempts = retries + 1`.
Once attempts run out, the leaf's crash becomes the run's crash.

**`maxCycles`** (per composite, opt-in) bounds a *multi-leaf loop*: two
nodes handing back and forth indefinitely, never tripping any single
dispatch's timeout or retry count. Each full pass through the composite
counts as one cycle. Exceeding it is a `cycle-limit` crash, naming the
composite.

**`maxSteps`** (engine-wide, default 1000) is the unconditional
backstop. Any run, any shape — dispatching past this many steps total
crashes with `max-steps`, naming the state it was on.

A crash never retries itself into a transition. Either a bound is
exhausted and the run ends with a terminal `crashed` status, or a
bound still has budget and the *same* leaf is dispatched again from
scratch — not resumed. The next attempt's `DispatchInfo.previousFailure`
carries what went wrong, so an agent runner can tell the model what to
fix.

## What you observe

None of this requires watching a live process. `darkf status`,
`monitor`, and `report` all read the journal. A crash looks the same
whether you're watching live or looking at a finished run's history.

**A terminal crash.** `darkf status` exits `1` and prints `crash:
attempt=<n> reason=<CrashReason>` directly — the same tagged object
shown above, not a prose guess at what went wrong.

**A stall, not yet a crash.** A dispatch still `running`, whose
heartbeat (written every 30s by a live worker) has gone quiet for more
than 90 seconds, prints a `warn: stall suspected ...` line. This is
deliberately warn-only: darkf doesn't kill or restart anything itself,
since "gone quiet" and "about to finish" look identical from the
journal alone. Deciding what to do about it is the job of whatever is
watching — see [Plan with a task queue](../../guides/plan-with-a-task-queue/)'s
supervisor section.

**A thrash, not (yet) a `cycle-limit` crash.** If one state's visit
count is the run's highest and reaches 4 or more, `status` prints a
`warn:` suggesting a review/thrash loop, and points at wrapping it in a
composite with `maxCycles`. A run can still be healthy at 6 visits — a
legitimate back-and-forth. Nothing stops it short of `maxCycles` or
`maxSteps` if it isn't.

**The full history.** `darkf report` lists every crash reason that
occurred across the whole run, not just the terminal one. Useful once
retries are involved — an attempt that eventually succeeded still
crashed once on the way.
