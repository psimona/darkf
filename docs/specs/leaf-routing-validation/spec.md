# Reject ambiguous leaf routing: `on` and `next` both set, enforced eagerly

A spec for a small, additive addition to `validateWorkflow`
(`docs/specs/_built/workflow-validation/spec.md`, shipped 2026-10-22, in
`darkf-core/src/graph.ts`). Today a leaf's `on` and `next` are both
independently optional, and `resolveTarget`'s fallback order — `on` wins if
the event matches, `next` otherwise — is discoverable only by reading its
source, not from the type. Nothing stops a leaf from setting both: silent,
undocumented precedence nobody can see without reading `resolveTarget`'s
body.

## Reconciliation note (2026-10-22)

This spec originally covered two gaps: a leaf setting **both** `on` and
`next`, and a leaf setting **neither**. The "neither" gap is now closed —
`validateWorkflow`'s `dead-end-leaf` check (workflow-validation, shipped
the same day) already flags exactly this: a leaf with `on` absent/empty
**and** `next` absent, including the `on: {}` edge case this spec's own
Open decisions once left unresolved (workflow-validation treats an empty
map the same as absent — both are dead ends). This spec is narrowed to the
one gap that check doesn't cover: **both set**.

## Problem

`BaseLeafDef` (`darkf-core/src/types.ts`) declares:

```ts
export interface BaseLeafDef {
  on?: Record<string, Target>;
  next?: Target;
  ...
}
```

Both optional, no relationship enforced between them. `resolveTarget`
(`darkf-core/src/graph.ts`) resolves the ambiguity at call time:

```ts
if (event !== undefined && def.on?.[event] !== undefined) return def.on[event];
return def.next;
```

**Both set.** `on` silently wins whenever the event matches; `next` is
silently dead code otherwise. An author who sets both gets no error, just
a leaf whose actual behavior depends on a precedence rule that exists only
in this function's body.

A direct audit of every `workflow.ts` in this repo (`haiku-readme`,
`article-classifier`, `haiku-commit`, `series-ordering`) confirms every
existing leaf already sets exactly one of `on`/`next` — no leaf sets both.
This validation is a pure safety net today, not a migration.

## Goals

- A leaf setting both `on` and `next` fails fast, before any dispatch,
  naming the offending state — reported the same way every other
  structural error already is: collected by `validateWorkflow`, surfaced
  through `run()`'s `invalid-workflow` crash and `darkf doctor`'s
  "workflow structure" check, not a separate mechanism.
- Zero type-level change. `BaseLeafDef` stays exactly as it is — `on?`,
  `next?`, both optional. This is a runtime/build-time check only.

## Non-goals

- **No TypeScript union/discriminated-type restructuring.** A
  mutually-exclusive type shape (a tagged union, or the `on?:
  undefined`/`next?: undefined` XOR idiom) was considered and set aside —
  see "Alternatives considered" below. This spec is the narrower, lower-risk
  fix.
- **No change to `resolveTarget`'s actual precedence.** `on` still wins
  when both would otherwise be legal; this spec makes "both set"
  impossible to construct, so the precedence question becomes moot rather
  than changed.
- **No validation of `on`'s targets resolving to real states** —
  `validateWorkflow`'s `unresolved-target` already does this, untouched
  here.
- **The dead-end-leaf ("neither") case** — already shipped; see
  Reconciliation note above.

## Design overview

### Where the check lives

`darkf-core/src/graph.ts`'s `validateWorkflow` already walks every leaf
once per call, checking its `on`/`next` targets for `unresolved-target`
and its absence for `dead-end-leaf`. This adds one more arm to that same
per-leaf branch — not a second pass over the registry, and not a second
error-reporting mechanism:

```ts
export type WorkflowValidationError =
  | { kind: "unresolved-target"; from: string | null; target: string }
  | { kind: "initial-cycle"; cycle: string[] }
  | { kind: "dead-end-leaf"; state: string }
  | { kind: "ambiguous-routing"; state: string }; // new
```

