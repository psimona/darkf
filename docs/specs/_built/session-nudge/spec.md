# Same-session nudge: bounded in-session repair of dispatch output failures

A spec for `darkf-engine`'s dispatch loop and both agent runners
(`darkf-cli/src/agents/{opencode,claude-code}.ts`). Covers one mechanism:
repairing a dispatch that fails the output contract by continuing its
agent-harness session with a short corrective message, instead of
discarding it for a full fresh-session retry.

## Problem

A dispatch can do all the engineering work and still fail the node by not
writing the handoff file, writing unparseable JSON, or choosing an event
the state has no edge for. These are repairable in-session — the agent is
one short message away from fixing its own output — but today's only
repair path is a full retry: a fresh session, the identical prompt, and a
one-line failure hint. That discards everything the failed attempt
learned and burns a full re-dispatch on an error the agent could fix in
one turn.

## Design

### Repair scope

Three failure kinds are nudgeable, all variants of "the dispatch satisfied
some part of the contract but produced output the engine can't route":

- `handoff-missing` — no result file was written.
- `handoff-unparseable` — the result file isn't valid JSON.
- `no-transition` — the result's `event` has no edge in `on`.

All other `CrashReason` kinds are not nudgeable: they represent either a
genuine runner failure (`runner-error`, `timeout` — nothing an in-session
message repairs) or a pure workflow-definition error with no agent attempt
to continue (`unresolved-target`, `duplicate-id`, `max-steps`,
`cycle-limit`, `malformed-result`, `validation-failed`).

### Resume signal

`DispatchInfo.agentSessionId` and `DispatchInfo.previousFailure` already
carry forward across the engine's attempt loop; this spec reuses both
as-is. No new engine↔runner channel, no new `AgentRunner.run()` parameter.

A runner reports `agentSessionId` on a `NodeResult` only when it has
positive evidence the harness session persisted something — for opencode,
at least one `step-finish` NDJSON event observed on that attempt's stdout.
Absent that evidence, the runner reports no session id, and the engine
treats the next attempt as a fresh session exactly as it does today. There
is no separate runner-capability flag: every targeted runner (opencode,
claude-code) supports resuming a session natively.

### Reporting a session id on failure

A runner that fails may still have a usable session id (the harness
accepted work before the output contract broke). To carry that id across
a thrown failure, `darkf-core` defines:

```ts
class AgentFailure extends Error {
  agentSessionId?: string;
  crashReason?: CrashReason;
}
```

Any `AgentRunner` may throw `AgentFailure` in place of a plain `Error`.
The engine's dispatch loop reads `agentSessionId`/`crashReason` off it when
present, instead of building a generic `runner-error` from the message
string. A runner that throws a plain `Error` is handled exactly as today.

### Adapter changes

**opencode (`opencode.ts`)**: one pass over the NDJSON stdout extracts
three things together (extending the existing `lastFinishReason` scan,
not a second pass): the last `step-finish` event's `part.reason`, its
`part.sessionID`, and a count of `step-finish` events seen (`stepCount`).
`agentSessionId` is only ever attached — on a returned `NodeResult` or on
a thrown `AgentFailure` — when `stepCount > 0`; at `stepCount === 0` the
runner reports no session id at all, and the engine runs the next attempt
fresh, exactly as it does for a runner that never resumes. This guard is
the resumability fix for the session that hung 15 minutes on zero
persisted messages — the hang's root cause was resuming a session with no
evidence it had done anything, not resuming as such.

`opencode.ts`'s existing per-dispatch-key `lastFailures` string cache (a
one-line failure hint injected into a brand-new prompt on the next fresh
session) is unrelated and unaffected: it covers the fresh-session case,
nudging covers the same-session case, and the two never fire on the same
attempt.

