# darkf-opencode-plugin: dialog overlay, not a route (IMPLEMENTED — pending live verification)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/session-binding-loss.md` (Decided). Supersedes part of
`docs/specs/opencode-visualizer/spec.md`'s **Design overview** — "The
full-screen route — zoomed, exclusive, auto-opened" — with a non-route
overlay. Nothing else in the origin spec changes.

## Problem

`docs/specs/opencode-visualizer/spec.md` chose, deliberately, a registered
`route` (`api.route.register`/`navigate`) for the darkf plan view, auto-
opened the instant a run starts and replacing the chat view entirely. User
feedback on the shipped plugin: pressing the darkf toggle (or a new run
auto-opening) should never disturb the opencode session underneath it.

Reading the code confirms this is a real defect, not just a UX
preference. `darkf-opencode-plugin/src/store.ts:45-57`'s
`currentSessionID(api)` — which gates whether `locate.ts`'s `ensureBinding`
can bind a newly-detected run to a session at all — only resolves a
session id when `api.route.current.name === "session"`. The instant the
darkf route is open, `api.route.current.name === "darkf-plan"`, so
`currentSessionID` returns `undefined`. `locate.ts:47-60` binds a run once,
at first detection, and never rebinds. So: any run first observed while the
overlay is open binds permanently with no session, and `route.tsx:21-27`'s
`backTarget` then sends "back" to `home` instead of to the real chat,
because there's no session on the binding to return to.

## Goals

- Opening/closing the darkf overlay never changes `api.route.current` —
  the underlying session route (if any) stays current the entire time the
  overlay is open, so a run detected mid-overlay binds correctly.
- No visible regression to what the overlay already shows (`PlanGraph`,
  `SupervisorPanel`, the unbound-candidate picker) or how it's reached
  (auto-open on new run, the toggle button, `/darkf` command, keybind).
- Foundation for `docs/specs/opencode-overlay-sizing/spec.md` (compact vs.
  expanded) and `docs/specs/opencode-overlay-tabs/spec.md` (tabs) — both
  depend on the overlay being a dialog, not a route.

## Non-goals

- Fixing the binding heuristic's own known race window (who gets bound,
  not whether the overlay breaks binding) — unchanged from the origin
  spec's accepted v1 trade-off ("Precise supervisor-session binding").
- Auto-detected compact/expanded sizing — a separate ticket/spec.
- Tabs, search-picker data-source fix — separate tickets/specs; this spec
  only changes the render host (route → dialog), not the content.

## Design overview

### Why a declarative `<api.ui.Dialog>` from the `app` slot, not a route

