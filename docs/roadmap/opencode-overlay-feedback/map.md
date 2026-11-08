# opencode-overlay-feedback

## Destination

`darkf-opencode-plugin`'s overlay (currently a full-screen `route`, see
`docs/specs/_built/opencode-visualizer/spec.md`) reworked so that opening it never
disturbs the underlying opencode session — plus the two smaller defects and
one feature request raised in the same user feedback pass: a search picker
that's dead in practice, and a compact/expanded + tabbed overlay layout for
narrow terminals.

## Notes

- Origin spec: `docs/specs/_built/opencode-visualizer/spec.md` — the original v1
  design, which *deliberately* chose a full-screen `api.route.register`/
  `navigate` route ("zoomed, exclusive... replacing the chat view entirely")
  and a cheap, known-racy session-binding heuristic ("v1 uses the cheap
  heuristic, by deliberate choice... Precise supervisor-session binding" was
  an explicit non-goal). This effort revisits both of those choices because
  user feedback found the cost higher than the original spec assumed: the
  full-screen route doesn't just replace the display, it breaks the binding
  heuristic itself (see **session-binding-loss** below) every time the
  overlay is open, not just in the narrow race window the original spec
  accepted.
- Grounded in the current code: `darkf-opencode-plugin/src/{tui,route,toggle,store,locate,supervisor,sidebar,band,digest}.{ts,tsx}`.
- `@opencode-ai/plugin` (installed: `1.18.35`) ships only ambient type
  declarations for the TUI host (`dist/tui.d.ts`) — no runtime source, no
  bundled examples, no local docs. The upstream spec this plugin's own
  `opencode-visualizer/spec.md` cites (`packages/opencode/specs/tui-plugins.md`
  in opencode's own repo) could not be located at the expected GitHub path
  during this session (repo renamed `sst/opencode` → `anomalyco/opencode`,
  default branch `dev`; `packages/opencode/specs/` 404s there now — the file
  likely moved or was renamed upstream). Treat as unverified from primary
  source; **session-binding-loss**'s ticket below resolves what it can from
  the type contract plus one piece of in-repo evidence instead.

## Decisions so far

- **session-binding-loss** — built and typechecked/tested/arch-checked
  clean. Redesigned from a registered `route` to a declarative
  `api.ui.Dialog`, rendered conditionally (via a module-level solid-js
  signal, `overlay()`) from the `app` slot — the same always-mounted tier
  `band.tsx` already uses for `app_bottom`, so it's composed alongside
  whatever route is current rather than switching to a route of its own.
  `openOverlay`/`closeOverlay` (new, `overlay.tsx`) replace every call site
  that used to be `api.route.navigate(ROUTE_NAME, ...)`
  (`tui.tsx`'s `onNewRun` and `darkf.open` command, `toggle.tsx`'s two
  slot handlers) — none of them touch `api.route.current` anymore. One
  consequence found while implementing, not predicted by the ticket:
  `backTarget`/`navigateBack`'s whole job (compute which route to return
  to) became unnecessary and was deleted — since the overlay never leaves
  the current route, "back" is just closing the dialog; there is no longer
  a route to navigate back *to*. Also fixed in passing: the pre-existing
  `route.tsx` ↔ `toggle.tsx` circular import (present on `master` before
  this ticket, confirmed via `git stash` + `depcruise` before/after) was
  real — carrying it forward under the new `overlay.tsx`/`toggle.tsx` names
  would have reproduced it, so `ToggleTab` moved to its own module
  (`toggle-tab.tsx`), which both now depend on one-directionally.
  `bun x depcruise` on the four workspace `src` dirs went from 1 violation
  (pre-existing, confirmed on pristine `master`) to 0.
  **Not yet done**: the ticket's one named empirical check — confirming
  `api.route.current` is actually unchanged while the dialog is open,
  observed live rather than inferred from the type contract — still
  needs a real opencode session to run it in; not performed this session
  (no interactive TUI harness available). Tracked as an open decision on
  the spec, not silently dropped.
  (↪ docs/specs/_built/opencode-overlay-dialog/spec.md)
- **durable-run-session-schema** — built, typechecked/tested clean
  (`darkf-core` + `darkf-cli` only, as scoped: no plugin code touched).
  `AgentRunner.kind`, `RegistryEntry`'s `agentRunnerKind`/
  `supervisorSessionID`/`supervisorHarness` fields plus the
  `SUPERVISOR_ENV_SIGNALS` table (Claude Code row only) and
  `detectSupervisorSignal()` helper, and `foldJournal`'s `sessionId`
  passthrough — all additive, no existing test needed updating. One
  sequencing detail found while implementing, not predicted by the
  ticket: `agentRunnerKind` can't be known at `startCmd`'s own
  `writeEntry` (it never loads the workflow module — only the detached
  worker it spawns does), so the worker merges that one field in right
  after it loads the workflow, same best-effort pattern already used for
  the final status update; the supervisor-env fields don't have this
  problem (env-detected, no workflow load needed) and are written at
  `startCmd` time as designed. Full writeup on the ticket file itself.
  Opencode's env-var row deliberately not added yet — waits on
  **verify-opencode-session-env**, unblocking **run-session-panels**
  below for the Claude Code harness now, opencode once that lands.
  (↪ ticket: tickets/durable-run-session-schema.md)
