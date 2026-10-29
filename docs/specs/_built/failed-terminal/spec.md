# Failed terminal: a failure-graded pseudostate, and DONE (renamed from EXIT) (Slice 1 DONE for this repo)

Archived here because this repo's entire scope (Slice 1: core + engine +
cli) is built and merged. Slices 2/3 (the `run_failure` node + per-edge
retarget table, and failure-metadata integration) are the consumer repo-side and
tracked there, not in this repo — see "Rollout slices" below.

A spec for `darkf-core` (sentinel + types), `darkf-engine` (terminal
transition), `darkf-cli` (registry/status/report rendering), and workflow
authors (one `run_failure` node + an edge-retarget table). Two changes, one
theme: today a graph that gives up is recorded as a graph that finished.

## Problem

Routing to `EXIT` is unconditionally success-graded. `darkf-engine/src/run.ts:301-306`:

```ts
if (nextTarget === EXIT) {
  // Run end marker: the run machine's terminal transition — the last
  // journal line on success.
  emit({ phase: "succeeded", result }, EXIT, []);
  return { runId, trace, node: { phase: "succeeded", result } };
}
```

The engine has exactly two endings: `succeeded` (EXIT reached) and
`crashed` (exception path). There is no grade for "the graph decided to
stop because it could not proceed."

Meanwhile the the consumer repo pilots route ~20 give-up edges to EXIT whose own
comments declare the intent: `unrecoverable`, `stuck_signature`,
`cap_exceeded`, every verify gate's `tooling_error`, every
`commit_failed`, the malformed-claim fallbacks, and the workspace pilot's
literal `run_failure: EXIT` edges. The composed workflow's header says it
plainly: run_failure is "a real node in the still-unported Completion
phase." Completion has since been ported (`final_quality` →
`behavioral_verification` → `finish_branch`); `run_failure` never was.

Evidence of the cost: a `verify_green` `tooling_error` at hour 3 records
registry `succeeded`, exit 0, and a success end marker — while
`tasks.json` still has the scope `in_progress` and the branch has no green
commit. Recovery works (detect_resume redoes the scope), but every human
and machine reading the run's verdict is misinformed, and none of the
postmortem tooling counts such an ending as a failure.

## Root cause

The engine's terminal vocabulary has one success-graded pseudostate, so
graph authors with no failure destination route failure-classified events
to the success terminal. The `run_failure` node that the earlier reference project's original
resolved these edges into was never ported.

## Design

### 1. Naming: `EXIT` becomes `DONE`

`EXIT` describes a mechanism (the machine stopped); the rename describes
the semantics (the graph completed its work). In `darkf-core/src/types.ts`:

```ts
export const DONE = "[*]" as const;    // was EXIT — success-graded terminal
export const FAILED = "[-]" as const;  // new — failure-graded terminal
export { DONE as EXIT };               // deprecated alias — see lifetime below
```

`"[−]"` mirrors `"[*]"`'s pseudostate notation (UML final states; `[-]` is
this engine's failure-graded counterpart). Mechanically both sentinels
still resolve to the machine's terminal marker — the difference is the
grade the engine emits.

**Alias lifetime, decided:** grepping every non-test usage of `EXIT` in this
repo today finds exactly 5 workflow-authoring call sites, all inside darkf
itself: `examples/{haiku-readme,haiku-commit,article-classifier,task-queue}`
and `workflows/series-ordering`. Zero usages in the consumer repo, which depends on
darkf as a packed dependency and still routes its pilots' give-up edges to
`EXIT` on its own schedule. This spec's own PR renames all 5 internal call
sites to `DONE` — no transition period needed, since darkf controls all 5.
The alias therefore exists for exactly one reason: the consumer repo's ~20 give-up
edges, until Slice 2 (the `run_failure` node + retarget table, landing in
the consumer repo) retargets them. The alias is removed — `export { DONE as EXIT }`
deleted — in the same PR that lands Slice 2. That deletion *is* the
enforcement mechanism: any surviving `EXIT` import fails to compile. No
lint rule or CI grep check needed.

### 2. Engine: the failed terminal transition