Resolved in `tickets/session-binding-loss.md`'s Answer (full reasoning
there); summary: `TuiPluginApi.route` and `TuiPluginApi.ui` are independent
properties in the type contract (`@opencode-ai/plugin`'s `dist/tui.d.ts`)
— nothing under `api.ui` references route state, and `route.navigate`/
`route.current` never reference dialogs. Corroborated in-repo: the old
`route.tsx`'s `Picker` already rendered `api.ui.DialogSelect` from inside
the full-screen route's own tree without tearing that route down — live
proof a dialog composes over currently-displayed content rather than
requiring a route of its own.

**As built**, that precedent is followed directly rather than going
through the imperative `TuiDialogStack` (`api.ui.dialog.replace`/`clear`)
this draft originally sketched: `overlay.tsx` keeps a module-level
solid-js signal (`overlay(): { runId?: string } | null`) and registers a
component at the `app` slot (the same always-mounted tier `band.tsx`
already uses for `app_bottom`) that renders `<Show when={overlay()}>` →
`<api.ui.Dialog size="xlarge" onClose={closeOverlay}>` wrapping the plan
view. `openOverlay(runId?)`/`closeOverlay()` just write the signal — no
call ever touches `api.route`, and no call ever registers or navigates a
route. This is simpler than threading everything through the imperative
stack handle and mirrors the one piece of working precedent in this
codebase exactly (a `Dialog`-family component rendered as plain JSX,
mounted/unmounted by a `<Show>`), rather than introducing a second,
unverified mechanism alongside it.

**One empirical check before calling this fully verified** (not blocking
the design — the design rests on the type contract plus the in-repo
`DialogSelect` precedent, both already consistent with each other):
from a live session, open the overlay and confirm `api.route.current`
still reports `{ name: "session", params: { sessionID } }` — e.g.
temporarily `api.ui.toast({ message: JSON.stringify(api.route.current) })`
from inside `OverlayContent`. Not performed this session (no interactive
opencode TUI harness available in this environment); typecheck, unit
tests, lint, and the dependency-cruiser arch-check all pass (see
Verification strategy), but none of those can observe `route.current` at
runtime the way this one check does.

### What changed, file by file (as built)

- **`route.tsx` → deleted**, replaced by **`overlay.tsx`** (new). Drops
  `api.route.register([{ name: ROUTE_NAME, ... }])` entirely. The render
  body (the `<box>` of `scrollbox`es + `PlanGraph`/`SupervisorPanel`/
  `Picker`) is unchanged, now called from inside the `<api.ui.Dialog>`
  wrapper described above. `api.mode.push(MODE)` and its `onCleanup`
  pop, plus the explicit `keymap.registerLayer` escape binding, both
  ported unchanged into `OverlayContent` — kept rather than relying on an
  unverified assumption that `TuiDialogProps.onClose` already wires Escape
  on its own (see ticket Answer: "costs nothing to keep, risky to drop on
  a guess"; revisit once observed live).
  **One simplification found during implementation, not predicted by the
  ticket**: the old `backTarget`/`navigateBack` (`route.tsx:21-33`) existed
  to compute which route to return to on close. Since the overlay never
  leaves the current route in the first place, there is no route to
  return to — closing is just `closeOverlay()` (clearing the signal).
  Both functions were deleted rather than ported.
- **`toggle.tsx`**: both `onPress` handlers now call `openOverlay()`/
  `openOverlay(runId)` instead of `api.route.navigate(ROUTE_NAME, ...)`.
- **`tui.tsx`**: `onNewRun` and the `darkf.open` command both call
  `openOverlay(...)` in place of the old `route.navigate` calls.
- **`openPlanRoute`** (old `route.tsx:266-268`) — confirmed unused outside
  that file (grepped before removing); deleted, no replacement needed.
- **New, not anticipated by the draft**: `toggle-tab.tsx`. The old
  `route.tsx` ↔ `toggle.tsx` had a circular import (`route.tsx` imported
  `ToggleTab` from `toggle.tsx`; `toggle.tsx` imported `ROUTE_NAME` from
  `route.tsx`) — confirmed pre-existing on `master` via `git stash` +
  `depcruise` before touching anything, not introduced by this work.
  Renaming `route.tsx` to `overlay.tsx` while keeping the same shape would
  have reproduced the identical cycle under new names. Fixed instead:
  `ToggleTab` (the presentational badge component) moved to its own
  `toggle-tab.tsx`, imported one-directionally by both `toggle.tsx` and
  `overlay.tsx`. `bun x depcruise` across the four workspace `src` dirs
  went from 1 violation (confirmed pre-existing) to 0.

### What's explicitly not re-verified by this spec

The plan-view render logic itself (tree rendering, composite expand/
collapse state via `manualOpen`/`toggleOpen`, the unbound-candidate
`Picker`'s own near-always-empty data source) is moved, not rewritten —
this spec does not re-derive or re-justify any of that; see
`opencode-visualizer/spec.md`'s own Design overview for the original
reasoning, and `docs/specs/opencode-search-candidates/spec.md` for the
picker's separate, not-yet-built data-source fix.

## Cross-component contracts

`darkf-opencode-plugin/src/route.tsx` deleted; `overlay.tsx` and
`toggle-tab.tsx` added; `toggle.tsx`/`tui.tsx` updated to call
`openOverlay`/`closeOverlay` instead of `api.route.navigate`. No
`darkf-core`/`darkf-cli`/`darkf-engine` change. No change to the journal,
registry, or binding (`locate.ts`) logic — this spec only changes *how*
the plugin displays what `store.ts`/`locate.ts` already compute.

## Error handling

Unchanged from the origin spec — `buildRegistry` throw and a stale
`supervisorSessionID` both already degrade the display rather than
throwing (`opencode-visualizer/spec.md`'s **Error handling**); nothing in
this change touches either path.

## Verification strategy

Done this session (static/automated — no interactive opencode TUI harness
was available to drive the live checks below):

- `bun x tsc --noEmit` in `darkf-opencode-plugin` — clean.
- `bun test` in `darkf-opencode-plugin` — 7 pass, 0 fail (pre-existing
  `digest.test.ts`; nothing in this change touches `digest.ts`, so this is
  a no-regression check, not new coverage for the overlay itself — the
  overlay has no unit-testable logic of its own beyond what's already
  exercised by hand below).
- `bun x biome check` — no new findings; the two `noStaticElementInteractions`
  a11y findings and the `organizeImports` finding present in the new/moved
  files were all confirmed pre-existing on `master` (checked via
  `git stash` + re-running biome against the restored old files) except
  `organizeImports`, which was fixed with biome's safe autofix on the two
  touched files.
- `bun x depcruise` across the four workspace `src` dirs — 0 violations
  (was 1, pre-existing, confirmed via `git stash`; fixed as a side effect
  of the `toggle-tab.tsx` split, see Design overview).

**Still needed, not done this session** (all require a live opencode TUI
session, which this environment doesn't have a harness for):

- **The empirical `route.current` check** (Design overview) — the one
  fact the whole fix rests on; expected to confirm, not change, the
  design, but genuinely unobserved so far.
- **Binding regression test, by hand**: open the overlay from a live
  session (toggle or auto-open), then — while it's still open — start a
  second darkf run in the same project root; confirm the second run's
  `RunBinding.supervisorSessionID` is the real session id, not `undefined`.
- **No-regression pass on existing behavior**: auto-open on new run, the
  toggle button from both `home_prompt_right` and `session_prompt_right`,
  the `/darkf` command/keybind, the unbound-candidate picker when more than
  one candidate exists, composite expand/collapse, the supervisor panel —
  all re-exercised against the dialog-hosted version, same as the origin
  spec's own **Verification strategy** already prescribed for the route
  version.

## Success criteria

- A run detected while the overlay is open binds to the correct session,
  not `undefined` — **pending** the live binding regression test above.
- `api.route.current` is provably unchanged across opening and closing the
  overlay — **pending** the live check above.
- Every existing overlay behavior (auto-open, toggle, picker, composite
  expand/collapse, supervisor panel) works identically to before, just
  hosted in a dialog instead of a route — **pending** the live
  no-regression pass above; not contradicted by anything found so far
  (typecheck/tests/lint/arch-check all clean), but none of those actually
  render the TUI.

This spec stays in `docs/specs/` rather than moving to `docs/specs/_built/`
(per this repo's spec-directory convention) until the three pending live
checks above are run — code-complete is not the same as verified here.

## Open decisions

- The empirical `route.current`-preservation check above — not yet
  observed live; the single highest-value next step on this spec.
- Whether `TuiDialogProps.onClose`/the host's default Escape handling makes
  the explicit `keymap.registerLayer` escape binding redundant — kept
  either way for now (see Design overview); revisit once observed.
- Dialog nesting/stacking semantics (does a second dialog opened while one
  is already showing stack or replace) — out of scope here (this overlay
  only ever shows one dialog at a time); tracked in the roadmap map's fog
  for `docs/specs/opencode-overlay-tabs/spec.md`.
