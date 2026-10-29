# Failure metadata: structured crash detail on `CrashReason`

A spec for `darkf-core`'s `CrashReason` type and both agent runners. Crash
journal entries carry structured, named forensic fields instead of a bare
string, so `darkf report` and RCA read one record instead of reconstructing
events from the opencode server log. Informs the supervisor only — no
effect on retry, nudge, or any other engine behavior.

## Problem

A crash reason today is a string (`opencode exited 1: `, `handoff not
written`). Facts the runner had in hand at the moment of failure — stderr,
which tool call was rejected, how many steps ran — are discarded. The
engine-side `no-transition` crash already carries everything relevant
(`event` + the state's valid edges); every other crash kind loses
information a human or an agent reading the journal would need.

## Design

### Which kinds gain fields

Only kinds where an agent harness actually ran gain forensic fields.
Pure workflow-definition errors (`unresolved-target`, `duplicate-id`,
`max-steps`, `cycle-limit`, `malformed-result`, `validation-failed`) and
the already-complete `no-transition` are unchanged.

| Kind | New field | Source |
|---|---|---|
| `runner-error` | `stderrTail?: string` | last ~400 bytes of stderr, already captured |
| `runner-error` | `lastEventType?: string` | last NDJSON event type seen before exit |
| `timeout` | `finishReason?: string` | last `step-finish` reason in stdout buffered before the kill |
| `timeout` | `lastEventType?: string` | last NDJSON event type seen before the kill |
| `handoff-missing` | `finishReason?: string` | last `step-finish` event's `part.reason` |
| `handoff-missing` | `lastToolError?: string` | last tool-part error (permission rejections surface here) |
| `handoff-missing` | `stepCount?: number` | count of `step-finish` events observed |
| `handoff-unparseable` | `handoffExcerpt?: string` | offending file's first 200 bytes |

Each of the four kinds above also gains `extra?: Record<string,
unknown>` — an open bag for whatever a specific runner can report beyond
the named fields (e.g. opencode's tool-part shape has no claude-code
equivalent). Journal/report consumers treat `extra` as opaque JSON.

### Journal shape

Fields live inline on the terminal journal entry's `reason` object — no
sidecar file.

### Visibility

`status`/`monitor` print `lastEventType`, `lastToolError`, and
`finishReason` inline, in the same one-line style as `stallWarning`'s
existing warning (e.g. `warn: handoff missing (finish=tool-calls, last
tool: bash rejected)`). `stderrTail`, `handoffExcerpt`, and `extra` are
`darkf report`-only — too large for a glanceable terminal view.

## Dependency

`handoff-missing` and `handoff-unparseable` must already exist as
dedicated `CrashReason` kinds (see `docs/specs/session-nudge/spec.md`) —
this spec only adds fields to them. Ships after session-nudge, as a pure
additive extension: it changes no runner behavior, no retry/nudge logic,
and nothing here affects whether or how a dispatch is repaired.

## Non-goals

- No change to retry, nudge, or any control-flow decision — this spec is
  observability only.
- No shared cross-runner schema beyond the named fields above — anything
  not listed goes in `extra`, unstructured.
