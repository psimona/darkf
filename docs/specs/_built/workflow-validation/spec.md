# Workflow validation: fail fast on a bad definition, before the first dispatch

A spec for `darkf-core`'s graph module and `darkf-engine`'s `run()`. Covers
one mechanism: walking a whole `WorkflowDef` once, eagerly, for structural
errors — before any leaf dispatches — instead of discovering them one at a
time, mid-run, as execution happens to reach them.

## Problem

Today, `buildRegistry` catches one class of bad definition eagerly
(`duplicate-id`), but everything else is discovered lazily:

- An `on`/`next` target that doesn't name a real state (or `DONE`/`FAILED`) only
  crashes (`unresolved-target`) once some run actually reaches that edge —
  which might be the 40th dispatch of a long workflow, after real agent
  work already happened.
- A composite whose `initial` points at an id with no matching state hangs
  until that composite is entered, same story.
- A composite whose `initial` chain cycles back on itself (`A.initial =
  "B"`, `B.initial = "A"`) isn't caught at all today: `enter()`
  (`darkf-core/src/graph.ts`) loops `current = entry.def.initial` with no
  step counter of its own — the engine's `maxSteps` guard lives in
  `run()`'s outer dispatch loop, one level up, and never gets a turn. This
  hangs the process the moment that composite is entered, with no crash,
  no journal entry, nothing for `status`/`monitor` to report.
- A leaf with neither `on` nor `next` can never route anywhere, for any
  event the dispatch returns — but this is only visible as a
  `no-transition` crash after a real dispatch (a real agent turn, a real
  script run) already happened.

A typo in a target name, or a copy-pasted composite with its `initial`
swapped, should fail before the first dispatch spends anything — not
partway through a run that already did real, possibly costly, work.

## Design

### Scope: what's eagerly checkable, what isn't

Three problem shapes are checkable from the `WorkflowDef` alone, with no
run in progress:

