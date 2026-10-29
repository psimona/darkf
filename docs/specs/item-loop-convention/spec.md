# Item-loop convention: a shared helper for "plan, then dispatch the next item until exhausted"

A spec for a new `darkf-cli` export, `item-loop.ts`. It gives workflow
authors one correct, crash-safe way to build a common shape: a plan step
makes a list of items. A dispatcher sends each item, one at a time, until
the list is empty. No `darkf-core`/`darkf-engine` change.

> Placement update, 2026-10-29: `package-boundaries` decided Option D —
> `item-loop.ts` is born in the merged package's `kit/` folder
> (`src/kit/item-loop.ts`), not in `darkf-cli`. Paths below still read
> `darkf-cli/src/...`; translate during the merge.

## Problem

`darkf-core` already expresses "a dispatcher leaf routes to one of
several lanes, each with its own retry loop," with zero new types. What
darkf has never had is a correct, reusable answer to the one hard part:
picking the next item off a list whose size is not known until run time,
and making that pick survive a crash.

This repo already has the easy, unsafe version of this pattern:
`darkf-cli/examples/article-classifier/scripts/queue.ts` loops over a
fixed array using plain module-scope state (`let index = 0`). Its own
comment calls this "the sanctioned escape hatch," sanctioned only because
the array does not need to survive a restart. The moment the item list
comes from a real plan — and the plan must survive a crash — module state
is wrong, and every workflow author ends up building their own version,
slightly differently each time.