**claude-code (`claude-code.ts`)**: `parseAgentSessionId(stdout)` already
runs on the success path. It also runs on the failure path (exit code
≠ 0) — `stdout` is already read into memory before the exit-code check, so
this is a second call against data already in hand, not new capture
plumbing. When it yields a value, the runner throws `AgentFailure` with
that `agentSessionId`; when `stdout` has no parseable JSON yet (the
process crashed before printing its terminal result object), the runner
throws a plain `Error`, identical to today — there is no partial-progress
signal available on this path, unlike opencode's incremental NDJSON.
Switching to `--output-format stream-json` would close that gap (an early
per-event session id, same shape as opencode's) but changes the handoff-
extraction code path too — out of scope here, left as a future
improvement.

The success path (`exitCode === 0`) also changes: today `readHandoff(path)`
runs unguarded and any read failure propagates as a plain, undifferentiated
`Error`. It must instead distinguish the two read failures the same way
`opencode.ts` already does for its own handoff read — a missing file
(`ENOENT`) throws `AgentFailure` with `crashReason: { kind:
"handoff-missing" }`; a file that exists but fails `JSON.parse` throws
`AgentFailure` with `crashReason: { kind: "handoff-unparseable",
parseError }`. Both attach `agentSessionId` from the `parseAgentSessionId(stdout)`
call already made on this path, since the harness session ran to
completion either way.

### `CrashReason` additions

```ts
export type CrashReason =
  | { kind: "runner-error"; error: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "handoff-missing" }
  | { kind: "handoff-unparseable"; parseError: string }
  | { kind: "malformed-result" }
  | { kind: "validation-failed"; message: string }
  | { kind: "no-transition"; state: string; event?: string }
  | { kind: "unresolved-target"; from: string; target: string }
  | { kind: "duplicate-id"; id: string }
  | { kind: "max-steps"; steps: number; state: string }
  | { kind: "cycle-limit"; composite: string; cycles: number };
```

`handoff-missing` and `handoff-unparseable` are dedicated kinds, split out
of the generic `runner-error` bucket (which remains, scoped to genuine
exit/provider failures) — this is what lets the engine pick the correct
nudge template without inspecting error strings. `handoff-unparseable`
carries `parseError` because the nudge message quotes it directly.
`no-transition` needs no new field: the nudge message's list of valid
events comes from `DispatchInfo.validEvents`, already present on every
attempt.

### Dispatch loop change

Nudging is a loop nested inside each outer `attempt` iteration, not a new
value of `attempt` itself — this is what keeps it uncounted against
`def.retries` (see Bounds). One outer attempt's body becomes:

1. Compute a per-attempt deadline once, before the first dispatch:
   `const deadline = Date.now() + timeoutMs`. Every dispatch this outer
   attempt makes — the first call and every nudge after it — wraps its own
   `withTimeout` call with `deadline - Date.now()`, not a fresh `timeoutMs`.
   This is the literal mechanism behind "nudge turns share the dispatch's
   remaining `timeoutMs`" (Bounds): the deadline is fixed once per outer
   attempt, the remaining budget shrinks on every call charged against it,
   and running it out mid-nudge surfaces as `timeout` exactly as it does
   today.
2. `resolveTarget`'s check moves from after the attempt loop to inside
   this inner loop, immediately after `validate()`: an unroutable event
   produces `{ kind: "no-transition", ... }` as a nudgeable failure,
   feeding the same branch below as a thrown `AgentFailure` with a
   nudgeable `crashReason`.
3. On a nudgeable failure (`handoff-missing`, `handoff-unparseable`,
   `no-transition`) with `agentSessionId` set and the inner nudge count
   below 3: increment the nudge count, set `reason` to that failure, emit
   the nudge-start status (see Visibility), and dispatch again — same
   outer `attempt`, `def.retries` untouched.
4. Any other outcome ends the inner loop: a non-nudgeable `CrashReason`, a
   nudgeable one with no `agentSessionId`, a nudgeable one with the inner
   count already at 3, or a nudge that itself fails with `runner-error` or
   `timeout`. `reason` (and `agentSessionId`, if the failure carried one)
   carry forward exactly as a crashed attempt does today, and the outer
   loop's existing `continue`/`attempt++` takes over — this is the only
   point that spends a `def.retries` slot.
5. A success at any point — the first dispatch or any nudge — ends both
   loops exactly as a success ends the outer loop today: `result` is set,
   the outer loop breaks.

"The loop's existing `catch`" (referenced in Bounds) means step 4 only —
the fallthrough to a normal crashed/retry outer attempt — never the nudge
retries in step 3, which are new and scoped entirely inside one outer
attempt.

### Nudge messages

When `previousFailure.kind` is one of the three nudgeable kinds and
`agentSessionId` is set, the runner sends this message into the same
session instead of a fresh prompt:

- `handoff-missing`: "Your previous turn ended without writing the result
  file. Ignore any blocked tool calls and write the JSON handoff to
  `<path>` now. Valid events: `<validEvents>`."
- `handoff-unparseable`: "The JSON at `<path>` failed to parse
  (`<parseError>`). Rewrite it as a single valid JSON object with the
  contract fields."
- `no-transition`: "You reported event `<event>`; this state only routes
  `<validEvents>`. Re-issue the handoff with a routable event."

opencode: `opencode run -s <agentSessionId> --format json <message>`,
inheriting the dispatch's own `-m`/`--auto` flags. claude-code: `claude -p
--resume <agentSessionId> <message>`, in place of the full prompt it
replays on resume today.

`-s` resume is scoped strictly to this nudge invocation: a fresh (non-nudge)
opencode dispatch behaves exactly as today — no `-s`, no `agentSessionId`
relay — even when `DispatchInfo.agentSessionId` happens to be set from an
exhausted or non-nudgeably-failed nudge sequence earlier in the same outer
attempt. This keeps `-s` confined to the one case this spec's `stepCount`
guard was built to make safe, and leaves the plain-retry path exactly as
cautious as it is today. claude-code's existing unconditional `--resume`
on `info.agentSessionId` (every attempt, nudge or not) is unchanged.

### Bounds

- Up to 3 nudges per outer attempt, counted separately from `def.retries`.
  A nudge never consumes a `def.retries` slot; only exhausting all 3 (or a
  nudge itself failing non-nudgeably) does.
- A nudge that fails with `runner-error` or `timeout` ends the nudge loop
  for that outer attempt; the engine falls through to its normal
  crashed/retry handling.
- Nudge turns share the dispatch's remaining `timeoutMs` — the engine's
  existing per-attempt timeout wraps the whole sequence of nudges, no
  separate budget. See Dispatch loop change for the deadline mechanism
  that enforces this.

### Visibility

- `NodeStatus`'s `running` phase gains `nudgeAttempt?: number` (1..3) and
  `nudgeReason?: CrashReason["kind"]` (the nudgeable kind that triggered
  this nudge) — both set when the engine issues a nudge, emitted
  immediately at nudge-start (not gated behind the regular heartbeat tick).
- `status.ts` gains `nudgeWarning(digest)`, same contract as the existing
  `stallWarning`: reads `nudgeAttempt`/`nudgeReason` off `digest.current`
  (mirroring how `agentSessionId` already flows into `JournalDigest`) and
  returns `"nudging attempt 2/3 (handoff-missing) — supervisor decides"` or
  `null`. `status`/`monitor` print it the same way `stallWarning` is
  printed today.

## Non-goals

- No nudging for `runner-error`, `timeout`, or any pure workflow-definition
  crash — nothing an in-session message repairs.
- No interactive supervision channel — that is steer/monitor territory.
- No static per-runner resume-capability flag — every targeted runner
  supports resume unconditionally.