- **compact-expanded-sizing** — built and typechecked clean
  (plugin-only: `overlay.tsx`, no other module touched). Auto-detect, no
  user control: `renderer.width` read once per `openOverlay`,
  `width < 100` → `"medium"` (compact), `width >= 100` → `"xlarge"`
  (expanded, the previous always-on value), `"large"` unused, unknown/0
  width compacts (fluid content never breaks at medium; xlarge can
  overflow). Freeze at open — no `RESIZE` reflow. Size prop only, no
  second layout; tabs are the control mode in both sizes (supersedes the
  earlier lean that expanded mode might drop tabs). The spec's one open
  question (does `CliRenderer` expose a queryable terminal width) was
  resolved from the installed type surface before implementation: yes —
  public `width`/`height` plus a `RESIZE` event, exposed as
  `TuiPluginApi.renderer`; the knob is `TuiDialogProps.size`, not
  imperative `setSize`.
  (↪ docs/specs/_built/opencode-overlay-sizing/spec.md)
- **picker-all-runs** — built, typechecked, and tested clean (7 new
  unit tests in `locate.test.ts`; plugin-only, per scope). The picker's
  data source switched from `unboundOf(liveRunEntries(...))` — a chain
  that excluded history by construction (live-only filter, then
  never-bound filter) — to one full-registry pass (`runEntryStates`):
  every entry ever recorded, classified, sorted active-first then
  most-recent, `●`/`○` markers, 50/page paging with a `__next_page__`
  sentinel. `liveRunEntries`/`unboundOf` deleted (picker was their only
  consumer). Found while implementing, not predicted: `store.views` had
  the same live-only root filter, so a picked past run resolved to no
  view and the picker re-rendered — views now cover every entry, with an
  mtime-keyed memo keeping past runs at one `stat` per tick instead of a
  re-parse. This also fixes the adjacent defect where a run's graph
  vanished from the overlay the moment the run finished. One more
  consumer of the same changed semantics found after ship (user report):
  the band's `summaryLine` counted `views()` as "runs active" — now
  derives active runs from `pickerCandidates`' classification and shows
  the single live run's real status again (unit-tested in
  `band.test.ts` via the extracted `summary.ts`).
  The by-hand
  live-TUI check (real history on disk, picker opened from an unbound
  session) still pends a session, same as the overlay-dialog spec's
  live checks.
  (↪ ticket: tickets/picker-all-runs.md)

## Open tickets

- **run-session-panels** — blocked by: none (picker-all-runs and
  durable-run-session-schema both shipped, see Decisions above).
- **tiled-run-grid** — blocked by: none. New feature request (2026-11-08):
  watch multiple runs at once in a tiled grid inside the overlay. First
  grill pass locked the shape (grid in the dialog — the host contract has
  no split primitive, only `app`/`app_bottom` slots plus dialogs); the
  spec's open questions (placement vs tabs/picker, 2-up vs N-up, focus
  model, compact behavior, which runs tile) remain. Draft spec:
  `docs/specs/opencode-overlay-tiles/spec.md`.
- *(`search-picker-empty` retired — split into the three above; see that
  ticket file for the pointer. Shared draft spec for all three:
  `docs/specs/opencode-search-candidates/spec.md`, organized by package.)*
- **verify-opencode-session-env** — blocked by: none, but **deliberately
  not run yet** — this host has a live darkf run and a live opencode
  session right now; `opencode upgrade` changes the installed binary
  machine-wide. Run once the host is idle. See ticket for the exact
  version-boundary question (opencode issue #15739 / PR #51975 merged
  2026-09-29, but the installed `1.18.35` build from 2026-10-06 — a week
  later — still shows no trace of `OPENCODE_SESSION_ID` in its binary;
  unresolved by static analysis, needs a live upgrade-and-check).
  **darkf will only claim opencode-session correlation support from
  whichever version this check confirms upward — not from "the PR
  merged" alone.**
- **tabbed-overlay-views** — blocked by: none (session-binding-loss and
  compact-expanded-sizing both shipped, see Decisions above). Draft spec:
  `docs/specs/opencode-overlay-tabs/spec.md` — its sizing reference needs
  updating there: expanded mode is the same tabbed UI in a bigger dialog,
  not "everything at once without tabs".

## Not yet specified (fog)

- Whether `TuiDialogStack.replace` truly stacks (pushing a second dialog,
  e.g. a search picker, on top of the plan dialog, `depth` incrementing) or
  always replaces the single top layer (a second `replace` call clobbering
  the first). The type contract's `depth`/`open` fields are consistent with
  either reading. Matters for **tabbed-overlay-views** (does the "search
  other sessions" tab need its own nested dialog, or does it render inline
  inside the one already-open plan dialog); doesn't block
  **session-binding-loss**, which only ever opens one dialog at a time.
- ~~Whether `TuiPluginApi.renderer`/`CliRenderer` exposes a terminal width
  queryable at render time~~ — resolved 2026-11-08 from the installed
  type surface: yes (`CliRenderer.width`/`height` public, plus a `RESIZE`
  event; `TuiPluginApi.renderer` is typed `CliRenderer`). This is what
  let **compact-expanded-sizing** ship auto-detect.

## Out of scope

- The original spec's own deferred non-goals, unchanged by this effort:
  sub-node visibility (streaming tool-call detail inside a dispatch),
  publishing as an installable npm package, remote/cross-machine runs, and a
  precise server-hook-based supervisor-binding mechanism (this effort fixes
  the *overlay* stepping on the binding heuristic, not the heuristic's own
  known race window on who gets bound in the first place — still accepted,
  per the origin spec, as a cheap/wrong-sometimes v1 trade-off).
