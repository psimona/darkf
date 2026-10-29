# Council: failed-terminal spec review

**Question:** Should darkf adopt the design in `docs/specs/failed-terminal/spec.md` — a failure-graded terminal pseudostate (`FAILED = "[-]"`) alongside renaming `EXIT` to `DONE` (with `EXIT` kept as a one-release deprecated alias), so a darkf run that gives up is no longer misreported as succeeded? Evaluate the design itself — correctness, scope, hidden problems. Spec had already been through one `/spec-review` pass (fixing: `NodeStatus` union needing an explicit new variant; 6 named `darkf-cli` call sites; `mermaid.ts` needing a parallel `[-]` special-case; an exit-code collision in Open Questions corrected). Rollout: Slice 1 (core+engine+cli), Slice 2 (the consumer repo — `run_failure` node + ~20-edge retarget table), Slice 3 (failure-metadata envelope integration).

**Members:** Devil's Advocate, Optimist, Realist (fixed core) + Runtime/Engine Internals, Build/Tooling Engineer (dynamic, matched to this question's concerns: engine-runtime-semantics dependence, implementability/false-positives across the darkf-cli surface and the the consumer repo edge migration).

---

## Council Synthesis

**Verdict: Adopt — but Slice 1 is not yet mergeable as scoped. Close four items before/during implementation; don't carry them as deferred "open questions."**

The core diagnosis is correct and confirmed against live code (`run.ts:301-305`, `types.ts:29`): `EXIT` is currently the single terminal sentinel and is unconditionally graded as success, so give-up runs misreport as succeeded. The fix — a sibling `FAILED` sentinel, additive, nothing deleted, 6 `darkf-cli` call sites, mermaid `[-]` mirroring the existing `[*]` line — is structurally sound and well-bounded. All five lenses converge that this shape is right. Ship it. But four gaps, surfaced independently by different lenses and in two cases verified directly against engine source, must be decided before coding starts, not left as "open questions" to resolve during or after the PR:

1. **EXIT alias lifetime needs a decision + an enforcement mechanism, now.** (Devil's Advocate + Realist, convergent.) "One release" with no lint rule or CI grep check will silently become permanent — this codebase has a documented history of exactly that. Decide the window and open a tracking ticket/CI check in the same PR, or every terminal check keeps branching on two success-tokens indefinitely, which is the fragile duplicated-state problem the spec itself is trying to eliminate.

2. **Exit-code collision (vs `monitorCmd`'s 4/5/6/7 space) must be picked before implementation, not during.** (Devil's Advocate + Realist, convergent.) Undecided-at-code-time open questions are how scope creeps mid-PR.

3. **`FAILED`-check ordering in `run.ts` must be made an explicit constraint, with a test.** (Runtime/Engine Internals — unique, code-verified, highest-value single finding.) The `nextTarget === EXIT` early return at line 301 sits strictly before `registry.has(nextTarget)` at line 308; `EXIT` only works because it's checked first. The spec's "beside the EXIT branch" phrasing is ambiguous — if an implementer appends the `FAILED` check after the registry guard, every `FAILED`-routed run crashes as `unresolved-target` instead of grading as failed, silently defeating the entire spec. Add an explicit ordering constraint to the implementation ticket and an engine test asserting a `FAILED` route doesn't produce `unresolved-target`.

4. **The `commit_failed → retry → run_failure` edge claim is not implementable as currently stated.** (Build/Tooling Engineer — unique, code-verified against `run.ts:186-280`.) `def.retries` bounds only the internal crash/timeout re-dispatch loop for a single node visit and resets on re-entry; a successful dispatch that emits a `commit_failed` event and loops back via an `on` edge is ordinary graph traversal that `retries` never sees. Without an explicit `maxCycles` on the enclosing composite, this degrades to looping up to the global 1000-step default before crashing — worse than today's single give-up. Either mandate `maxCycles` on those composites explicitly in the spec, or simplify by routing `commit_failed` straight to `run_failure` like the other ~14 edges (matches the pattern, removes the ambiguity).

**Secondary, non-blocking but worth tracking:**
- No durable guardrail for *future* give-up edges — the ~20-edge retarget table and the "legitimate" whitelist (`refuted_final`/`no_cause`) are enumerated, not principled. A future workflow author who adds a new give-up path with no automated check reproduces the original bug. Low risk for the closed set under review now (Devil's Advocate + Build/Tooling, convergent on the mechanism, from different angles — manual retarget table vs. no classification principle); real risk once Slice 2 lands without the downstream `workflow-validation` guard. Worth a follow-up ticket, not a blocker.
- `run_failure` committing dirty scope artifacts with no repair path, and "failed" scope status retrying at the same queue position with no run-level cap (only per-node bound) — both from Devil's Advocate, unconfirmed against code by any other lens. Flag as risks to watch, not confirmed blockers.
- External consumers that grep the raw journal marker instead of the typed phase can't distinguish `DONE` from `FAILED` — the fix is scoped to `darkf-cli`'s typed path only (Devil's Advocate). Rated low-probability-in-practice by the synthesis; note and move on.

**Rollout guidance:** Ship Slice 1 once items 1–4 are resolved — it stands alone and is independently valuable (stops misreporting before any workflow adopts `FAILED`). Confirm Slice 2/3 are genuinely deferred rather than implied to land "soon" — if Slice 2 lags, the real-world symptom (`verify_green` `tooling_error` reported as succeeded) persists despite Slice 1 shipping. Re-grep the six `darkf-cli` call sites immediately before coding rather than trusting the prior review pass's count.

## Provenance

- **Confidence:** Medium-High — the core shape is independently verified sound by all five lenses, but two of the four blocking items (ordering hazard, `commit_failed`/`maxCycles` gap) were found by only one lens each via direct code tracing, not caught by the spec-review pass that preceded this council. That two load-bearing implementation bugs survived spec-review is why this isn't rated High.
- **Agreement:** Three convergences: (a) Devil's Advocate + Realist on the two open-questions-as-liabilities (alias lifetime, exit-code timing); (b) Optimist + Realist + Build/Tooling on Slice 1's mechanical scope (6 call sites, mermaid mirror) being low-risk; (c) Devil's Advocate + Build/Tooling on "no durable guardrail for future give-up edges," reached via different routes (manual retarget table vs. no classification principle).
- **Divergence:** Optimist is the clear outlier — rated "residual uncertainty is minor tuning" without surfacing or re-verifying against source the two code-verified implementability bugs (ordering hazard, `commit_failed`/`retries` mismatch) that Runtime/Engine Internals and Build/Tooling independently found. This is a real gap in rigor, not just a different emphasis.
- **Key driver:** Runtime/Engine Internals and Build/Tooling Engineer, jointly — both found their headline issue by tracing exact line numbers in `run.ts` against the spec's prose rather than trusting it, and both findings are genuinely load-bearing (silently defeat the spec's purpose, or silently degrade behavior below today's baseline) if missed.
- **Scores (corr/complete/action/uncert):**
  - Devil's Advocate: 7/8/7/8
  - Optimist: 5/4/6/3
  - Realist: 9/8/9/8
  - Runtime/Engine Internals: 9/6/8/6
  - Build/Tooling Engineer: 9/8/9/7
