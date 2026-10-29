# darkf-opencode-plugin: run history, search & session navigation (DRAFT — scope grown past the original ticket name, split pending)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/search-picker-empty.md` (grilled well past its original
scope — see note at the end of this spec on splitting, deliberately
deferred until this draft is complete).

## Problem

Started as: the overlay's picker only ever lists `store.unboundCandidates()`
(`locate.ts:70-72`'s `unboundOf` — runs with **no** binding at all), which
is nearly always `[]` by the time a human opens it, since every live run
gets *some* binding (even an empty one) within one ~1s poll tick of being
detected (`store.ts:109-113`). Reported as "search always displays empty."

Grilling this surfaced a materially bigger want: the picker should be a
real way to **navigate and resume darkf work from inside opencode** — see
every run (not just currently-live ones), find your place by recency and
active/inactive status, and from a selected run, reach both (a) the
session the workflow's own agent dispatch used to do the work, and (b) the
session that was supervising/watching the run — regardless of which
coding-agent harness either one was.

## Goals

- The picker lists **every run this project's registry has ever recorded**
  (`listEntries(root)` — confirmed unfiltered, no live/past distinction,
  no cap, in `darkf-cli/src/registry.ts:99`), not just live-and-unbound
  ones.
- Sorted **active status first, then most-recent-first** within each group
  (`(isActive, startedAt) desc` — not recency alone; an active run must
  never rank below a just-finished one just because its last event is
  older. `RegistryEntry.startedAt` already exists — no journal parsing
  needed for the sort key itself).
- Each row shows an active/inactive differentiator — reusing the existing
  `●`/`○` dot convention `overlay.tsx`'s `renderNode` already uses for the
  same active/not distinction, rather than inventing a second icon
  language.
- Selecting a run surfaces **two distinct sessions**, each independently
  degrading to "nothing shown" if its data isn't available (no durable
  record yet, harness not opencode, session no longer resolves) — same
  philosophy `supervisor.ts`'s existing `supervisorViewFor` already uses:
  1. **The agent-dispatch session** — whichever session the workflow's own
     `AgentRunner` used to execute its most recent (or last, if finished)
     leaf dispatch. Already durable today (`journal.jsonl`'s per-dispatch
     `sessionId`, `darkf-engine/src/run.ts:177-223`) — just not surfaced
     by `foldJournal` yet.
  2. **The supervisor session** — whichever external session invoked
     `darkf start`/`run` in the first place, and which harness it was.
     Needs new, durable detection (below) — today's `RunBinding` heuristic
     only ever covers opencode, only while live, and gets forgotten the
     moment a run finishes (`locate.ts:64-68`'s `forgetUnless`).
- For either session, if its harness is `"opencode"`, offer to reopen it
  (`api.route.navigate("session", { sessionID })`); for any other harness
  (or unknown), show identifying info only — no reopen action, since the
  plugin has no way to navigate into a non-opencode session.

## Non-goals

- Building a Claude Code (or any other harness's) equivalent mod/plugin to
  *observe* its own supervisor sessions — unchanged from the origin spec's
  non-goals. This spec only teaches `darkf-cli` to *read* a signal a
  harness already exposes (an env var); it doesn't build new harness-side
  infrastructure.
- Resolving `verify-opencode-session-env` (tracked separately,
  deliberately deferred — see that ticket) — this spec's opencode harness
  support activates once that ticket confirms a version floor, not before.
- Copilot (or any harness beyond Claude Code/opencode) — explicitly
  deferred per the user's own call ("later analysis for other harnesses").
  The `harness` field's shape should not need to change to add one later,
  but no detection logic for one is built now.
- The tab-container UI this picker eventually moves into
  (`docs/specs/opencode-overlay-tabs/spec.md`) — this spec's picker works
  standalone in the current single-view overlay.
- Pruning/retention of old registry entries — flagged as an open question
  below, not solved here.

## Design, sorted by package (for the split decision at the end)

### `darkf-core`

- `AgentRunner` (`src/types.ts`) gains an optional `kind?: string` —
  self-identification (e.g. `"opencode"`, `"claude-code"`), set once per
  runner implementation, read by `darkf-cli` at run-start time. Purely
  additive; `isNodeResult`-style shape checks elsewhere are unaffected
  since nothing currently reads or validates this field.

### `darkf-cli`

- `src/agents/opencode.ts`'s `opencodeRunner` and `src/agents/claude-code.ts`'s
  `claudeCodeRunner` each set `kind: "opencode"` / `kind: "claude-code"`
  respectively.
- `RegistryEntry` (`src/registry.ts`) gains new optional fields, same
  additive precedent as `workflowDir`:
  - `agentRunnerKind?: string` — copied from `opts.agentRunner.kind` at
    `startCmd`/`runCmd` time.
  - `supervisorSessionID?: string`, `supervisorHarness?: string` — written
    by a new, small, extensible env-var table checked at the same point:
    ```ts
    const SUPERVISOR_ENV_SIGNALS: Array<{ env: string; harness: string }> = [
      { env: "CLAUDE_CODE_SESSION_ID", harness: "claude-code" },
      // { env: "OPENCODE_SESSION_ID", harness: "opencode" } — added once
      // verify-opencode-session-env confirms a version floor; see that
      // ticket. Not added speculatively.
    ];
    ```
    First matching env var found in `process.env` wins; none found leaves
    both fields unset (same "degrade to nothing shown" philosophy as
    everywhere else in this plugin).
- `src/status.ts`'s `foldJournal`: `JournalDigest.current` gains
  `sessionId?: string`, copied from `lastStatus.sessionId` when
  `phase === "running"` — the data's already on `NodeStatus`
  (`darkf-core/src/types.ts:151`), just silently dropped today
  (`status.ts:48-53`).

### `darkf-opencode-plugin`

- `locate.ts`: a new, unfiltered read — `listEntries(projectRoot(directory))`
  directly, not `liveRunEntries`'s filtered subset — for the picker's data
  source. Each entry's active/inactive status for the sort/icon still goes
  through the same defensive `classifyTerminal(journalText, isPidAlive(pid))`
  check `liveRunEntries` already uses (never trusting the registry's own
  cached `status` field alone) — **open question below on whether doing
  this for every historical entry, every picker-open, is cheap enough.**
- `overlay.tsx`'s `Picker`: data source switches to the new unfiltered
  read; sort key `(isActive, startedAt) desc`; row label gains the
  `●`/`○` differentiator.
- **Paging, decided**: capped at `PICKER_PAGE_SIZE = 50` per page, sorted
  before slicing (so page 1 is always the 50 most-recent-by-the-
  `(isActive, startedAt)` sort, not 50 arbitrary entries). `DialogSelect`
  (`tui.d.ts`'s `TuiDialogSelectProps`) has no built-in paging — implement
  with a `page`/`offset` signal on `Picker` and a synthetic trailing row
  (`{ title: "→ more…", value: "__next_page__" }`) appended only when more
  entries exist beyond the current slice; `onSelect` checks for that
  sentinel and advances the offset instead of opening a run. Only the
  *displayed* list is capped — `listEntries` itself is untouched, so no
  historical data is ever lost, just how far back one page shows by
  default.
- New small component (name TBD, lives wherever the per-run detail ends up
  — today's single-view overlay, or a future tab) rendering the two
  session panels:
  - **Agent-dispatch session**: reads `PlanView`/`JournalDigest`'s new
    `current.sessionId` (live run) or the last journal event's `sessionId`
    (finished run — same field, just read from the last line instead of
    tracked live) plus the registry entry's `agentRunnerKind`. If
    `agentRunnerKind === "opencode"`, resolve via
    `api.state.session.status(sessionId)`/`.get(sessionId)` (degrading to
    nothing on a throw or `undefined`, exactly like `supervisorViewFor`
    today) and offer reopen; otherwise show `agentRunnerKind` as a plain
    label, no live status, no reopen.
  - **Supervisor session**: same shape, sourced from the registry entry's
    new `supervisorSessionID`/`supervisorHarness` fields instead of the
    in-memory `RunBinding`. **Fallback priority**: durable registry fields
    first (work for any run, live or past, once darkf-cli writes them);
    `RunBinding.supervisorSessionID` (today's live-only, opencode-only
    heuristic) only as a fallback for runs whose registry entry predates
    this change or whose supervisor harness has no env-var signal yet
    (opencode, until `verify-opencode-session-env` lands) — so nothing
    regresses for runs already in flight when this ships.

## Resolved along the way (carried forward, not re-opened)

- **Unbounded history cost** → capped + paged, 50/page (see Paging above).
  Only bounds *display*; `listEntries` itself still returns everything.
- **Label text for "bound to session X"** → subsumed by the supervisor-
  session design above; no separate label concept needed once each row's
  supervisor info is just "the supervisor session panel's data, shown
  compactly." Exact formatting (e.g. whether `api.state.session.get(id)?.title`
  is reliably populated) is an implementation detail to confirm while
  building, not a design fork.
- **Warn before opening an already-bound-to-another-session run?** Stays
  silent — current behavior for an already-resolved `runId` already opens
  without confirmation (`overlay.tsx`'s `view()`); nothing in this spec
  gives a reason to diverge from that precedent.

No open questions remain. Ready for the split below.

## Split proposal

All open questions resolved — proposing the concrete split rather than
leaving it as a vague "at least three tickets" note:

1. **durable-run-session-schema** (`darkf-core` + `darkf-cli` only, no
   plugin change). `AgentRunner.kind`, the two new `RegistryEntry` fields,
   the env-var table (Claude Code row only — the opencode row is added
   only once `verify-opencode-session-env` confirms a floor, as its own
   small follow-up, not blocking this ticket), and the `foldJournal`
   `sessionId` fix. Independently buildable and unit-testable with no
   opencode TUI involved at all.
2. **picker-all-runs** (`darkf-opencode-plugin` only). The actual reported
   bug: switch the picker's data source to unfiltered `listEntries`, sort
   `(isActive, startedAt) desc`, the `●`/`○` icon, the 50/page cap. Needs
   **none** of ticket 1's new fields — `startedAt` and `classifyTerminal`
   already exist today. Ships the original "search always empty" fix
   fastest, independent of everything else here.
3. **run-session-panels** (`darkf-opencode-plugin`, depends on **both**
   1 and 2 — needs 1's durable fields to read, needs 2's picker to pick a
   run from). The two session panels, reopen gating, and the
   `RunBinding`-as-fallback priority logic.

Dependency order: **2 can ship first and alone** (fixes the reported bug
today); **1 can ship in parallel**, independent of 2; **3 waits on both**.

Want me to create these three tickets on the roadmap now (replacing
`search-picker-empty`, whose scope this supersedes), or keep iterating on
this spec further first?
