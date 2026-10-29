---
title: Node types
description: Every leaf is agent or script, dispatched the same way.
---

A `WorkflowDef` is a plain object. It has one `initial` state and a
`states` map.

Every state is one of three shapes: `agent`, `script`, or `composite`.
The first two are leaves — the engine actually dispatches them. The
third is pure nesting.

## Agent

```ts
export interface AgentStateDef {
  type: "agent";
  prompt: string;
  agent?: Record<string, unknown>;
  on?: Record<string, string>;
  next?: string;
  retries?: number;
  timeoutMs?: number;
  validate?: (result: NodeResult, handoff: NodeResult) => string | undefined;
}
```

| Field | Required | Default | What it does |
|---|---|---|---|
| `type` | Yes | — | `"agent"`. The discriminant — how darkf tells this state apart from a `script` or a `composite`. |
| `prompt` | Yes | — | darkf builds the full prompt a runner sees by combining it with the incoming handoff and `validEvents` — computed straight from `on`'s own keys, so there's nothing to keep in sync by hand. |
| `agent` | No | `{}` | An untyped bag core never reads itself. Each runner interprets it its own way: `claudeCodeRunner` reads `model`/`permissionMode`, `opencodeRunner` reads `model`/`auto`. Unset, a runner falls back to its own defaults. |
| `on` | No | — | Routes by the reply's event — `{ approved: "Next" }` means "go to `Next` when the event is `approved`." |
| `next` | No | — | Unconditional alternative to `on`: always go there, regardless of what event comes back. Also sets `DispatchInfo.hasFallback`, telling the agent it may omit `event` entirely. |
| `retries` | No | `0` | Reattempts of this one dispatch after a crash — a malformed reply, a failed `validate`, a runner throwing. Each retry's prompt includes `DispatchInfo.previousFailure`, naming what went wrong last time. |
| `timeoutMs` | No | 1 hour | Ceiling on a single dispatch attempt. Exceeding it is a `timeout` crash, consuming a retry attempt like any other. |
| `validate` | No | — | `(result, handoff) => string \| undefined`, run after the reply already parses as a well-formed `NodeResult`. Return a string to reject it — consuming a retry, exactly like a crash — or `undefined` to accept. |

Only `prompt` has no default and no fallback behavior — it's the one field a workflow author must always supply. Everything else is safe to omit.

## Script

```ts
export interface ScriptStateDef {
  type: "script";
  file: string;
  on?: Record<string, string>;
  next?: string;
  retries?: number;
  timeoutMs?: number;
  validate?: (result: NodeResult, handoff: NodeResult) => string | undefined;
}
```

| Field | Required | Default | What it does |
|---|---|---|---|
| `type` | Yes | — | `"script"`. The discriminant. |
| `file` | Yes | — | Resolved relative to the workflow's `scripts/` directory. Must export a default `(handoff, info) => NodeResult \| Promise<NodeResult>`. darkf imports it, calls it, and treats whatever comes back exactly like an agent's result. |
| `on` | No | — | Same as the agent case: routes by the event the returned result carries. |
| `next` | No | — | Same as the agent case: unconditional alternative to `on`. |
| `retries` | No | `0` | Reattempts after a crash — the function throwing, returning something malformed, or failing `validate`. Each retry calls the function again from scratch; no conversation to repair, but `DispatchInfo.previousFailure` still carries what went wrong, if the script wants to branch on it. |
| `timeoutMs` | No | 1 hour | Same as the agent case — a hang past this is a `timeout` crash. |
| `validate` | No | — | Same contract as the agent case. Rarely needed, since a script's own result is usually correct by construction — but useful for confirming a side effect (a file actually got written) before the dispatch counts as done. |

`type` and `file` are the only two a script state can't do without. Both leaf kinds leave every other field optional.

## Composite

```ts
export interface CompositeStateDef {
  initial: string;
  states: Record<string, StateDef>;
  maxCycles?: number;
}
```

A composite isn't a leaf — it has no `type`, no `on`, no `next` of its
own. It's organizational nesting.

