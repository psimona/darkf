# Output validation: a declarative type or a script for a node's `output`, nudgeable on failure

A spec for `darkf-engine`'s dispatch loop (`darkf/src/engine/run.ts`),
`darkf-core`'s leaf types (`darkf/src/core/types.ts`), and the shared
nudge-message builder (`darkf/src/kit/agents/handoff.ts`). Out of scope:
the handoff **envelope** (`{ event, output, agentSessionId }` itself,
governed by `isNodeResult`/`malformed-result`) — that contract is already
standardized (`docs/specs/_built/agent-handoff/spec.md`) and untouched
here. This spec covers validating what rides inside `output` — the
payload the *next* node actually receives — before a dispatch is accepted
as `succeeded`.

## The problem

`BaseLeafDef` already has a `validate` hook: a plain function run against
a well-formed `NodeResult`, returning a failure message or `undefined`.
Two gaps:

1. It's the only option. A node that wants its `output`'s shape checked —
   "this must be an object with a string `summary` and an array of
   `Task`" — has to hand-write that as imperative code, every time, even
   though it's a declarative, generic check with no business logic in it.
2. Its failure (`CrashReason` kind `validation-failed`) is not in
   `NUDGEABLE_KINDS` (`darkf/src/engine/run.ts:43-47`). Today it falls
   straight to `continue attemptLoop` (`run.ts:311-315`) — a full fresh-
   session retry, discarding everything the agent already did, for
   something the agent is often one short correction away from fixing in
   the same session. This is exactly the gap `session-nudge`
   (`docs/specs/_built/session-nudge/spec.md`) left open: its three
   nudgeable kinds are all envelope-level (`handoff-missing`,
   `handoff-unparseable`, `no-transition`); content-level validation
   failure was explicitly not one of them.

## Design

### `outputType` on `AgentStateDef`, `validate` unchanged on `BaseLeafDef`

```typescript
// darkf/src/core/types.ts
export interface AgentStateDef extends BaseLeafDef {
  type: "agent";
  prompt: string;
  agent?: Record<string, unknown>;

  /** Generic structural check of result.output, run before `validate`.
   *  No author code — the engine walks the descriptor itself. Agent
   *  leaves only: a script leaf's output is already author-controlled
   *  code, not an LLM reply, so there's nothing for a declarative type
   *  check to catch that the script author didn't already guarantee. */
  outputType?: OutputType;
}

export type OutputType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly (string | number)[] }
  | { kind: "array"; items: OutputType }
  | { kind: "object"; properties: Record<string, OutputType>; required?: string[] };
```

`outputType` is the declarative "type" option, scoped to agent leaves —
the motivating case, and the only leaf kind whose `output` comes from
text an LLM produced rather than code the workflow author already wrote
and controls. `validate` (unchanged signature, unchanged location on
`BaseLeafDef`) remains the "validation script" option, still shared
between agent and script leaves exactly as it is today. Both are
optional and independent; a given agent leaf may set either, both, or
neither — see Order below for what happens when both are set.

### The checker

```typescript
// darkf/src/core/outputType.ts (new)
export function checkOutputType(value: unknown, type: OutputType, path = "output"): string | undefined
```

Fail-fast: returns the *first* mismatch as one descriptive message (e.g.
`output.tasks[2].title: expected string, got number`), not a collected
list — this matches `validate`'s own single-message return shape, and
keeps a nudge prompt short. No JSON-Schema import, no new dependency:
`OutputType` is a small hand-rolled subset, walked by plain recursive
code, consistent with `validate` already being "plain code" by design
(see its doc comment in `types.ts:60-65`).

### Where this plugs into the dispatch loop

`darkf/src/engine/run.ts`, right where `validate` already runs today
(after the bare-payload coercion, `run.ts:308-315`):

```typescript
const typeError =
  def.type === "agent" && def.outputType
    ? checkOutputType(result_.output, def.outputType)
    : undefined;
if (typeError !== undefined) {
  reason = { kind: "validation-failed", message: typeError };
  if (agentSessionId && nudgeAttempt < NUDGE_LIMIT) {
    nudgeAttempt++;
    continue;
  }
  continue attemptLoop;
}
const validationError = def.validate?.(result_, handoff);
if (validationError !== undefined) {
  reason = { kind: "validation-failed", message: validationError };
  if (agentSessionId && nudgeAttempt < NUDGE_LIMIT) {
    nudgeAttempt++;
    continue;
  }
  continue attemptLoop;
}
```

No new `CrashReason` kind. Both checks report through the existing
`{ kind: "validation-failed", message }` — the nudge template (below)
doesn't need to know which check produced the message, only what it
says. The inline nudge-eligibility check (`if (agentSessionId &&
nudgeAttempt < NUDGE_LIMIT) ...`) is copied verbatim from the pattern
`no-transition` already uses one branch below it (`run.ts:316-324`) —
`validation-failed` is a return-value check, not a thrown `AgentFailure`,
so it needs this inline form rather than going through the catch
block's `isNudgeable(reason)` path that `handoff-missing` /
`handoff-unparseable` / `runner-error` use.

### Order: type before script

Both checks run, in sequence, whenever both are configured on the same
agent leaf: `outputType` first, `validate` second. This mirrors the
precedent already set one layer up — envelope shape (`isNodeResult`)
always runs before any content check reaches it at all — by applying the
same "structure first" rule one level deeper, to the payload inside
`output`. It also protects `validate` authors: a script that assumes
`output.tasks[2].title` exists can safely destructure it once
`outputType` has already guaranteed the shape, instead of every script
needing its own defensive optional-chaining against malformed input.
Confirmed in review (2026-11-17): type-then-script, as drafted.

