# Output validation: a type or a script for the `output` of a node, with a nudge on failure

This spec covers three files: `darkf/src/engine/run.ts` (the dispatch
loop), `darkf/src/core/types.ts` (the leaf types), and
`darkf/src/kit/agents/handoff.ts` (the nudge message builder). It also
extends `isNodeResult`, the envelope check from
`docs/specs/_built/agent-handoff/spec.md`, to the same pattern used
below. `isNodeResult` keeps its behavior: it still runs first, and a
failure still crashes as `malformed-result`, non-nudgeable. This spec
covers both checks a dispatch result passes through: the envelope,
`{ event, output, agentSessionId }`, and the payload inside `output`,
checked before a dispatch counts as `succeeded`.

## The problem

`BaseLeafDef` already has a `validate` hook. It is a plain function. It
runs against a well-formed `NodeResult`. It returns a failure message,
or `undefined`. Two gaps remain:

1. `validate` is the only option. A node that wants to check the shape
   of its `output` must write that check as code, every time. This is a
   shape check, not business logic. It should not need custom code.
2. A `validate` failure does not nudge. Its `CrashReason` kind,
   `validation-failed`, is not in `NUDGEABLE_KINDS`
   (`darkf/src/engine/run.ts:43-47`). The dispatch loop sends it
   straight to `continue attemptLoop` (`run.ts:311-315`). This starts a
   new session and discards work the agent already did, even when one short
   correction would fix it in the same session. `session-nudge`
   (`docs/specs/_built/session-nudge/spec.md`) left this gap open on
   purpose: its three nudgeable kinds all check the envelope
   (`handoff-missing`, `handoff-unparseable`, `no-transition`). None of
   them check content.

## Design

### `outputType` on `AgentStateDef`

```typescript
// darkf/src/core/types.ts
export interface AgentStateDef extends BaseLeafDef {
  type: "agent";
  prompt: string;
  agent?: Record<string, unknown>;
  outputType?: OutputSchema; // checks result.output, before `validate` runs
}

export interface OutputSchema {
  safeParse(value: unknown): { success: true } | { success: false; message: string };
}
```

`outputType` only applies to agent leaves. The `output` of an agent
leaf comes from text an LLM wrote. The `output` of a script leaf comes
from code the workflow author already wrote and controls. `validate`
keeps its current signature and location on `BaseLeafDef`. It stays
available on
both agent and script leaves. A leaf may set `outputType`, `validate`,
both, or neither. See "Order" below for what happens when a leaf sets
both.

`OutputSchema` is narrow on purpose. Zod, Valibot, and a hand-written
object can all implement `.safeParse()` in a few lines. darkf-core
never imports a schema library in its own code. Its public types never
depend on one either.

### Zod as a dependency, `OutputSchema` as the public type

`darkf/package.json` now lists Zod as a real dependency. This is the
first runtime dependency for darkf-core. Shape validation for an
arbitrary type is not a simple problem, so a dependency is the right
tool here. Zod holds an established, popular place in this space, with
no extra dependencies of its own.

