# Live runtime for `status` / `monitor`

A spec for making a running run's runtime display truthful while a node is
executing. A `darkf-cli` concern; `darkf-core` types are touched only if the
heartbeat option is chosen.

## Problem

The engine journals *transitions only* — `running` at dispatch, then
`succeeded`/`crashed` at completion. During a long agent node nothing is
written, so `status` computes runtime from the last journal event and
displays it frozen. Observed in the series-ordering dogfood run: the display
read `runtime: 17m56s` for 10+ minutes while the Implement agent was working
normally. The operator could not distinguish a healthy long node from a hung
one without leaving the tool (`pgrep`). A monitor that trains its user to
double-check with `ps` is a monitor that gets ignored.

Secondary effect: `runtimeMs` (span) is `last.timestamp − first.timestamp`,
so it is also frozen mid-run — and the visit-count fold plus any future
"stall" heuristic are starved of fresh data by the same root cause.

## Goals

- While a node runs, `status`/`monitor` show an elapsed time that advances
  between refreshes, without any operator action.
- A run that is genuinely alive is distinguishable from a stuck one from the
  tool's own output.

## Non-goals

- Changing crash/timeout semantics: nothing in this spec kills or retries a
  node (stall *detection* is in scope; stall *action* is a separate decision).
- Changing the journal's transition-event shape retroactively (old journals
  must keep folding correctly).

## Mechanics (options)

**(a) Display-side elapsed only.** `foldJournal` already surfaces
`current`; extend it with the open node's `startedAt` (present on running
events). `status`/`monitor` print `elapsed: now − startedAt`, computed at
print time. No engine change, no new journal lines. Limit: elapsed advances,
but nothing distinguishes "agent alive" from "worker silently dead" — the
exact ambiguity the problem section is about — and `runtimeMs` stays frozen.

**(b) Engine heartbeats.** While a leaf dispatch is open, the engine appends
a `running` event with an updated `lastHeartbeat` every ~30s (same event
shape, same attempt). Consequences:
- `runtimeMs` unfreezes naturally (last timestamp advances) — no display
  change needed for span.
- Liveness becomes journal-proven: `lastHeartbeat` older than ~3× cadence
  while `status.phase === "running"` is a stall the tool can *warn* about.
- Cost: ~2 lines/min per open node in the journal (a 24-minute node adds
  ~48 lines — negligible).
- **Fold hazard (known, must be handled):** `foldJournal`/`foldReport` count
  a visit on every `running` event with `attempt === 1` — heartbeats would
  inflate visit counts. The fold must count a visit only when the
  `(state, attempt, scopePath)` key is not already open (both folds already
  track open keys for durations; the visit counter moves onto that same
  guard).

**(c) Registry touch.** The worker rewrites its registry entry's timestamp
periodically. Rejected: the registry is documented as a best-effort cache
that is never the authority; making it load-bearing for liveness contradicts
`classifyTerminal`'s stated design.

## Recommendation

**(b)**, with the fold-visit guard, plus (a)'s print-time elapsed as the
display for the current node. Heartbeats are the only option that delivers
the second goal (alive vs stuck) and they fix `runtimeMs` as a side effect;
(a) alone ships a number that still cannot answer the question the operator
is actually asking.

## Success criteria

- During a node that runs ≥ 2× heartbeat cadence, consecutive `status`
  invocations show advancing runtime, and `runtimeMs` in the digest advances.
- A visit count taken mid-run equals the count taken after the run completes
  (heartbeats never inflate visits).
- A journal written before this change folds to identical `visits` and
  dispatches as it does today (old-journal tolerance).
- A node whose heartbeats stop while `phase === "running"` yields a stall
  warning from `status` after ~3× cadence; no automatic crash is introduced.

## Decisions (2026-10-08)

- **D1:** both — engine heartbeats + print-time elapsed. Implemented.
- **D2:** 30s cadence (`RunOptions.heartbeatMs`, default 30_000, 0 disables);
  revisit if journals feel noisy in practice.
- **D3:** warn only — `status` prints a stall warning; the supervisor (human
  or supervising agent) is informed and holds the responsibility to react.
  No automatic kill.

## Open decisions

- **D1 — option:** (a), (b), or both. Recommendation: (b) + (a)'s elapsed
  display.
- **D2 — cadence:** 30s proposed; journal growth is the only cost.
- **D3 — stall response:** warn only (proposed), or act (kill/crash) — acting
  is explicitly out of scope here.
