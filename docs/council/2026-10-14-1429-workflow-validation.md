# Council: workflow-validation spec review

**Question:** Should darkf add a "workflow validation" feature (`docs/specs/workflow-validation/spec.md`) that walks the whole workflow graph once, eagerly, at run start, to catch bad definitions (unresolved targets, composite-initial cycles, dead-end leaves) before any dispatch happens, instead of discovering them lazily mid-run? Evaluate the design itself — correctness, scope, hidden problems.

**Members:** Devil's Advocate, Optimist, Realist (fixed core) + Runtime/Engine Internals, Build/Tooling Engineer (dynamic, matched to this question's concerns: engine-runtime-semantics dependence, implementability/false-positives).

---

## Council Synthesis

**Verdict: Build it, but the spec is not implementation-ready as written.** The core mechanism is sound — reusing `buildRegistry`'s already-built Map instead of re-walking the raw `WorkflowDef`, and (most importantly) pinning validation before the specific `enter()` call rather than vaguely "before the loop" — is verified correct against the actual code by multiple independent lenses. This is a small, bounded, afternoon-sized change: one function in `graph.ts`, one `CrashReason` variant, one `doctorCmd` check. No architectural risk, no team/timeline risk. But two lenses independently traced the spec's own worked example against the real `enter()` code and found a genuine correctness bug at the spec's own stated boundary, and that must be fixed before anyone implements this.

**Required spec fixes, in priority order:**

1. **(Convergent: Devil's Advocate + Runtime/Engine Internals — highest priority, blocks correctness)** The EXIT-as-composite-initial exemption is wrong. The spec says a composite's `initial` is only flagged as `unresolved-target` when it's "neither EXIT nor a real registered id" — implying `initial: "EXIT"` passes validation. But `enter()` has no EXIT special-case: it does `registry.get("EXIT")`, gets nothing, and the caller crashes it as `unresolved-target` anyway today. So the validator would wave through the exact shape it exists to catch, defeating the feature's core promise ("fail before first dispatch") for this one case. Fix: either give `enter()` a real EXIT special-case (treat it as a valid terminal, not a lookup target) so the exemption becomes true, or drop the EXIT exemption specifically for composite-`initial` (keep it only for `on`/`next` on leaves, where EXIT legitimately ends a transition). Do not leave this as a "noted, not fixed" non-goal — it's not orthogonal, it's the spec contradicting its own stated semantics.

2. **(Convergent: Devil's Advocate + Build/Tooling Engineer)** Specify cycle deduplication. "Walk each composite's initial chain" with no stated starting-point rule means a single cycle A→B→A gets reported once per composite that feeds into it (once from A, once from B, once from anything upstream of A), undercutting "collect all problems, cleanly." Add an explicit rule: dedupe by cycle-set (e.g., canonicalize each cycle by its lexicographically-smallest member) before emitting.

3. **(Runtime/Engine Internals, single-lens but load-bearing)** State explicitly which composites the cycle walk starts from. `enter()` can be invoked later against any composite reached via `on`/`next`, not only ones reachable from `workflow.initial`'s chain — so composites unreachable from the root are still live hazards sitting in the registry. The spec's intent reads as "walk from every composite in the registry," but doesn't say so. Say it explicitly, or the implementer will under-scope it to just the root chain.

4. **(Realist, single-lens)** Specify the precedence/interaction between the `unresolved-target` and `initial-cycle` checks. If composite A's `initial` points at a nonexistent id, that's `unresolved-target`, not a cycle — the two checks must not double-report the same composite, and the cycle walk must terminate (not loop) when it hits an unresolved id mid-chain rather than treating "not yet visited" as "keep walking." State the order of operations.

5. **(Build/Tooling Engineer, single-lens, concrete implementation gap)** The spec never says what `crashed()` receives for `state`/`scopePath` on the new `invalid-workflow` reason — every existing `CrashReason` has a natural current-state, this one is a whole-graph problem discovered before `enter()` runs. Pin the convention explicitly (e.g. `opts.workflow.initial, []`, mirroring `DuplicateStateIdError`'s `err.id, []`) rather than leaving it inferred.

6. **(Convergent, lower severity: Devil's Advocate + Realist)** `from: "<root>"` is a bare string sentinel sharing the same namespace as real state ids, and nothing in `buildRegistry` forbids a state literally named `<root>`. Replace with a structurally distinct discriminator (e.g. a boolean `isRoot` field, or a reserved-prefix check added to `buildRegistry`) so a root error and a leaf error named `<root>` can't collide.

7. **(Convergent, acceptable-but-flag-it: Devil's Advocate + Realist)** `run()` and `doctorCmd` each independently build and validate the registry with no shared loader — fine at two call sites, but add one line to the spec flagging that a third consumer should trigger extraction into a shared `loadAndValidate` helper, so it isn't silently discovered later as drift risk.

**Lowest priority / can ship without:** the pre-existing `workflow.initial === EXIT` top-level edge case is correctly and separately parked as a non-goal (distinct from item 1's composite-`initial`-EXIT bug) — that one is genuinely orthogonal and fine to leave noted-not-fixed.

## Provenance
- **Confidence:** Medium-High — the design shape (second cheap pass over the registry, exact insertion point before `enter()`, the three checkable problem classes) is independently verified against the real code by three of five lenses doing close line-level tracing, so the "should we build this" half of the question is solid. Confidence isn't High because a load-bearing correctness bug (item 1) was found by tracing the spec's own example, not flagged by the spec itself — meaning the spec as currently written would ship a feature that fails its own headline promise on one input shape, and that needs a second pass before implementation, not just a caveat.
- **Agreement:** Three separate convergences, the strongest signal in this set: (a) Devil's Advocate + Runtime/Engine Internals independently derived the EXIT-initial hole by tracing `enter()`'s actual lookup behavior — same bug, found two different ways; (b) Devil's Advocate + Build/Tooling Engineer both flagged cycle-report duplication from the per-composite walk; (c) Devil's Advocate + Realist both flagged the `<root>` string sentinel as a fragile, collision-prone surface. All five agreed the change is small, cheap, and architecturally safe to build.
- **Divergence:** Optimist treated the EXIT case as a properly-scoped non-goal rather than a bug, missing what two other lenses caught by closer tracing — a real split, not just emphasis; the Optimist's reading is simply wrong on this point. Realist and Build/Tooling Engineer rated the doctor-duplication concern as minor/acceptable-for-now; Devil's Advocate rated it a harder gap ("can drift") — a severity disagreement, not a factual one.
- **Key driver:** Runtime/Engine Internals and Devil's Advocate, jointly — both did line-by-line verification of the spec's claims against `enter()`/`resolveTarget`'s actual behavior rather than taking the spec's prose at face value, surfacing the one fix that actually changes the implementation (item 1), as opposed to polish items.
- **Scores (corr/complete/action/uncert):**
  - Devil's Advocate: 9/8/6/8
  - Optimist: 5/4/5/5
  - Realist: 8/7/9/8
  - Runtime/Engine Internals: 9/9/7/8
  - Build/Tooling Engineer: 8/7/9/8
