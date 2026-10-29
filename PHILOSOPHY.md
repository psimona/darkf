# Philosophy

Principles that have steered darkf's design so far. Treat these as load-bearing —
when a new feature request seems to want an exception, check here first.

## Simplicity, not options — customizability with code

darkf offers few configuration knobs. Where behavior needs to vary, the answer
is "write code" (a runner, a `validate` function, a script), not a new flag,
DSL, or expression language on the definition side. Rejected repeatedly on
this basis: condition-expression edges, YAML/notes-based node config,
automatic retryable-vs-deterministic error classification, XState as the
interpreter (too much statechart machinery for too little node vocabulary).

## Two node types, one dispatch contract

Every leaf is either `agent` (prompt + config) or `script` (a function). Both
are dispatched through the same shape: a runner receives `(id, def, handoff,
info)` and returns a `NodeResult`. The engine does not know or care which kind
produced a result — routing, retries, validation, and journaling treat them
identically. Composites are pure organizational nesting with no transitions
of their own; state ids are global, so any edge can target any state anywhere
in the tree directly, with no "bubble the label to the parent scope"
indirection.

## Crash is not a verdict

A node's own execution lifecycle (`pending → running → succeeded | crashed`)
is one shape, used recursively at every depth — a leaf dispatch, a composite's
active descendant, and the whole run's terminal outcome are all "a node
executing." A crash (runner threw, timed out, returned malformed output,
failed validation, exceeded retries or a cycle limit) never reaches the
routing layer and is never confused with a workflow-modeled outcome like
`{ event: "rejected" }`. Both are real answers a node can produce; only one
of them means the mechanism itself failed.

## No global, accumulating context — data moves by explicit choice

darkf does not thread a shared, ever-growing key-value bag through every
node. That shape recreates, inside the engine, the exact problem that
decomposing a job into discrete nodes exists to avoid: unbounded input.
Instead, a node receives only the immediately preceding node's full result
(`handoff`) — one hop, nothing accumulated. If a node's output needs to
survive past its immediate successor, some later node's own code has to
choose to carry it forward by re-emitting it. Nothing rides along for free.

Anything durable for the whole run — a goal, a repo path, config — does not
belong in this hop-to-hop channel at all. It should be a real file any node
can read directly, since every node is already arbitrary code with normal
filesystem access. The workflow designer makes this choice explicitly, node
by node: relay it, or make it an artifact.

This is a deliberate point of divergence from both reference projects: the first
threads one global, node-id-namespaced context for the whole run (pruning
only a small denylist of engine-internal keys); darkf threads nothing by
default and requires an explicit act of code to keep any value alive.

## Mermaid is a render target, never a parsed input

The workflow definition is a plain TypeScript object — the single source of
truth. Mermaid is generated from it on demand; nothing is ever parsed back
out of hand-written mermaid text. This is what makes "definition as a
renderable artifact" possible without a bespoke text format or a lossy
round-trip.

## The journal is the durable record; nothing else needs to be

Every run writes an unconditional, append-only JSONL journal
(`.darkf/run/<runId>/journal.jsonl`) recording every transition of every
node's execution lifecycle. This is not optional and not a convenience
add-on. Because there is no separate accumulating context to lose, the
journal plus the last emitted `NodeResult` is already enough to know where a
run is and what it should see next — resume does not need a second,
parallel checkpoint format.

## Sessions are the harness's business, not the engine's

darkf never generates, stores, or interprets an agent session/thread id. A
runner that returns one via `NodeResult.sessionId` gets it handed back on the
next retry attempt of the same node, so a stateless runner can resume its own
native session and build its own repair turn (e.g. re-prompt with the prior
error). The engine only relays the value; it never derives meaning from it.
