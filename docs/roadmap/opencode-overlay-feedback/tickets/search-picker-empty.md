# Search picker empty

## Question

`route.tsx:201-204`'s `candidates()` — the data source for the overlay's
`Picker`/`DialogSelect` — is `store.unboundCandidates()`
(`locate.ts:70-72`'s `unboundOf`: live runs with **no** binding at all).
But `store.ts:109-113` binds every newly-seen run to a session (or to
nothing) on the very next 1s poll tick after it's first detected
(`locate.ts:47-60`). So by the time a user opens the picker, almost every
live run already has *some* binding, making `unboundCandidates()` nearly
always `[]` — which is what "search always displays empty" actually is:
not a broken filter box, a near-always-empty list underneath it.

Should the picker instead list every live run regardless of binding state
(labeling each one's binding, e.g. "bound to this session" / "bound to
session X" / "unbound"), so searching for "another session's run" (the
user's own framing) actually has something to find?

## Type

task

## Blocked by

none

## Status

Superseded. Grilled well past this ticket's original question — the
draft spec (`docs/specs/opencode-search-candidates/spec.md`) grew to cover
a durable run/session schema, two session-detail panels, and reopen
gating, none of which fit "fix the picker's data source" cleanly anymore.
Split into three tickets instead of resolved as one:

- `durable-run-session-schema`
- `picker-all-runs` (this ticket's own original question, resolved there)
- `run-session-panels`

This file is kept for the record, not deleted — the Question above is
still exactly what was originally reported; its answer now lives across
the three tickets above instead of here.