`darkf-core/src/types.ts`'s `NodeStatus` union (currently `pending |
running | succeeded | crashed`) gains a 5th variant: `| { phase: "failed";
result: NodeResult }`. `emit()` is typed by `NodeStatus`, so this is a
prerequisite for the branch below, not an implementation detail of it.

Beside the EXIT branch in `run.ts`:

- `target === FAILED` → emit `{ phase: "failed", result }` as the end
  marker, return `{ phase: "failed", result }`.
- The `result` crossing into FAILED is whatever the `run_failure` node
  produced — by convention a `FailureEnvelope`-shaped record (see
  `../failure-metadata/spec.md`), so the terminal entry carries kind,
  failing state, and the last dispatch's facts.
- **Ordering constraint, explicit:** the `target === FAILED` check must sit
  strictly before the `registry.has(nextTarget)` unresolved-target guard —
  the same position `target === EXIT` already occupies (line 301, before
  the guard at line 308). `FAILED`, like `EXIT`, is a sentinel with no
  registry entry; checked after the guard, every `FAILED`-routed dispatch
  crashes as `unresolved-target` instead of grading as failed, silently
  defeating this entire spec. The engine test suite must assert this
  directly: a workflow routing to `FAILED` ends with `{ phase: "failed" }`,
  never a `crashed`/`unresolved-target` result.

`crashed` semantics unchanged: still the exception path, still no end
marker.

### 2a. `darkf-cli`: every place that currently closes over `succeeded`/`crashed`

Verified directly against the code — six call sites, not "registry status
failed; status exit code 1" as a summary:

- `registry.ts`: `RegistryStatus` (`"running" | "succeeded" | "crashed"`)
  gains `"failed"`.
- `registry.ts`: `TerminalOutcome` gains `"failed"`; `journalTerminal()`
  gains a third check (`last.state === FAILED && last.status.phase ===
  "failed"` → `"failed"`), alongside its existing `succeeded`/`crashed`
  checks.
- `status.ts`: `TerminalState` gains `"failed"`; `classifyTerminal()`
  picks it up for free via `journalTerminal()`.
- `status.ts`'s `foldJournal`: `hasEnd`/`finalResult` are gated on
  `last.state === EXIT && last.status.phase === "succeeded"` only. This
  must gain a parallel `last.state === FAILED && last.status.phase ===
  "failed"` case — **without it, a failed run's `hasEnd` stays `false`,
  indistinguishable from a run still in progress**, which is exactly the
  misreporting this spec exists to fix, one layer up.
- `status.ts`'s `foldReport` (the `darkf report` fold): its `running` /
  `succeeded` / `crashed` `if`/`else if` chain has no catch-all — a
  dispatch ending in `failed` is silently dropped from the report's
  `dispatches` array today. Needs its own `else if (st.phase ===
  "failed")` branch, mirroring the `crashed` one.
- `index.ts`'s status→exit-code switch (`statusExit`): exhaustive over
  `TerminalState`, needs a `case "failed": return 4;` — 4 is the first
  free value in this switch (0/1/2/3 taken by succeeded/crashed/orphaned/
  running).
- `index.ts`'s `monitorCmd` `"terminal"` case and `monitorRun`'s poll loop:
  **two more call sites, not previously named.** Both currently branch
  `if (outcome/state === "succeeded") ... [implicit else] crashed` with no
  third case — verified at lines ~708-716 and ~665-677. Once
  `TerminalOutcome`/`classifyTerminal` can return `"failed"`, these two
  sites silently relabel every failed run as `crashed` (exit 1), one layer
  above the misreporting bug this spec exists to fix. Both need an
  explicit `failed` branch, returning exit code 3 — `monitor`'s own
  switch already uses 0/1/2 (succeeded/crashed/orphaned) and 4/5/6/7
  (noSuchRun/ambiguous/still-running/nothing-to-monitor), leaving 3 as its
  one free value. `status` and `monitor` already use different numbers
  for the analogous "running" state (3 vs 6) — this keeps that existing,
  independent-per-command precedent rather than inventing a false
  cross-command consistency requirement.

### 3. Grades are routing, not metadata

darkf rejected condition-expression edges (PHILOSOPHY.md), and this spec
adds no new edge syntax. The three grades from the postmortem proposal map
onto routing choices the graph already expresses:

- **retry** — edge routes back to the node that failed; bounded by that
  node's existing `retries`. (`commit_failed: "commit_red"`)
- **escalate** — edge routes to `task_plan`; the pattern already proven by
  the composed workflow's hand-patches (`spec_gate deadlock → task_plan`,
  `verify_red invariant/design_conflict → task_plan`,
  `verification_deadlock → task_plan`).
- **stop** — edge routes to `run_failure`; the graph has nothing left to
  try.

The design work is therefore a reviewable per-edge target table (below),
not a new expression language.

### 4. The `run_failure` node (workflow-authoring convention)

One script node per composed workflow (not an engine primitive — same
standing as `commit_dirty`). Contract:

1. Read the failing dispatch's facts from the handoff (the engine passes
   the prior node's result through).
2. Flip the current scope's `tasks.json` status to `failed` — the one
   scope status flip a non-commit node is allowed to make, because no
   commit script will run after it.
3. Commit (scope status + any dirty scope artifacts) — committed files
   stay the source of truth, so detect_resume's contract is preserved.
4. Route to `FAILED`.

### 5. Per-edge target table (the reviewable part)

Retargets for the the consumer repo pilots, to land with this spec:

| Edge | Today | Becomes |
|---|---|---|
| verify gates' `tooling_error` (×8) | EXIT | `run_failure` (stop) |
| commit nodes' `commit_failed` (×6) | EXIT | back to the commit node (retry, bounded by `retries`), then `run_failure` |
| verify_red `unrecoverable` / `stuck_signature` | EXIT | `run_failure` (stop) |
| ttt `cap_exceeded` | EXIT | `run_failure` (stop) |
| malformed-claim fallbacks | EXIT | `run_failure` (stop) |
| verify_green/verify_refactor `setup_issue` | EXIT | `run_failure` (stop — environment, inform) |
| planning `preflight_failed` / `commit_failed` | EXIT | `run_failure` (stop) |
| verify_red `invariant` / `design_conflict` (pilot) | EXIT | `task_plan` (escalate; composed already patches these) |
| spec_gate `deadlock` / `no_verdict` (pilot) | EXIT | `task_plan` (escalate; composed already patches deadlock) |
| verification_deadlock (pilot) | EXIT | `task_plan` (escalate; composed already patches) |
| challenge_rca `refuted_final` / `no_cause` | EXIT | keep EXIT→DONE (legitimate: nothing to do) |
| workspace `clean`/`resume`, planning `coverage_ok` | EXIT | keep (composed continues the graph; composed-only edges) |

### 6. Scope status vocabulary

`tasks.json` scope statuses gain `failed` (alongside pending/in_progress/
done). `next_task` treats `failed` as retryable on a later run — same
queue position as `pending`. A failed scope is therefore re-attempted, not
silently skipped, on the next start; a supervisor who wants it skipped
edits tasks.json (explicit, reviewable).

### 2b. Mermaid: `[-]` has no built-in meaning, unlike `[*]`

`darkf-core/src/mermaid.ts:15` special-cases exactly one token:
`t === EXIT ? "[*]" : t`. `[*]` isn't a convention this codebase chose —
it's `stateDiagram-v2`'s one hardcoded pseudostate token. `FAILED`
("[-]") has no equivalent built-in meaning: left unhandled, a
`FAILED`-targeting edge renders as a plain state literally labeled
`[-]`, not a terminal marker — a structurally broken diagram, not merely
an unlabeled one. `mermaid.ts` needs the same special-case for `FAILED`
as it already has for `EXIT`/`DONE`.

## Non-goals

- No auto-restart of failed runs (philosophy: inform, supervisor decides).
- No new edge-condition expressions — grades are routing choices.
- No change to `crashed`/`orphaned` semantics (registry-lifecycle's
  territory).
- No repair intelligence in `run_failure` — bookkeeping only;
  `completion_repair` already owns repair.

## Rollout slices

1. **Core + engine + cli:** DONE rename (+ deprecated EXIT alias), FAILED
   sentinel, terminal branch, registry `failed` status, status/report
   rendering, engine tests for both terminals.
2. **Consumer repo:** `run_failure` node, per-edge retarget table, pilots
   migrated off the EXIT alias.
3. **Failure-metadata integration:** run_failure's record adopts the
   envelope shape once that channel lands (the node's output contract is
   designed for it now).

## Downstream

Two specs are blocked on this one landing first:

- `../workflow-validation/spec.md` — its eager `unresolved-target` check
  hardcodes the valid leaf-edge terminal set as `{EXIT}` today; it needs
  `FAILED` added, given the identical treatment already given `EXIT`
  (valid for a leaf's `on`/`next`, never for any `initial`).
- `../the consumer repo/docs/specs/completion-phase-port/prd.md` — its
  `run_failure` node (REQ-7/REQ-8) needs the `FAILED` pseudostate to end a
  run as failed without it being misreported as `succeeded`.

## Open questions

- Should `status`/`monitor` word a failed ending distinctly
  ("run stopped itself at verify_red: tooling_error") — engine knows the
  node, so yes in principle; exact copy at implementation.

## Deliberately deferred (not an engine concern)

The `commit_failed → retry → run_failure` row in §5's per-edge table is not
implementable as stated: `def.retries` bounds only the internal
crash/timeout re-dispatch loop for a single node visit, and resets on
re-entry via an ordinary `on`-edge self-loop — it does not bound a
`commit_failed → commit node` retry loop the way the table implies.
Closing this needs either an explicit `maxCycles` on the 6 affected
commit-node composites, or simplifying the edge to route straight to
`run_failure` like the other ~14 edges in the table.

This is left open on purpose: it is a workflow-authoring decision about
the consumer repo's own pilot composites (which 6 nodes, what bound, or whether to
simplify), not a `darkf-core`/`darkf-engine` change — out of scope for
Slice 1 and for this repo's engine work generally. It belongs with Slice 2
(`run_failure` node + retarget table, landing in the consumer repo) and should be
resolved there, not guessed here.
