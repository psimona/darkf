# Run session panels

## Question

From a selected run, surface the two sessions the user actually wants to
navigate to: the agent-dispatch session (whichever session the workflow's
own `AgentRunner` used to do the work) and the supervisor session
(whichever external session invoked `darkf start`/`run`) — each with a
reopen action when its harness is `"opencode"`, info-only otherwise.
Design fully resolved via grilling on `search-picker-empty`'s draft spec;
this ticket is the plugin-side detail-panel half of that spec.

## Type

task

## Blocked by

durable-run-session-schema (needs the new `RegistryEntry` fields and
`JournalDigest.current.sessionId` to read), picker-all-runs (needs a
working picker to select a run from in the first place).

## Status

(unclaimed)

## Design (resolved — see `docs/specs/opencode-search-candidates/spec.md`
## for full detail; summarized here for this ticket's own scope)

- New small component (exact home TBD — today's single-view overlay, or
  a future tab per **tabbed-overlay-views**) rendering two panels:
  - **Agent-dispatch session**: reads `PlanView`/`JournalDigest`'s
    `current.sessionId` (live run) or the last journal event's
    `sessionId` (finished run) plus the registry entry's
    `agentRunnerKind`. If `agentRunnerKind === "opencode"`, resolve via
    `api.state.session.status(sessionId)`/`.get(sessionId)` — degrading
    to nothing on a throw or `undefined`, exactly like
    `supervisorViewFor` today — and offer reopen
    (`api.route.navigate("session", { sessionID })`); otherwise show
    `agentRunnerKind` as a plain label, no live status, no reopen.
  - **Supervisor session**: same shape, sourced from the registry
    entry's `supervisorSessionID`/`supervisorHarness`. **Fallback
    priority**: durable registry fields first (work for any run, live or
    past); `RunBinding.supervisorSessionID` (today's live-only,
    opencode-only heuristic) only as a fallback for runs whose registry
    entry predates this change or whose harness has no env-var signal yet
    — so nothing regresses for runs already in flight when this ships.
- Silent-opens-without-warning stays the default when picking an
  already-bound-to-another-session run (carried forward from the
  original picker behavior — no new confirmation dialog).

## Verification strategy

- Fixture tests covering all four quadrants per panel: durable field
  present + opencode (shows status, offers reopen), durable field present
  + non-opencode (shows label only), durable field absent + live
  `RunBinding` fallback present (degrades to the old heuristic), both
  absent (shows nothing, no crash).
- By hand: pick a live run with a real bound session and confirm both
  panels resolve correctly; pick a finished run from a previous darkf-cli
  version (no new fields on its registry entry) and confirm it degrades
  to the old `RunBinding` fallback (or to nothing, if that's also absent)
  without erroring.