The `outputType` field still stays typed as `OutputSchema`, not
`z.ZodType`. A field typed `z.ZodType` would tie the public type of
`AgentStateDef` to one Zod version. A consumer repo on a different Zod
major version would hit real type errors, even in a workflow that never
sets `outputType`. `OutputSchema` avoids this. For `outputType` and
`validate`, the engine and dispatch-loop code of darkf-core never
imports Zod directly. Only the adapter below does. (One later
exception, scoped narrowly: see "Extending `isNodeResult` to the same
pattern.")

### The Zod adapter

```typescript
// darkf/src/kit/validation/zod.ts
import type { z } from "zod";
import type { OutputSchema } from "../../core/index.ts";

export function zodOutputType<T>(schema: z.ZodType<T>): OutputSchema {
  return {
    safeParse: (value) => {
      const result = schema.safeParse(value);
      if (result.success) return { success: true };
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
        .join("; ");
      return { success: false, message };
    },
  };
}
```

The adapter joins every `safeParse` issue into one message, not just
the first. `error.issues` already holds every failure from one parse
call, so nothing about the engine or the nudge message needs to stop at
the first. This matters for a schema with several independently
failing fields: one nudge round can now name all of them, instead of
fixing one field per nudge and never converging within the three-nudge
cap.

A Valibot or ArkType adapter follows the same shape. darkf ships the
Zod version because Zod is already the common schema vocabulary for LLM
tool calls.

### Schema-first authoring

A workflow author writes the schema once, in its own file. `z.infer`
derives the TypeScript type from it:

```typescript
// workflows/dev-loop/schemas/plan-output.ts
import { z } from "zod";
import { zodOutputType } from "@psimona/darkf/src/kit/validation/zod.ts";

const PlanOutputSchema = z.object({
  summary: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string() })),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export const planOutputType = zodOutputType(PlanOutputSchema);
```

The workflow definition imports only `planOutputType`:

```typescript
// workflows/dev-loop/workflow.ts
import { planOutputType } from "./schemas/plan-output.ts";
// ...
Plan: { type: "agent", prompt: PLAN_PROMPT, outputType: planOutputType, on: { planned: "ValidatePlan" } },
```

`workflow.ts` never imports Zod. It stays what PHILOSOPHY.md already
calls it: a plain TypeScript object, the single place that defines the
structure of the graph.

### Where this plugs into the dispatch loop

`darkf/src/engine/run.ts` runs this check where `validate` already runs
today, after the bare-payload coercion (`run.ts:308-315`):

```typescript
const typeResult =
  def.type === "agent" && def.outputType
    ? def.outputType.safeParse(result_.output)
    : undefined;
if (typeResult && !typeResult.success) {
  reason = { kind: "validation-failed", message: typeResult.message };
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

This adds no new `CrashReason` kind. Both checks report through the
existing `{ kind: "validation-failed", message }` shape. The
nudge-eligibility check copies the pattern `no-transition` already uses
one branch below it (`run.ts:316-324`). `validation-failed` comes from
a return value, not a thrown `AgentFailure`. It needs this inline form.
It cannot use the `isNudgeable(reason)` path inside the `catch` block,
since that path only runs for `handoff-missing`, `handoff-unparseable`,
and `runner-error`.

### Order: type before script

A leaf that sets both checks runs `outputType` first, then `validate`.
This matches the rule one level up: `isNodeResult` always checks the
envelope before any content check runs. It also helps `validate`
authors. A script can read `output.tasks[2].title` directly, once
`outputType` already confirmed that shape exists. It does not need its
own defensive checks against bad input. Confirmed in review
(2026-11-17): type before script, as drafted.

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

This entry records `validation-failed` as a nudgeable kind, for
accuracy. The dispatch loop reads `NUDGEABLE_KINDS` in one place only:
the `catch` block at `run.ts:345`, for a thrown `AgentFailure`. The
`no-transition` entry works the same way. Its own branch never reads
the Set either. The real change in behavior comes from the inline
nudge check shown above, added directly to both branches. See
Compatibility.

### Nudge message

`nudgeMessage()` in `darkf/src/kit/agents/handoff.ts` gains a fourth
case:

```typescript
case "validation-failed":
  return `Your output failed validation: ${failure.message}\n\nRewrite the handoff's "output" field to fix this and write it again to ${path}.`;
```

Both runners already call `nudgeMessage()` on every dispatch
(`opencode.ts:219`, `claude-code.ts:111`). This case is the only change
needed. `failure.message` carries whichever text caused the rejection,
type check or script, straight into the corrective prompt.

Every nudge dispatch already gets journaled, with no change needed
here. `nudgeAttempt` and `nudgeReason` ride on the `running` status
`emit()` writes at the start of each dispatch and on every heartbeat
(`run.ts:238`, `run.ts:272`, `run.ts:122-126`). `emit()` writes every
status to `journal.jsonl` unconditionally. A `validation-failed` nudge
reuses this same path: nothing new to wire up, since it shares the
`nudgeAttempt` counter and the inner dispatch loop with the three
nudgeable kinds already shipped.

### Extending `isNodeResult` to the same pattern

`isNodeResult` (`darkf/src/core/types.ts:21-32`) checks the envelope:
an object, with `event` and `agentSessionId` as strings when present.
It runs before any check this spec adds (see "Order" above, one level
up from the content check). Now that Zod is a real dependency, it
moves to the same pattern:

```typescript
// darkf/src/core/types.ts
const NodeResultSchema = z.object({
  event: z.string().optional(),
  output: z.unknown().optional(),
  agentSessionId: z.string().optional(),
});

export function isNodeResult(value: unknown): value is NodeResult {
  return NodeResultSchema.safeParse(value).success;
}
```

No `.strict()`: an object with extra fields still passes, the same as
today. The function keeps its name, its signature, and its place in
the dispatch loop. A failure still crashes as `malformed-result`, still
outside `NUDGEABLE_KINDS`, exactly as
`docs/specs/_built/agent-handoff/spec.md` already defines it. This is
an implementation change only, with one real behavior change worth a
test: `z.object()` rejects an array, where the hand-rolled check did
not. An array has no own `event` or `agentSessionId` property, so both
guard clauses skipped it, and it passed. `NodeResult` was never meant
to be an array, so this closes a latent gap rather than opening one.

`docs/specs/_built/agent-handoff/spec.md` gets a short note pointing
here, to record that this spec extends its envelope check to the
shared pattern.

This one exception means the code of darkf-core is not fully free of
Zod after all: `isNodeResult` imports it directly, for a fixed check
with no workflow-author configuration. The decoupling claim earlier in
this spec still holds where it matters: no public field type
(`AgentStateDef.outputType`, `BaseLeafDef.validate`) ever references a
Zod type, so the Zod version a consumer uses on its own never conflicts
with the types of darkf-core.

## Compatibility

The inline nudge check changes behavior for every workflow that already
uses `validate`, not only new `outputType` adopters. It ships with no
opt-in and no opt-out.

- **Before:** a `validate` failure spends one `def.retries` attempt. The
  next attempt starts a fresh session and replays the full prompt.
- **After:** a `validate` failure sends up to three same-session nudges
  first. Each nudge is a short message, not a replayed prompt. Only
  after all three fail does the loop fall back to a fresh attempt, as
  before.

This change is usually an improvement, not always one:

- **More dispatches per failure.** `def.retries` only counts fresh
  attempts. Nudges do not count against it, the same as the other three
  nudgeable kinds. A leaf with `retries: 1` could now cost up to eight
  dispatch calls per visit, instead of two. Each nudge costs less than
  a fresh retry, but three failed nudges still add that time on top of
  the eventual retry.
- **No per-leaf opt-out.** `retries`, `timeoutMs`, and
  `usageLimitRetryMs` all have leaf-level settings. Nudging does not. A
  leaf cannot turn it off, even where a `validate` failure signals a
  session gone wrong, better served by a fresh start. The other three
  nudgeable kinds share this limit by design.
- **The effect stays hidden inside this repo.** No shipped workflow
  here uses `validate` today. Only `run.test.ts` does, as a test
  fixture. But `validate` is a public field on `darkf-core`. A consumer
  repo already using it gets this new behavior on its next `darkf`
  upgrade, with no warning.

Confirmed in review (2026-11-17): ship with no opt-out, matching the
other three nudgeable kinds. The worst case, three failed nudges before
a retry, is never worse than today. It only takes longer.

## Non-goals

- The public type of `AgentStateDef` never references the type of Zod,
  even though Zod is now a dependency. `OutputSchema` stays the field
  type. No *configurable* check (`outputType`, `validate`) ever imports
  Zod directly in the code of darkf-core. Only `kit/validation/zod.ts`
  does. The one exception is the fixed, non-configurable envelope check
  in `isNodeResult` (see "Extending `isNodeResult` to the same
  pattern").
- darkf ships one adapter, for Zod. A Valibot or ArkType adapter
  follows the same pattern. A consumer writes their own.
- Only `validate` carries the one-message limit. Its signature returns
  a single string, unchanged by this spec. `outputType`'s Zod adapter
  joins every `safeParse` issue into that one message instead of
  stopping at the first.
- No behavior change to envelope checks beyond the one named case (an
  array now fails `isNodeResult`, where it passed before).
  `malformed-result` stays non-nudgeable. This spec only runs its new
  content checks after a dispatch already returns a well-formed
  `NodeResult`.
- No check on `event` or `agentSessionId`. Only the payload of `output`
  gets checked.
- No cap on nudge-message length. A long error message, now possibly
  several joined issues, rides into the corrective prompt as written.

## Testing

- `zodOutputType()`: a passing schema returns `{ success: true }`, with
  no `message` field. A failing schema with one bad field returns one
  issue, its path joined by dots, for example `tasks[2].title: ...`. A
  root-level failure, with no path, falls back to the word `output`. A
  schema with two or more failing fields returns every issue, joined
  together, not just the first.
- Engine: dispatch a leaf with a stub `OutputSchema` that returns
  `{ success: false, message }`, with a session ID attached. Check that
  a nudge fires, that it quotes the message, and that the nudge count
  stops at three before a real retry. Repeat for a `validate` failure,
  and check the nudge quotes the message from the script instead.
- Regression: a workflow that sets `validate` and no `outputType` still
  rejects the same inputs as before. Its rejection now nudges before it
  retries. Write a test that checks this directly, so it never slips in
  as an untested side effect.
- `isNodeResult`: the same accept and reject cases as today, an object
  with typed `event` and `agentSessionId`, extra fields allowed, `null`
  rejected, plus the one new case: an array now returns `false`, where
  it returned `true` before.

## Skill and doc updates

- `darkf/skills/darkf-writing-workflows/SKILL.md`: add a short section
  on `outputType`. Cover the `OutputSchema` interface, the shipped Zod
  adapter, and the schema-first pattern, a schema in its own file, the
  workflow definition importing only the built `OutputSchema` value,
  never Zod directly.
- `darkf/docs/concepts/node-types.md`: add `outputType` to
  `AgentStateDef`'s TypeScript block and its fields table, next to
  `validate`.
- `darkf/docs/reference/core-types.md`: same two additions, to its own
  copy of the `AgentStateDef` block. This page already carries drift
  unrelated to this spec, `sessionId` instead of `agentSessionId`,
  `EXIT` instead of `DONE`. Add `outputType` without fixing that drift.
  It belongs to a separate pass.
- `darkf/docs/concepts/failure-modes.md`: update the `validation-failed`
  row to name `outputType` as a second source, alongside `validate`.
  Add a line stating this kind now nudges, up to three times in the
  same session, before it falls back to a fresh attempt.
