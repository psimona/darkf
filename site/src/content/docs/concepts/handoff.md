---
title: Handoff
description: Data moves between nodes only by explicit choice.
---

darkf does not thread a shared, ever-growing key-value bag through
every node. A node receives only the immediately preceding node's full
result — the **handoff**. One hop. Nothing accumulated.

```ts
Write: { type: "script", file: "write.ts", next: "Test" }
```

`write.ts` gets `Plan`'s (or whichever node ran before it) `NodeResult`
as its only input.

If a value needs to survive past the very next node, some later node's
own code has to choose to re-emit it in its own `output`. Nothing rides
along for free.

```ts
export default function write(handoff: NodeResult): NodeResult {
  const writeAttempts = ((handoff.output as { writeAttempts?: number } | undefined)
    ?.writeAttempts ?? 0) + 1;
  return { output: { writeAttempts } };
}
```

Anything durable for the *whole run* — a goal, a repo path, config —
doesn't belong in this hop-to-hop channel at all.

It should be a real file instead. Every node is already arbitrary code
with normal filesystem access. the `article-classifier` example in `darkf/examples/`
shows the pattern: a script module (`scripts/queue.ts`) keeps run-scoped
state on disk, rather than threading it through handoffs.

## DispatchInfo

A leaf also receives a `DispatchInfo` alongside the handoff:

```ts
export interface DispatchInfo {
  runId: string;
  validEvents: string[];
  hasFallback: boolean;
  attempt: number;
  sessionId?: string;
  previousFailure?: CrashReason;
  step: number;
  rootDir: string;
}
```

| Field | Required | What it is |
|---|---|---|
| `runId` | Yes | This run's id. |
| `validEvents` | Yes | Derived straight from this state's own `on` keys — the events it can route on. |
| `hasFallback` | Yes | Whether `next` is also set, meaning the node may omit `event` entirely and still route. |
| `attempt` | Yes | Which attempt of this dispatch is in flight — `1` the first time. |
| `sessionId` | No | Only present once a prior attempt's own `NodeResult` returned one. |
| `previousFailure` | No | Only present on a retry — the [`CrashReason`](../failure-modes/) that rejected the attempt before this one. |
| `step` | Yes | The engine's own step counter for this node's current visit, constant across every retry attempt of that visit. |
| `rootDir` | Yes | The run's root directory — the base a runner resolves its own `.darkf/run/<runId>/...` paths against. |

`step` plus `rootDir` plus `runId` is what a runner needs to compute a
deterministic path under `.darkf/run/<runId>/...` for its own
artifacts. No in-memory visit map of its own required.

## What's needed, what's handled

Your own code decides, every single time, what belongs in `output` for
the next node to see. darkf never infers this. A value not re-emitted
this hop simply isn't there next hop — even a value the node itself
just received.

Everything else is automatic. Whatever a leaf returns (or an agent
runner parses out of a reply) becomes exactly the next leaf's `handoff`
argument. No copying, filtering, or merging in between. That's true
whether the hop crosses an `agent`→`script` boundary, a `script`→`agent`
one, or either into a composite's first child.

`DispatchInfo` is automatic too. `step`/`attempt`/`runId` are the
engine's own bookkeeping. `validEvents`/`hasFallback` are derived
straight from that state's own `on`/`next` — nothing to redeclare.
`sessionId`/`previousFailure` only appear once a retry has actually
happened.

The gap in between is deliberate. Anything durable for the whole run
has no handoff-shaped answer, on purpose. That's what the file-on-disk
escape hatch above is for — and why `DispatchInfo.rootDir` is handed to
every node, not just the ones that look like they'll need it.