```ts
if (def.on !== undefined && def.next !== undefined) {
  errors.push({ kind: "ambiguous-routing", state: id });
}
```

No new `CrashReason` kind needed: `invalid-workflow`'s `errors` array
already carries any `WorkflowValidationError`; this is one more variant it
can hold. No new wiring in `run()` needed — it already surfaces every
`validateWorkflow` finding as one `invalid-workflow` crash.

### Wiring into `doctor`

`doctorCmd`'s `describeValidationError` (`darkf-cli/src/index.ts`) already
switches on every `WorkflowValidationError` kind to print one line per
problem; it gains one more `case "ambiguous-routing"`.

### `render` remains unvalidated — a pre-existing, shared gap

`darkf render` (`renderCmd`) still calls `renderMermaid(workflow)` directly
on the raw `WorkflowDef`, with no `buildRegistry`/`validateWorkflow` call
at all — true before workflow-validation shipped, and still true after,
since that spec wired only `run()` and `doctor`. Closing this is not
specific to "both set"; see Open decisions.

## Alternatives considered

Three type-level shapes were weighed against this runtime check and set
aside:

- **XOR union** (`{ on: Record<string, Target>; next?: undefined } |
  { on?: undefined; next: Target }`) — catches the mistake at compile
  time instead of build time, but forces `BaseLeafDef`/`AgentStateDef`/
  `ScriptStateDef` from `interface` to `type` (interfaces can't `extends` a
  union), a wider blast radius for a problem this repo's own workflows
  don't currently have.
- **Symbol-keyed sentinel** (`on: { [ALWAYS]?: Target } & Record<string,
  Target>`) — elegant internally (a `Symbol` can't collide with a real
  event name, and `Object.keys()` already excludes it from `validEvents`
  for free), but makes the common, simple case — a node with no real
  choice to make — harder to author than today's plain `next: "X"`. `next`
  exists specifically for that case's ergonomics; this would undo that.
- **Discriminated `kind` tag** — most exhaustiveness-checkable, but adds a
  mandatory field to every leaf for information already fully implied by
  which of `on`/`next` is set. Cuts against this repo's stated bias toward
  few configuration knobs (`PHILOSOPHY.md`).

## Cross-component contracts

- `darkf-core`: `graph.ts`'s `validateWorkflow` gains one more
  `WorkflowValidationError` variant and one more per-leaf check. No
  `CrashReason` change — `invalid-workflow` already carries it.
- `darkf-engine`: no change — `run()` already surfaces every
  `validateWorkflow` finding.
- `darkf-cli`: `doctorCmd`'s `describeValidationError` gains one more
  case. `renderCmd` still doesn't validate at all — same pre-existing gap,
  now this spec's only remaining open "wiring" decision.
- `darkf-opencode-plugin`: no change expected — it never switches on
  `WorkflowValidationError`, only `CrashReason`, which is unchanged.
- No existing workflow in this repo needs migration — confirmed by direct
  audit: all four `workflow.ts` files already set exactly one of
  `on`/`next` on every leaf.

## Verification strategy

- Unit test in `darkf-core/src/graph.test.ts`: a leaf with both `on` and
  `next` reports `{ kind: "ambiguous-routing", state }`; existing
  `dead-end-leaf`/`unresolved-target` tests unchanged.
- Unit test in `darkf-engine/src/run.test.ts`: a workflow with a
  both-set leaf crashes with `invalid-workflow` before any dispatch.
- `bun run check` at the repo root — all four existing examples plus
  `series-ordering` build/typecheck/pass unchanged, confirming the
  additive claim above.

## Open decisions

- **Should `darkf render` gain eager validation too?** Out of this spec's
  original scope (workflow-validation wired only `run()`/`doctor`), but
  the gap is real and would close the same way for both specs' errors at
  once — worth deciding as one shared follow-up rather than per-spec.
- **Message wording** for `describeValidationError`'s new
  `"ambiguous-routing"` case is a first draft, not final copy.
