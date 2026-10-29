# Council: plan+next-item loop — convention/helper vs. new engine primitive

**Question:** How should darkf support a "plan phase + next-item loop" pattern
(plan produces a dynamic list of items, then a dispatcher loops over them one
at a time until exhausted)?

- **Option 1** (human leaned this way): a shared convention/helper, not a
  core primitive. Zero `StateDef`/`WorkflowDef` changes — express the shape
  with existing vocabulary (dispatcher leaf + sibling composite + `maxCycles`
  + a run-scoped plan file for durable next-item/done bookkeeping), and
  centralize only the fiddly, error-prone bookkeeping as one shared module.
- **Option 2**: a real new primitive — e.g. a `type: "foreach"` state that
  takes a dynamic item source and drives per-item dispatch inside the engine.

## Members

3 fixed (Devil's Advocate, Optimist, Realist) + 2 dynamic matched to the
question's own flagged risks:
- **Runtime/Engine Internals** — does the helper need engine cooperation it
  doesn't have today?
- **DevOps/SRE** — how does "done" state surface in status/report/TUI
  tooling, and what does resume-after-restart look like operationally?

No new archetype was generated; no catalog proposal.

## Per-member scores (corr/complete/action/uncert)

- Devil's Advocate: 8/9/7/9
- Optimist: 8/7/7/7
- Realist: 9/8/9/8
- Runtime/Engine Internals: 10/8/9/7
- DevOps/SRE: 9/9/9/7

## Council Synthesis

Ship **Option 1** — a shared convention/helper module for plan+next-item
dispatch, with zero StateDef/WorkflowDef changes. The existing
`on`/`next`/composite/`maxCycles` vocabulary already expresses "dispatcher
leaf loops a sibling composite until exhausted"; this pattern is the same
shape as `build-phase-dispatcher-shape`, just with a dynamic rather than
static item count, and it doesn't reach the bar (engine-vocabulary change
touching every consumer) that justified the "yes" answer in
`loop-restart-signature-primitive`. Per PHILOSOPHY.md, "which item is next"
and "what does done mean" are script-level variability, not schema-level.

Do not ship the helper as "just a thin convenience wrapper," though — bundle
these four things into its design, because all five lenses independently
converged on them as the real risk surface:

1. **Explicit item-state machine, not "next incomplete."** Persist ordered
   items with per-item status (pending/in-progress/done/failed).
   `in-progress` is the dangerous state on crash: resume must not silently
   re-pick a half-finished item as pending, nor get permanently stuck on a
   stale in-progress marker. The run-scoped plan file must be the single
   source of truth, re-read fresh each pass — never reconstructed from
   in-memory state or journal replay (the journal gives only
   last-node-result, nothing item-aware).

2. **Size `maxCycles` correctly — verified against code, not assumed.**
   `darkf-engine/src/run.ts` (~lines 131-170) and `darkf-core/src/types.ts`
   confirm `maxCycles` is a running dispatch-count breaker per composite,
   incremented on every leaf dispatch while the composite stays in scope,
   and reset to 0 only when the engine fully leaves that composite's subtree
   and re-enters — not an "iterations of the loop" counter and not reset per
   back-edge within the same subtree. If the dispatcher and all per-item
   work live inside one sibling composite without leaving it, `maxCycles`
   must be sized to (item count × leaf-dispatches-per-item), not to the
   expected number of items. Document this explicitly in the convention, or
   long item lists will trip the breaker mid-plan.

3. **Treat status/report/TUI visibility as unscoped work to budget, not an
   afterthought.** Today's `status.ts`/journal model is leaf-dispatch/
   node-lifecycle events only — zero notion of composite/cycle/plan
   progress — and a dynamic loop re-entering the same composite N times will
   show as repeated visits to one id, not "item 4/17." Neither option gives
   item-level visibility for free (a `foreach` primitive wouldn't
   automatically emit item-level journal events either). Make "the helper
   also writes one journal-visible line per item transition" part of the
   convention's contract, so `darkf status` doesn't regress to "operator has
   to cat the plan file by hand" during an incident.

4. **Guard against the plan file becoming a second, unreconciled source of
   truth.** `status`/`monitor` today derive truth entirely from the
   append-only journal plus pid liveness. A plan file living outside that
   journal, with no crash-consistency contract, can diverge from the
   journal's picture if the process dies between "wrote progress to plan
   file" and "journal records node EXIT." The helper's write pattern needs
   explicit ordering/atomicity so the two stay reconcilable.

**Flip condition (don't do this preemptively):** revisit Option 2 only if a
second, structurally different foreach shape shows up — e.g., parallel
fanout rather than strictly sequential — such that multiple call sites start
reinventing incompatible plan-file schemas, or if the engine itself ever
needs native item-count awareness for budgeting/crash semantics (it
currently doesn't; `maxCycles` already scopes per subtree re-entry). That's
the same convergent-need signal that would have been required to flip
`loop-restart-signature-primitive`.

## Provenance

- **Confidence:** High — unanimous 5/5 convergence on Option 1, reinforced
  by one lens (Runtime/Engine Internals) that verified the decisive mechanic
  against actual source rather than inferring it.
- **Agreement:** All five cite the same two precedents
  (`build-phase-dispatcher-shape`, `loop-restart-signature-primitive`) and
  PHILOSOPHY.md's "write code, not a new flag" as directly on point; all
  five independently flag the same two gaps — (a) durable crash-safe
  item-state bookkeeping is nontrivial load-bearing logic, not "just a plan
  file," and (b) status/report/TUI tooling has zero concept of plan progress
  today, and that gap persists regardless of which option ships.
- **Divergence:** Not disagreement on the verdict, but on emphasis/scope of
  what "ship Option 1 responsibly" requires. Devil's Advocate pushes hardest
  on the state-machine semantics and sets the Option-2 flip bar explicitly.
  DevOps/SRE isolates a distinct failure mode none of the others named as
  sharply: the plan file and the append-only journal are two unreconciled
  sources of truth with no crash-consistency contract. Runtime/Engine
  Internals corrects a load-bearing factual detail — `maxCycles` is a
  per-subtree dispatch-count breaker, not a per-iteration counter — that the
  Devil's Advocate stated more loosely ("resets on composite re-entry")
  without the multiplier implication. Optimist is the most sanguine,
  treating the visibility and resume gaps as "additive, not blocking," while
  Realist produces the most balanced synthesis but without Runtime/Engine's
  code-level grounding.
- **Key driver:** Runtime/Engine Internals. It's the only answer that
  verified the `maxCycles` reset semantics against `darkf-engine/src/run.ts`
  and `darkf-core/src/types.ts` with line numbers, turning a vague shared
  assumption into a precise, actionable correction (size `maxCycles` to
  item-count × dispatches-per-item when the loop stays in one subtree).
  That's the one finding in this set that would cause a silent,
  hard-to-diagnose production failure (breaker tripping mid-plan on long
  item lists) if the other four narrative-only answers' looser phrasing had
  gone unchecked.
