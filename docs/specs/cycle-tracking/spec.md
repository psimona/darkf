# Cycle tracking: re-examine whether `maxCycles`'s mechanics are the right primitive

**Draft — future work.** This captures the problem and the open questions
as found; it does not propose a design yet. Not reviewed, not scheduled.
A spec for `darkf-core`'s `StateDef.maxCycles` and `darkf-engine/run.ts`'s
cycle-counting loop — pure engine mechanics, no workflow-authoring content.

## How it came up

While closing out `../failed-terminal/spec.md`'s council review, item 4
(`commit_failed → retry → run_failure`) turned out not to be implementable
as that spec's per-edge table stated: it assumed `def.retries` bounds a
`commit_failed` edge looping back to the commit node. It doesn't —
`def.retries` only bounds the *internal* crash/timeout re-dispatch loop for
a single node visit, and resets the instant that node is re-entered via an
ordinary `on`/`next` edge. The actual mechanism available for bounding that
kind of loop is `maxCycles`, scoped to the enclosing composite — but
reading its real semantics directly in `run.ts` surfaced properties that
are worth re-examining on their own, independent of that one edge. Item 4
itself was deliberately deferred to the consumer repo (workflow-authoring
decision, not an engine change); this spec is the follow-up on the
engine-side mechanism it exposed.

## Current mechanism, as verified against the code

`darkf-engine/run.ts:142-184`, inside the run loop:

- `cycleCounters: Map<string, number>` holds one counter per composite id.
- Every leaf dispatch walks that leaf's `scopePath` (the stack of
  composites it's nested inside, outermost to innermost) and, for each
  composite in that stack that declares a `maxCycles`, increments its
  counter — **but only if that composite id was already present in the
  immediately preceding step's `scopePath`** (`previousScopePath`). If the
  composite is absent from the previous step's scope, this step counts as
  a fresh entry and the counter resets to 0.
- The check `count >= maxCycles` crashes with `{ kind: "cycle-limit",
  composite, cycles: maxCycles }` before the counter increments for this
  step.
- This is tested and intentional, not an edge case found by accident —
  `run.test.ts` has four tests naming the exact semantics: a multi-leaf
  loop tripping the limit, a loop finishing within budget, the counter
  resetting when the composite is left and re-entered, and — the one that
  pins down the actual granularity — **a single continuous straight-line
  pass with no repeated node still trips the limit**, "unaffected by the
  reset."

Two properties fall out of this that are worth naming explicitly, because
they're easy to conflate with what the name `maxCycles` suggests:

1. **It counts steps, not revisits.** A composite with ten distinct
   leaves chained straight through and `maxCycles: 5` crashes at step 6,
   with zero actual looping. "Cycle" here means "steps taken during one
   continuous visit to this composite," not "times the same node was
   revisited." It is simultaneously a loop-bound and a runaway-progress
   breaker, with no way to ask for only one of the two.
2. **It resets on any exit, not on a cycle actually closing.** The bound
   is "cycles since the last time execution stepped outside this
   composite's scope," not "cycles over the life of this run." A loop
   that routes briefly through a sibling node outside the composite and
   back in resets the counter to 0 by design — this is the exact gap
   `failed-terminal`'s item 4 ran into when it assumed a retry edge was
   bounded by something, and it wasn't.

## Open questions (not yet answered — this is the point of the draft)

- Should revisit-counting and step-counting be two different knobs, or is
  one knob intentionally meant to serve both? If authors actually want
  "retry this specific failure up to N times" (a revisit bound) today,
  is `maxCycles` the wrong tool for that regardless of how it's
  documented — or is the fix purely documentation (explain the real
  semantics so authors stop assuming a revisit-count meaning)?
- Is reset-on-exit a property that should be removable — e.g. a
  run-lifetime variant of the cap that doesn't forgive a brief excursion
  outside the composite — or is "bounded per continuous visit" the
  correct, deliberate scope for every current use of `maxCycles`
  (checked: `run.test.ts`'s own tests treat the reset as a feature, not
  a bug to fix)?
- Is there a real need for an edge-scoped or node-scoped cycle bound,
  distinct from `maxCycles`'s composite scope — e.g. "this specific
  `commit_failed` edge may fire at most N times this run," independent of
  whatever else is happening in the enclosing composite's scope path?
- Once this question is answered, does it change what the consumer repo should do
  for `failed-terminal`'s deferred item 4 (`commit_failed` retry), or was
  that always answerable with the existing primitive and the real gap was
  just that nobody had read `run.ts` closely enough?

## Non-goals (tentative — subject to the above being answered)

- Changing `def.retries` semantics — separate, already-documented
  mechanism (internal per-attempt crash/timeout retry), not in scope here.
- Resolving the consumer repo's `commit_failed` edge itself — that's
  `../failed-terminal/spec.md`'s deferred item, owned by the consumer repo's
  Slice 2; this spec only covers the darkf-engine mechanism it depends on.

## Downstream

`../failed-terminal/spec.md`'s deferred item (`commit_failed → retry →
run_failure`) may depend on whatever this spec concludes — if a
revisit-scoped or run-lifetime cycle bound turns out to be needed, that's
a new engine primitive the consumer repo's Slice 2 would wait on; if the existing
`maxCycles` turns out to already be sufficient once correctly understood,
Slice 2 proceeds with the existing mechanism and no engine change.