| Field | Required | Default | What it does |
|---|---|---|---|
| `initial` | Yes | — | Which of this composite's own `states` is active first. The engine never dispatches a composite directly — it resolves down to whichever leaf is active, at any depth, by following `initial` chains until it hits one. |
| `states` | Yes | — | This composite's own nested state map, same shape as a `WorkflowDef`'s top-level one. States inside it can themselves be composites. |
| `maxCycles` | No | unset (unbounded) | A circuit breaker on a runaway loop spanning multiple leaves inside this composite — the kind no single dispatch's `retries`/`timeoutMs` would ever catch. Exceeding it crashes with `cycle-limit`. Unset, only the engine-wide `maxSteps` backstop remains. |

`initial` and `states` are both mandatory — a composite with no states to nest, or no way to pick the first one, isn't a composite.

State ids aren't scoped to their parent composite, though. Any
`on`/`next` target can name any state anywhere in the tree, directly —
nested or not.

`darkf/workflows/series-ordering` shows this for real. `Review` is
a top-level state. `Implement` is nested inside `Fix`. `Review`'s
`changes_requested` edge still names `Implement` directly:

```ts
// darkf/workflows/series-ordering/workflow.ts (prompts omitted)
Fix: {
  initial: "Implement",
  maxCycles: 8,
  states: {
    Implement: { type: "agent", on: { implemented: "Verify", blocked: EXIT, disputed: EXIT } },
    Verify: { type: "script", file: "verify.ts", on: { green: "Review", red: "Implement" } },
  },
},
Review: {
  type: "agent",
  on: { done: EXIT, changes_requested: "Implement" },
},
```

`Review` doesn't name `Fix`. It doesn't need to know `Implement` is
nested at all.

Since ids are global and any edge can reach any leaf, nesting isn't
routing scope. It buys exactly two things:

1. **A composite's own id is a routable target** — pointing an edge at
   it resolves (via `enter()`) to whichever leaf its `initial`
   currently names, recursively, if composites nest inside composites.
   That's indirection against restructuring, not scoping: change which
   leaf goes first inside `Fix`, and every edge that targets `Fix` by
   name keeps working, unchanged.
2. **`maxCycles` is scoped to the subtree, and resets on re-entry** —
   a circuit breaker that's reusable per-pass (e.g. once per item in
   an outer queue), not a global counter. `Fix: { maxCycles: 8 }` only
   counts dispatches of `Implement`/`Verify` while execution stays
   inside `Fix`, and resets the moment execution leaves (dispatching
   `Review`) and later re-enters.

And explicitly what it does *not* buy: no namespacing — `Implement`'s
id still has to be unique across the *entire* workflow, nested or not;
`buildRegistry` throws `duplicate-id` the same way whether the clash is
top-level or three levels deep. And no firewalling — `Review`'s edge
above is the proof: anything, anywhere, can route straight into a
nested leaf, bypassing the composite's own `initial` entirely.

## One contract either way

Both leaf kinds return the same shape:

```ts
export interface NodeResult {
  event?: string;
  output?: unknown;
  sessionId?: string;
}
```

| Field | Required | What it's for |
|---|---|---|
| `event` | No | What `on`/`next` route on. Omit it and only `next` can match. |
| `output` | No | This node's payload for whatever node runs next. See [Handoff](../handoff/) for the rule governing it — nothing carries further than one hop unless a node re-emits it. |
| `sessionId` | No | Opaque, runner-native session id, relayed back into `DispatchInfo` on this same node's next retry attempt, so a stateless runner can resume instead of starting cold. core never interprets it. |

All three are optional — every field on `NodeResult` carries a `?`. A leaf can return `{}` and still be valid, as long as some edge's `next` is there to catch it.

The engine doesn't know or care which kind produced a result. Routing
(`on`/`next`), retries, `validate`, and journaling all treat an agent's
result and a script's result identically.

The quickstart's `haiku-readme` example leans on this directly: `Plan`
and `Review` are `agent` states, `Write` and `Test` are `script`
states, and all four sit in the same graph, routed and journaled
exactly the same way. Swap `claudeCodeRunner` for a plain stub object
(as `haiku-readme` does, to demo without a real LLM call) and nothing
about the workflow's wiring changes either — the engine never sees the
difference.