### `NUDGEABLE_KINDS`

```typescript
// darkf/src/engine/run.ts
const NUDGEABLE_KINDS = new Set<CrashReason["kind"]>([
  "handoff-missing",
  "handoff-unparseable",
  "no-transition",
  "validation-failed", // new
]);
```

This is the one-line change that makes `validate`'s existing rejections
nudgeable too, not only `outputType`'s — see Compatibility.

### Nudge message

`darkf/src/kit/agents/handoff.ts`, `nudgeMessage()` gains a fourth case,
alongside the existing three:

```typescript
case "validation-failed":
  return `Your output failed validation: ${failure.message}\n\nRewrite the handoff's "output" field to fix this and write it again to ${path}.`;
```

Nothing else changes: `nudgeMessage()` is already called unconditionally
by both runners (`opencode.ts:219`, `claude-code.ts:111`) purely off
`info.previousFailure`/`info.agentSessionId` — adding a case here is the
entire adapter-side change, no new per-runner plumbing (unlike
`session-nudge`'s own adapter work, which needed new session-id capture;
that capture already exists and is reused as-is).

This is the literal mechanism behind "nudge the previous session with the
output of the type validation (generic) or the output of the validation
script" — `failure.message` is whichever text produced the rejection,
quoted straight into the corrective prompt.

## Compatibility

Adding `"validation-failed"` to `NUDGEABLE_KINDS` changes behavior for
**every** workflow already using `validate` today, not just new
`outputType` adopters, and does so with no opt-in and no opt-out.

- **Before:** `validate` rejects → one `def.retries` slot spent → next
  attempt is a fresh session, full original prompt replayed.
- **After:** `validate` rejects → up to 3 same-session nudges (a short
  corrective message into the already-primed session) → only once all 3
  are exhausted does it fall through to the fresh-session retry, exactly
  as before.

This is not strictly an improvement, only usually one:

- **More dispatches per failure, not fewer.** `def.retries` counts outer
  attempts only — nudges are free and uncounted (by design, same as the
  other 3 nudgeable kinds). A leaf with `retries: 1` (2 fresh attempts
  today) can now cost up to 8 total dispatch calls per visit (2 attempts
  × up to 4 calls each: 1 initial + 3 nudges). Each nudge is normally
  cheaper and faster than a fresh retry (short message, no replayed
  prompt/context), but a sequence that nudges 3 times and still fails
  adds that latency *on top of* the eventual retry, not instead of it.
  Anyone who tuned `retries` assuming "N retries = N dispatch calls" now
  gets a different, larger bound.
- **No per-leaf escape hatch.** `retries`, `timeoutMs`, and
  `usageLimitRetryMs` are all leaf-tunable. Nudgeability isn't — there is
  no field to disable it for a leaf where a `validate` failure is a
  signal the session already went down a wrong path, and a clean fresh
  start would repair better than continuing it. This mirrors the other 3
  nudgeable kinds, none of which have an opt-out either, but it is a
  deliberate limitation, not an oversight.
- **The blast radius is invisible from inside this repo.** Nothing here
  uses `validate` in a real workflow today — only `run.test.ts` exercises
  it, as test fixtures (verified by grep across the monorepo). But
  `validate` is a public `darkf-core` field; any consumer repo that
  already wrote a workflow using it gets this behavior change
  automatically on its next `darkf` upgrade, with no signal that anything
  changed.

Confirmed in review (2026-11-17): ship with no opt-out, matching the
existing three nudgeable kinds. The failure mode this leaves on the table
— nudge up to 3 times, still fail, retry anyway — is never worse than
today's behavior, only sometimes slower.

## Non-goals

- No JSON-Schema import/export, no schema-library dependency — `OutputType`
  is intentionally a small closed set, not an escape hatch to arbitrary
  schemas.
- No multi-error collection — first mismatch only.
- No change to envelope-shape handling — `malformed-result` stays exactly
  as non-nudgeable as it is today; this spec only ever runs after a
  dispatch has already produced a well-formed `NodeResult`.
- No schema for `event` or `agentSessionId` — only `output`'s payload is
  ever checked.
- No cap on nudge-message length — a deep nested-path type error or a
  verbose `validate` message rides the corrective prompt as-is.

## Testing

- `checkOutputType`: each `kind`, nested object/array, a missing
  `required` field, a wrong primitive, an enum mismatch — one descriptive
  message per case, first-mismatch-wins when more than one field is wrong.
- Engine: a stub agent runner returning a bad-shaped `output` with a
  session id attached — assert a nudge fires, the nudge message quotes
  the generic type-check message, and the nudge count caps at 3 before
  falling to a real retry. Same scenario for a `validate`-rejected output,
  asserting the nudge quotes the script's own message instead.
- Regression: an existing workflow that already sets `validate` and no
  `outputType` — unaffected in shape (still rejects the same inputs), but
  its rejection path now nudges before retrying (see Compatibility) —
  assert this explicitly so it isn't an accidental side effect no test
  pins down.

## Open questions

None. All three raised in review (2026-11-17) are resolved: type-then-
script order confirmed (Order), `outputType` scoped to `AgentStateDef`
only (Design), no opt-out for the `validation-failed` nudge confirmed
(Compatibility).
