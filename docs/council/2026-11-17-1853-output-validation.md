# Council: output-validation spec review

**Question:** Review `docs/specs/output-validation/spec.md`. It adds
`outputType` (a structural `OutputSchema` interface) to `AgentStateDef`,
checked before the existing `validate` hook; takes Zod as darkf-core's
first real runtime dependency (via an adapter in `kit/validation/zod.ts`,
never imported by core/engine code directly except one named exception);
makes `validate` failures nudge up to 3 times in the same agent session
before falling back to a fresh retry, with no per-leaf opt-out; and
extends `isNodeResult` (the handoff envelope check) to the same
Zod-backed pattern, with one named behavior change — an array now fails
the check, where it passed before. Evaluate: the design decisions, the
compatibility risk of no-opt-out nudging, and the `isNodeResult`
extension's behavior change.

**Members:** Devil's Advocate, Optimist, Realist, Runtime/Engine
Internals (dynamic), API/Contract Designer (dynamic). No new archetype
generated.

## Council Synthesis

**Decision: approve the core design, ship with four concrete edits
before merge.**

1. **`OutputSchema` structural interface — keep as-is, no change.** All
   five members independently verified this is the right boundary: it
   erases Zod's generic/version surface at the adapter edge
   (`kit/validation/zod.ts`), so `AgentStateDef` stays stable across a
   consumer's Zod v3/v4/no-Zod choice. No dissent. Ship unchanged.

2. **Zod as first runtime dependency — accept, but the spec must say so
   plainly.** Realist verified `darkf/package.json` currently has *no*
   `dependencies` key at all — this is categorically darkf-core's first
   install-time-resolvable runtime dependency, not an incremental
   addition, and the spec currently undersells that. Edit the spec's
   framing to state this explicitly, and lead with the load-bearing
   reasons members agree on (zero transitive deps, team familiarity
   with Zod as the LLM tool-calling vocabulary) rather than popularity
   stats, which Realist correctly flags as weak justification. This
   change should land under at least a minor version bump with a
   changelog entry, not a silent patch release.

3. **`isNodeResult`'s Zod import — resolve the inconsistency by
   removing it, not by rationalizing it.** This is the one real
   disagreement: Devil's Advocate and API/Contract Designer call it a
   crack in the "core never imports a schema library directly" claim
   (unconditional Zod import on every dispatch, contradicting language
   two paragraphs earlier in the same spec); Optimist, Realist, and
   Runtime/Engine Internals call it low-risk and well-scoped. Both
   sides agree on the underlying fact (confirmed against
   `core/types.ts:21-32`) — they disagree only on whether it matters.
   Resolution: it's avoidable, so don't argue about it, fix it. The
   array-rejection behavior change only needs to distinguish "array"
   from "plain object" — that's a 2-line hand-rolled type-tag check
   (e.g. `!Array.isArray(value)`), not a Zod schema. Rewrite this part
   of the spec to keep the fix but drop the Zod import from `types.ts`
   entirely, which makes the "never imports Zod directly in core code"
   claim fully true instead of true-with-an-asterisk, and removes Zod
   from a function called on every single dispatch regardless of
   whether any workflow uses `outputType`.

4. **No-opt-out nudging — the real compatibility risk; all five flag
   it, but Devil's Advocate finds the sharper failure mode the others
   miss.** Consensus: this silently changes `validate`'s
   failure-cost/timing for every existing consumer on upgrade
   (confirmed: today's path is a straight `continue attemptLoop` at
   `run.ts:311-315`; the spec adds up to 3 in-session nudges first),
   with zero shipped consumers of `validate` in this repo today but no
   guarantee for external consumers. Devil's Advocate's distinct
   contribution, not caught by the other four: because nudges report
   only the *first* Zod issue (per the spec's own Non-goals), a schema
   with multiple independently-failing fields burns all 3 nudges fixing
   one field at a time without ever converging, paying the full nudge
   tax before falling back to the fresh retry it would have hit
   immediately today. Concrete actions:
   - Gate this behind a minor/major version bump with an explicit
     changelog line, not a silent point release (Realist, API/Contract
     Designer).
   - Fix the non-convergence case: have the nudge message surface all
     current `safeParse` issues (or at minimum a count), not just the
     first, so one nudge round can address multiple fields instead of
     guaranteeing three wasted dispatches on any multi-field failure.
   - Add a lightweight per-leaf or global off-switch (e.g.
     `nudgeable: false`) as a safety valve for latency/cost-sensitive
     workflows, even if the default stays on — the spec currently has
     no escape hatch at all, which is the one piece of design the
     Optimist's "purely additive, never worse" framing does not survive
     once the multi-field case is accounted for.

5. **New finding worth folding in: Zod error-message coupling.** Only
   API/Contract Designer caught this — the adapter surfaces
   `issue.message` verbatim into nudge prompts, which couples
   agent-facing prompt text to Zod's own error-string wording, a
   surface that can drift across Zod minors independently of its type
   contract. Add a normalization/wrapper step rather than passing
   `issue.message` straight through, or explicitly document the
   coupling as accepted risk.

6. **`isNodeResult` array rejection — ship as a named breaking fix, low
   risk.** Unanimous: correct latent-bug fix (confirmed against
   `core/types.ts` that an array vacuously passed both old guard
   clauses), test-covered, zero in-repo consumers via grep. Once action
   3 removes the Zod dependency from this check, this item has no
   outstanding concerns — just keep it called out explicitly in the
   changelog as the one named behavior change, per the spec's own
   framing.

## Provenance

- **Confidence:** High — all five members independently verified the
  same factual claims against primary source (`run.ts:43-50,311-345`,
  `core/types.ts:21-32`, `package.json`), and every claim checked out;
  disagreement was confined to judgment calls about materiality/framing,
  which this synthesis resolves with concrete, checkable edits rather
  than guesses.
- **Agreement:** `OutputSchema`-as-structural-interface is the right
  call; the array-rejection fix is correct, low-risk, and well-scoped;
  no-opt-out nudging is a real, under-specified compatibility risk that
  needs a version-bump/changelog gate; Zod is a defensible but
  non-trivial first dependency.
- **Divergence:** whether the `isNodeResult` Zod import is a "crack"
  undermining the spec's decoupling claim (Devil's Advocate,
  API/Contract Designer) versus a narrow, acceptable, well-scoped
  exception (Optimist, Realist, Runtime/Engine Internals). Resolved
  above by removing the need for the exception altogether — the array
  check doesn't require Zod, so the disagreement dissolves rather than
  needing a side picked.
- **Key driver:** Runtime/Engine Internals' line-level verification of
  `run.ts`/`types.ts` anchored every other member's claims in fact,
  which is what let the synthesis move past "is this a risk" to "here
  is the specific line-level fix."
- **Scores (corr/complete/action/uncert):**
  - Devil's Advocate: 8/9/6/7
  - Optimist: 6/5/5/5
  - Realist: 9/8/8/8
  - Runtime/Engine Internals: 9/7/6/7
  - API/Contract Designer: 9/9/6/7