- **Unresolved target** — any leaf's `on[event]` value or `next` value
  that is neither `DONE` nor `FAILED` (nor the deprecated `EXIT` alias of
  `DONE`) nor a real registered state id, **or** any composite's `initial`
  value (including the workflow's own top-level `initial`) that is not a
  real registered state id. `DONE`/`FAILED` are valid targets only for a
  leaf's `on`/`next` — the dispatch loop's own `nextTarget === DONE` and
  `nextTarget === FAILED` checks (`darkf-engine/src/run.ts`) end the run
  cleanly there, grading it succeeded or failed respectively. Neither is
  ever valid as an `initial`: `enter()` has no `DONE`/`FAILED`
  special-case, so `initial: "DONE"` (or `"FAILED"`, or the deprecated
  `EXIT` alias) resolves to nothing and crashes as `unresolved-target` at
  runtime today, the same as any other bad `initial` — this check now
  catches that eagerly too, for the same reason it catches every other bad
  `initial`. (Whether `workflow.initial === DONE` should instead succeed
  immediately with the seed input is a separate, still-open question —
  see Non-goals; this spec only makes today's crash happen earlier and
  through the same `invalid-workflow` path as every other definition
  error, not whether it should crash at all.) This is the same shape
  `CrashReason`'s existing `unresolved-target` already carries; this check
  just finds every instance of it upfront instead of the one a run
  happens to hit first.
- **Initial cycle** — a chain of composites whose `initial` fields loop
  back on each other with no leaf ever reached. Today this hangs `enter()`
  forever; see Problem above.
- **Dead-end leaf** — a leaf with both `on` absent/empty and `next`
  absent. No event, including no event at all, can ever route it anywhere;
  this is never a valid design (a workflow that means to end always has an
  explicit edge to `DONE` or `FAILED`, including `next: DONE` for a leaf
  that takes no branching event).

What's explicitly **not** checkable this way, because it depends on what a
dispatch actually returns at runtime: whether a leaf's `on` covers every
event its agent or script might plausibly produce. An agent returning an
event absent from `on` (with no `next` fallback) is `no-transition` — a
real runtime failure, not a definition bug this spec can see ahead of
time.

### `validateWorkflow`

`darkf-core/src/graph.ts` gains:

```ts
export type WorkflowValidationError =
  | { kind: "unresolved-target"; from: string | null; target: string }
  | { kind: "initial-cycle"; cycle: string[] }
  | { kind: "dead-end-leaf"; state: string };

export function validateWorkflow(
  registry: Map<string, RegistryEntry>,
  initial: string,
): WorkflowValidationError[];
```

Takes the already-built registry (not the raw `WorkflowDef`) — `graph.ts`'s
own header comment already names this: "a renderer, a validator... depends
on [the registry's shape], not on the execution loop." `buildRegistry` has
already walked the whole tree once to produce it; `validateWorkflow` is a
second, cheap pass over the same flat `Map`, not a second tree-walk.

- `from: null` is used for a bad top-level `initial` (the one target with
  no natural leaf/composite owner) — not a string sentinel like `"<root>"`,
  which would collide with an actual state legitimately named `<root>`
  (nothing in `buildRegistry` forbids that id). `WorkflowValidationError`'s
  `unresolved-target` variant is therefore `{ kind: "unresolved-target";
  from: string | null; target: string }`.
- Every problem found is collected — `validateWorkflow` never stops at the
  first one. A workflow with 3 bad targets and a dead-end leaf reports all
  4 in one pass, not one crash-fix-rerun cycle per problem.
- `initial-cycle`'s detection runs once for **every composite in the
  registry** (including the workflow's own top-level `initial`, treated as
  one more chain to walk) — not only ones reachable from
  `workflow.initial`'s own chain. A composite reachable only later, via
  some leaf's `on`/`next`, is an equally live hazard sitting in the
  registry; `enter()` doesn't care how a composite was reached, so neither
  does this check.
  - Per composite, walk its `initial` chain, maintaining a visited set
    **for that walk only**. If the chain reaches an id absent from the
    registry, stop: that's `unresolved-target` (already reported above),
    not a cycle — don't double-report the same composite under both
    kinds. If the chain reaches a leaf, stop: no cycle. If the chain
    revisits an id already seen in this walk, that's the cycle.
  - The same cycle is reachable by starting the walk from any composite
    that feeds into it (e.g. `A → B → A` is found starting from `A` and
    starting from `B`), so before returning, dedupe cycles by their
    canonical form (e.g. rotate each found cycle's id list to start at its
    lexicographically smallest member, then dedupe equal lists) — one
    `initial-cycle` error per distinct cycle, not one per composite that
    walks into it.

### Engine wiring

`darkf-engine/run.ts`'s `run()` calls `validateWorkflow(registry,
opts.workflow.initial)` immediately after `buildRegistry` succeeds —
specifically, **before** the first `enter(registry, opts.workflow.initial)`
call that resolves the run's starting leaf, not merely "before the
dispatch loop." Today that `enter()` call sits between `buildRegistry` and
the loop; it's the exact call an initial-cycle hangs inside, with nothing
upstream of it to catch first. Validating after it would still hang on
the same bad definition this spec exists to catch. A non-empty result is
one crash, reported through a new `CrashReason` kind:

```ts
| { kind: "invalid-workflow"; errors: WorkflowValidationError[] }
```

This crash happens with `attempt: 0` (no leaf dispatched, same convention
`duplicate-id`/`max-steps` already use) but after the run's own begin
marker (unaffected by this change — `buildRegistry`'s own
`duplicate-id` crash already follows the same ordering today). `crashed()`
takes `(reason, attempt, state, scopePath)`; every existing `CrashReason`
has a natural current `state`, but `invalid-workflow` is a whole-graph
problem found before any state is current. Call it as
`crashed(reason, 0, opts.workflow.initial, [])` — mirroring exactly how
`buildRegistry`'s own `DuplicateStateIdError` crash already uses
`err.id, []` in the same no-state-yet situation.

Always on, for every run — not an opt-in flag. The whole point is that a
bad definition fails the same way whether or not anyone remembered to lint
it first.

### `doctor` integration

`darkf-cli`'s `doctorCmd` (`src/index.ts`) gains a check reusing the same
`validateWorkflow` call against the loaded workflow's registry, reported
the same way its existing checks are (`check(label, ok, detail)`) — one
line per problem found. This lets someone check a workflow's structure
without actually starting a run, using the identical rule the engine
enforces at start.

`doctorCmd` doesn't currently import `buildRegistry` (`darkf-core` imports
there today are `AgentRunner`/`DONE`/`NodeEvent`/`NodeResult`/
`parseEventLog`/`renderActive`/`renderMermaid`/`ScriptRunner`/
`WorkflowDef`) — this check needs to add that import and build its own
registry from the loaded `mod.workflow`, inside the existing `if (resolved)`
module-load branch. `buildRegistry` can throw `DuplicateStateIdError`;
unlike `run()`, `doctorCmd`'s `check()` helper never throws, so this call
needs its own try/catch reporting a `check("workflow structure", false,
...)` line on that throw — consistent with how the adjacent `workflow.ts
loads` check already catches its own failure instead of letting it crash
the whole `doctor` command.

This leaves `run()` and `doctorCmd` each independently building and
validating a registry from a loaded `WorkflowDef`, with no shared loader
between them. Fine at these two call sites; a third consumer needing the
same "load, build registry, validate" sequence is the signal to extract
one.

## Dependency (resolved)

This spec was blocked by `../failed-terminal/spec.md` until its Slice 1
shipped (commit `1dcc70b`, 2026-10-22): the `DONE` rename, the `FAILED`
pseudostate, and the deprecated `EXIT` alias of `DONE`, landed in
`darkf-core`/`darkf-engine`. The Design section above is now written
directly against that final, real terminal-sentinel set (`{DONE,
FAILED}`) rather than the old `{EXIT}` — `FAILED` gets the identical
treatment `DONE` (and before the rename, `EXIT`) already has: valid for a
leaf's `on`/`next`, never valid as any `initial`. The deprecated `EXIT`
alias needs no special-casing here — it resolves to the same string as
`DONE`, so every check above already covers it for free; it stops
mattering entirely once `failed-terminal`'s own Slice 2 deletes the
alias.

## Non-goals

- Unreachable-but-structurally-valid states (a state nothing's `on`/`next`
  ever points at, and that `initial` doesn't descend into) — dead code,
  not a correctness bug; a lint concern for a future pass, not this one.
- Validating `maxCycles`/`timeoutMs`/`retries` values (e.g. `maxCycles: 0`)
  — these are deliberate configuration, not structural graph errors; a
  suspicious value isn't necessarily a wrong one.
- Whether a leaf's `on` covers every event its agent/script might return —
  runtime-dependent, stays a `no-transition` crash as it is today.
- Fixing the pre-existing `workflow.initial === DONE` edge case (today:
  crashes as `unresolved-target` immediately, arguably should just succeed
  with the seed input instead) — real, but orthogonal to this spec's
  scope; noted here so it isn't lost.