A real version of this pattern already runs in production:
the consumer repo/darkf/build-lanes-pilot/scripts/next_task.ts`, dispatching
scopes out of `docs/specs/<feature>/tasks.json` one at a time, into one of
several lanes (`tddLoop`, `ralphLoop`, the bugfix preamble). This spec
generalizes that design into a shared `darkf-cli` helper.

## Goals

- One `darkf-cli` export: a plan file reader/writer, a next-item picker,
  and two small helpers. No new `StateDef` variant.
- Crash-safe in the case that matters most: the whole process dies and
  restarts with a brand-new `runId`. The plan must still be there.
- A pick-next rule that verifies an item's real completion against an
  independent check, when one exists, rather than trusting a cached
  status flag on faith.
- A clear, correct rule for where `maxCycles` goes.
- One worked example, with a real crash-and-restart test, not just a unit
  test.

## Non-goals

- **Parallel item dispatch.** One item at a time. Fan-out is a different
  shape; build it only if a real need for it shows up.
- **A `failed` item state.** An item's own lane handles its own retries
  and repairs. If a lane gives up, that is the lane's own crash or its own
  terminal event — not a new state on the plan item.
- **Automatic `maxCycles` wiring.** `WorkflowDef` is a static object,
  built before any run starts and before the real item count is known. A
  workflow author still sets `maxCycles` by hand.
- **Rendering "item N of M" in the opencode TUI plugin.** The data this
  spec adds to `NodeResult.output` makes that possible later. Building the
  renderer is separate, later work.

## Design overview

### The graph shape

```
Plan       (script; makes sure the plan file exists; writes it once)
Dispatch   (script; picks the next open item, or signals the plan is empty)
  -> Lane A (composite or leaf; its own maxCycles for one item's retries)
  -> Lane B (composite or leaf; its own maxCycles)
  -> ... one lane per item kind
```

Each lane's last leaf transitions back to `Dispatch` by its state id — a
flat edge, not through an enclosing composite. `Dispatch` signals "done"
(by whatever state id or `EXIT` follows the loop) once the plan is empty.

`Dispatch` is not wrapped in one composite together with every lane. Each
lane owns its own retry budget, bounded by its own `maxCycles`, sized for
that one item's worst case. The loop that moves from item to item —
`Dispatch` re-entered once per item, for the whole run — carries no
`maxCycles` of its own; the engine-wide `maxSteps` already bounds a true
runaway. If a workflow needs a hard cap on the total item count, that is a
plain counter check inside `Dispatch`'s own script, not an engine
primitive.

### The item record

```ts
export type ItemStatus = "pending" | "in_progress" | "done";

export interface PlanItem<T> {
  id: string;
  payload: T;
  status: ItemStatus;
}

export interface Plan<T> {
  items: PlanItem<T>[];
}
```

Three states. No `"failed"` — see Non-goals.

### The plan file's location

The caller supplies the file's path. Two recipes:

- **Durable, feature-scoped (the default).** `docs/specs/<feature>/<planName>.json`.
  Keyed by the feature, not by `runId`, so it survives any number of
  restarts. `darkf-cli/src/index.ts` mints a fresh `randomUUID()` `runId`
  on every `darkf start`/`darkf run` invocation (lines 299 and 367) — a
  crash followed by a fresh `darkf start` gets a new `runId`, so only a
  path keyed by something durable, not by `runId`, survives that restart.
  Git-tracked, reviewable, the same way `tasks.json` is.
- **Ephemeral, run-scoped.** `.darkf/run/<runId>/plans/<planName>.json`.
  Correct only when the plan has no meaning outside one process's single
  pass. Most item loops are long-running work exactly because they are
  not this case — default to the durable recipe unless this one is
  clearly right.

Keying the path by a durable identity, not by `runId`, means one plan
file per job — any run working on the same feature resolves to the same
path and sees the same item statuses, which is what makes progress
correct across a restart. It also means one precondition: only one run
may be active against a given feature at a time, or two runs can write
the same plan file out from under each other. `next_task.ts` enforces
this directly — before it touches the plan, it checks that the current
git branch is `feature/<feature>`, and refuses to dispatch otherwise.
`Dispatch`'s own script must carry the same check (or an equivalent durable
single-writer guard) whenever the plan file recipe is the durable,
feature-scoped one.

### Picking the next item: verify, don't trust

`next_task.ts`'s `reconcileNextScope` treats a scope's cached `status` as
a hint, not a fact. On every dispatch, it re-checks the next not-`"done"`
scope against `terminalCommitLanded(scopeId)` — a real `git log` check —
and flips a stale `"pending"`/`"in_progress"` scope to `"done"` as it
walks past it, before returning the scope that is genuinely still open.
This generalizes directly:

```ts
// darkf-cli/src/item-loop.ts

/** Reads the plan file at `path`. Returns null if it does not exist yet. */
export function readPlan<T>(path: string): Plan<T> | null;

/** Writes the plan file at `path`. Atomic: write to a temp file, then
 *  rename over the real path, so a crash mid-write cannot corrupt it. */
export function writePlan<T>(path: string, plan: Plan<T>): void;

/**
 * 1. Find the first item whose status is not "done".
 * 2. If none, return undefined — the plan is exhausted.
 * 3. If `isLanded` is given and returns true for that item, flip its
 *    status to "done", write the plan, and go back to step 1.
 * 4. Otherwise, return that item — "pending" or "in_progress" both mean
 *    "dispatch this one." A crash mid-item recovers for free: the
 *    interrupted item is simply the next one picked, with no special
 *    case for its exact prior status.
 *
 * Pass `isLanded` whenever one real, independent check exists for "did
 * this item's work actually finish" — a git-log grep, a file that only
 * exists on success, an API call. Nothing is trusted that is not
 * independently verifiable, so a stale or lost status write can never
 * cause a skipped item or a repeated one.
 *
 * Omit `isLanded` only when no such check exists. Dispatch must then call
 * `markInProgress` before starting the item's real work and `markDone`
 * once its result is confirmed, and an `in_progress` status found on
 * resume is trusted at face value. This path is correct only as long as
 * `markDone` is never called before the work is actually confirmed done.
 */
export function pickNextItem<T>(
  path: string,
  plan: Plan<T>,
  isLanded?: (item: PlanItem<T>) => boolean,
): PlanItem<T> | undefined;

/** No independent check available only. Sets status to "in_progress" and
 *  writes the plan before the real work starts. */
export function markInProgress<T>(path: string, plan: Plan<T>, itemId: string): Plan<T>;

/** No independent check available only. Sets status to "done" and writes
 *  the plan. Call this only once the item's real result is confirmed. */
export function markDone<T>(path: string, plan: Plan<T>, itemId: string): Plan<T>;

/** True once every item's status is "done". */
export function isExhausted<T>(plan: Plan<T>): boolean;

/** { done, total, itemIndex } — itemIndex is 1-based, the done count + 1,
 *  capped at total. Used for the journal-visibility convention below. */
export function progress<T>(plan: Plan<T>): { done: number; total: number; itemIndex: number };

/** Sizes one item's own lane's maxCycles, for that item's worst case
 *  only — never multiplied by item count. slack defaults to 1.5. */
export function estimateMaxCycles(maxDispatchesForOneItem: number, slack?: number): number;
```

### The journal-visibility convention

Every per-item leaf's `NodeResult.output` should include
`{ itemId, itemIndex, itemsTotal }`, from `progress(plan)` plus the picked
item's own id. The journal already records every `NodeResult` verbatim,
so this needs no new channel: `cat .darkf/run/<runId>/journal.jsonl | jq
.status.result` already shows per-item progress.

As a small, additive step, `darkf-cli/src/status.ts`'s `foldJournal` gains
one optional field, `digest.current.itemProgress?: { itemIndex: number;
itemsTotal: number }`, read from the current leaf's last result when
present. Workflows that do not use this convention see `itemProgress:
undefined` — unchanged behavior. `darkf status` prints it as a suffix,
e.g. `Dispatch (running, 2m, item 3/7)`, when present.

## Cross-component contracts

- `item-loop.ts` depends only on `darkf-core`'s `NodeResult` type (for the
  `output` shape convention) and the filesystem. No dependency on
  `darkf-engine` or any `AgentRunner`/`ScriptRunner`.
- Exported from `darkf-cli` via `darkf-cli/src/exports.ts`
  (`export * from "./item-loop.ts"`). No new workspace package.
- `status.ts`'s `itemProgress` field is additive. Every existing caller
  (`darkf status`, `darkf monitor`, `darkf-opencode-plugin`'s
  `digest.ts`) compiles and behaves the same when a workflow does not use
  this convention.
- No change to `WorkflowDef`, `StateDef`, `CompositeStateDef`,
  `NodeResult`, `DispatchInfo`, or any `darkf-engine` file.

## Error handling

- `writePlan` writes to a temp file, then renames over the real path. A
  crash mid-write leaves the temp file orphaned and the real file
  untouched — never a half-written, unparseable plan.
- `readPlan` on a file that exists but fails to parse throws. It does not
  return an empty plan in its place — that would hide real data loss.
- A `Dispatch` script that calls `pickNextItem` before `Plan` has written
  the file sees `readPlan` return `null` first. That is a workflow wiring
  bug — wrong edge order — and the script should treat it as a crash, not
  invent a plan.

## Verification strategy

A new example workflow, `darkf-cli/examples/item-loop-demo`:

1. **Happy path.** A runtime-built item list, read from a fixture file,
   not a compile-time array. Full run to completion. `darkf report` shows
   exactly one dispatch per item.
2. **Crash, then a brand-new process.** Kill the process mid-item. Start
   a new `darkf start` invocation — a new `runId` — against the same
   feature-scoped plan path. Confirm the plan is found, the interrupted
   item is picked again, and no earlier item re-runs.
3. **Ground-truth self-heal.** With `isLanded` wired to a real check (a
   file written only on success, in the demo's case), manually edit the
   plan file to mark a genuinely finished item back to `"pending"`.
   Confirm `pickNextItem` flips it straight to `"done"` and does not
   redispatch it.
4. `bun test` coverage for `item-loop.ts`: the atomic write, the four-step
   `pickNextItem` logic above, `isExhausted`, and `progress`.

## Success criteria

- `item-loop.ts` ships with the API above, exported from `darkf-cli`,
  fully unit-tested.
- All three live scenarios in Verification strategy pass, logged the same
  way every roadmap ticket in this repo already logs its own proof.
- `darkf status`'s `item N/M` suffix renders on the demo workflow and is a
  silent no-op on every existing example and the private `series-ordering`
  workflow.
- Zero changes to `darkf-core`/`darkf-engine` files or their tests.

## Open decisions

- **Which workspace package `item-loop.ts` belongs in long-term** is
  deferred to `docs/specs/package-boundaries/spec.md`, which investigates
  darkf's whole package layout, not just this one file. This spec places
  `item-loop.ts` in `darkf-cli` for now, matching `status.ts`/`registry.ts`,
  and moves with them if that spec's recommendation is adopted.
- **Should the no-ground-truth path exist at all, or should every real
  use of this convention be pushed to supply a check?** Left in for now —
  some item kinds, such as an LLM summary with no checkable side effect,
  may have no cheap independent check available. Revisit if that path
  causes a real incident.
