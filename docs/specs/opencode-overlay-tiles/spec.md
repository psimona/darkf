# darkf-opencode-plugin: tiled run grid — panel migration (RESOLVED, not yet built)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/tiled-run-grid.md`.

## Problem

The overlay shows one run at a time. With several concurrent runs (a
dev-loop retrying while a feature build runs, parallel feature runs),
watching them means picker → open → close → picker — a modal context
switch per glance. There is no way to see two runs at once.

## Why this spec changed shape (read first)

First grill pass (2026-11-08) locked the grid's home as *inside the
existing overlay dialog*, reasoning that the TUI plugin contract exposed
only `app`/`app_bottom` slots plus dialogs — no split primitive. That
reading came from `@opencode-ai/plugin@1.18.35`'s bare `.d.ts` (no docs
existed for the plugin API at the time; see `map.md`'s Notes).

Re-grilled 2026-11-19, prompted by live user feedback that keyboard focus
is invisible in the shipped tabbed overlay (color-only cursor, no
traversal on the tab strip at all). By then the plugin had migrated to
`@opencode/plugin@2.3.2`, whose docs (`opencode.ai/docs/build/plugins/cli/`)
describe `session.panel`: a non-modal, host-sized panel with a
`toggleFullscreen` escape hatch and reactive `width`/`presentation`
props — a split primitive that didn't exist (or wasn't known) at the
first pass. Re-grilling against it concluded the fix belongs one level
above "where does the grid live": the whole overlay migrates off the
dialog, and tiling becomes the `runs` view's own behavior once more than
one run is active, not a bolted-on third view. This also gave the chance
to fix the focus-visibility complaint once, system-wide, instead of
twice (once for old dialog views, once for a new grid).

## Success Criteria

- Opening the panel never changes `router.current()` — the same guarantee
  the dialog gave, carried forward and re-verified live (decision 1).
- Every keyboard-reachable focus state (row cursor, region, tab label)
  has a visible indicator that does not rely on color alone — checked by
  inspection, since "visible" is partly perceptual and a passing unit
  test alone can't confirm it.
- `Tab` reliably cycles region focus with no observed collision against
  host bindings (session tabs, plan/build mode toggle) — confirmed live.
- N concurrently active runs render as N tiles (up to however many the
  current panel width fits, decision 8), with no pagination step and no
  active run silently hidden.
- A run that stops being active drops out of the tile grid on its next
  poll tick, with no error and no stale reference left in whatever
  currently holds region focus (see Runtime View).
- A narrow terminal always renders the panel full-screen, with the
  presentation-toggle control still rendered and visibly a no-op there.

## Security Considerations

No security-sensitive surface — this is local TUI rendering over data
the plugin already reads (run journals, registry entries, session
messages). No new auth, secrets, or persistence.

## Components and Interfaces

- **Panel registration.** One `session.panel` contribution, registered
  once from `tui.tsx`'s `setup`, under a stable plugin-prefixed name
  (`"darkf.panel"`, mirroring the existing `"darkf.open"` command id) —
  replacing today's `context.ui.dialog.show`/`set`/`clear` call sites in
  `overlay.tsx`.
- **Open/close/focus API.** `openOverlay`/`closeOverlay` (`overlay.tsx`)
  are replaced by equivalent calls against the registered contribution's
  `focus`/`close` actions (and `toggleFullscreen` for presentation,
  decision 3), at the same three call sites as today: `tui.tsx`'s
  `onNewRun`, the `darkf.open` command, and `toggle.tsx`'s two slot
  handlers.
- **Tile membership and tile focus.** Two new reads, beyond what
  `store.ts` exposes today: *which `runId`s are currently rendered as
  tiles in the open panel*, and *which one (if any) currently holds
  region focus*. Both need to be readable from `sidebar.tsx` (decision
  12's suppression) without `sidebar.tsx` depending on the panel's own
  component tree — expose both as part of `LiveStore` (or a small
  sibling module next to it), consistent with `store.ts` already being
  the plugin's one shared source of live state, rather than inventing a
  second ad hoc signal.
- **N-up column function.** Takes the panel's current reactive `width`
  and a minimum tile width constant (`MIN_TILE_WIDTH = 40` columns —
  wide enough for the condensed per-tile summary, `sidebar.tsx`'s own
  view, to stay readable; revisit once built against a real terminal),
  returns a column count ≥ 1.

## Cross-Component Contracts

- `tui.tsx` → host: registers the `session.panel` contribution once at
  `setup`; calls its `focus`/`close`/`toggleFullscreen` actions from the
  existing auto-open/command/toggle call sites.
- `store.ts` → `sidebar.tsx`: new read — the open panel's current tile
  membership and focused tile — consumed by `sidebar.tsx`'s render to
  suppress a duplicate entry (decision 12).
- `store.ts` → the runs view: unchanged contract (`pickerCandidates`,
  `views`, `tick`); the active-run subset the grid tiles is derived from
  `pickerCandidates`' own classification, no new field needed (decision
  9).
- `workflows-tab.tsx`/`runs-tab.tsx`/`run-detail.tsx` → the panel's
  region-cycle layer: each view registers its own `keymap.layer` scoped
  to `mode: "global"` (the existing, empirically-confirmed reason
  dialog/panel-hosted content needs this over a custom mode name) and
  participates in the region-cycle order the panel container defines —
  the container, not each leaf view, owns the `Tab` cycle order and
  which region is current.

## Runtime View

- **Opening.** Auto-open-on-new-run, the `darkf.open` command, and the
  footer toggle all resolve to the same `focus` call against the one
  registered panel contribution — identical to today's three call
  sites, just retargeted from dialog to panel.
- **Auto-open while already open.** A newly observed run is added to the
  active-run set the grid already derives each poll tick; it appears as
  a new tile on the next tick, the same mechanism as any other run
  starting. Auto-open needs no special case here, because grid
  membership is automatic (decision 9), not an explicit "open this one"
  action.
- **Region focus when the focused tile's run disappears.** If the run
  backing the currently region-focused tile stops being active (and so
  drops out of the grid per decision 9) while it holds focus, region
  focus moves to the next remaining tile if one exists, else to the
  content area's own default (the plain runs list, once no tiles
  remain) — never left pointing at a tile that no longer renders.

## Open Questions

None open. The one blocking question this spec carried — focused-tile
layout — was resolved 2026-11-19; see decision 10.

## Decisions (locked 2026-11-19)

1. **Host primitive: `session.panel`, not a dialog.** The original
   dialog choice (`session-binding-loss`, 2026-10-13) solved "opening the
   overlay must not touch `router.current()`." `session.panel` satisfies
   that equally well (it's session-scoped, not route-based) while also
   being non-modal — chat stays visible, which a dialog can never offer.
2. **Scope: full migration, not a second system.** The `workflows`
   catalog, `runs` list, and run-detail view all move onto `session.panel`
   together. Tiling is not a separate feature bolted onto this — it's
   what the `runs` view does when more than one run is active.
3. **Presentation:** side-panel by default whenever there's room; the
   host forces full-screen on narrow terminals regardless. An explicit
   toggle control is **always rendered**, even when the current state
   makes it a no-op (narrow-forced full-screen) — never conditionally
   hidden, so the control is consistently discoverable.
4. **Sizing is reactive**, not frozen at open. Supersedes
   `compact-expanded-sizing`'s freeze-at-open rule (`docs/specs/_built/
   opencode-overlay-sizing/spec.md`) — that rule existed only because the
   dialog gave no live width signal, just an imperative `renderer.width`
   read once at open. The panel slot's `width`/`presentation` props are
   reactive, so layout reflows live as the terminal resizes or
   presentation flips.
5. **Row-level focus:** an inverse-video band across the focused row
   (`createTextAttributes({ inverse: true })`) plus a leading cursor
   glyph (`❯`), replacing the color-only `fg: accent` convention
   currently used for "this is the cursor" in both the workflow tree
   (`workflows-tab.tsx`) and the runs list (`runs-tab.tsx`). Accent color
   keeps its other, non-focus meanings (e.g. the active view label) where
   it isn't competing with a selection highlight.
6. **Region-level focus:** a second focus layer above row-level focus.
   The tab strip, the content area, and — once tiled — each tile are
   each one native `focusable` `Box`, using `focusedBorderColor`
   (`@opentui/core`'s `Box`, unused anywhere in this plugin today) to
   show which region currently owns input. `Tab` cycles regions forward;
   confirmed live (user testing, 2026-11-19) that bare `Tab` is not
   claimed by the host's session-tab cycling, and is distinct from
   `Shift+Tab` (already claimed for the host's plan/build mode toggle).
   No reverse-cycle key — region count is small enough that forward-only
   wraparound is cheap, revisit only if tiling grows past a handful of
   panes.
7. **The tab strip becomes genuinely keyboard-navigable.** Today's direct
   number-key jump (`1`/`2`) stays as a shortcut, but the tab strip is
   now a focusable region: once it holds region-level focus, arrow keys
   move a highlighted cursor across tab labels and `Enter`/`Space`
   activates — matching the host's own "Tab focus then Enter" convention
   from its Select actions docs.
8. **Grid layout: N-up by available width, no hard cap.** N = however
   many minimum-readable-width tiles fit in the panel's current
   (reactive) width — `MIN_TILE_WIDTH = 40` columns (see Components and
   Interfaces). More active runs than fit in one screen become
   additional scrollable rows, not a second pagination mechanism —
   consistent with the shipped `runs` tab's own no-pagination decision
   (r15: "Pagination, windowing, and load-on-scroll are gone by spec
   decision. Do not reintroduce them."). N=1 at narrow widths is just the
   formula's boundary case, not a special-cased "compact mode" branch —
   this also resolves the original spec's separate "compact behavior"
   open question.
9. **Which runs tile: every currently-active run, automatically.**
   Sourced from the same active-classification `pickerCandidates`
   already computes each poll tick. No pinning or manual selection in
   v1; a finished run drops out of the grid the instant it stops being
   active.
10. **Tile content: condensed summary, not full detail — enlarging the
    focused tile in place, not a full takeover.** Non-focused tiles reuse
    `sidebar.tsx`'s existing compact view (active-node highlight,
    crash/stall line) rather than the full graph+task+supervisor
    `run-detail.tsx` view. Region-focusing a tile (via `Tab`) promotes it
    to the full detail view **inside the still-visible grid** — the
    other tiles shrink (or, below some point, scroll out of the
    viewport) rather than being hidden outright, so live side-by-side
    comparison survives focusing one run for a closer look. If the
    expanded tile's full detail view doesn't fit alongside the others at
    the current column count, the grid drops a column (re-running the
    N-up formula with the focused tile counted at its larger minimum
    width) before any tile scrolls out of view — scrolling is the
    last resort, not the first response to a tight fit.
11. **Closing stays explicit.** Don't assume `Escape` closes a
    `session.panel` the way it closed the dialog (undocumented) — keep
    an explicit keymap-bound close action, and verify `Escape`'s actual
    behavior live once built, same discipline `session-binding-loss`
    already applied to its own pending empirical check.
12. **Sidebar/tile duplication is suppressed by the plugin, not assumed
    away.** The docs don't say whether `sidebar.content` and an open
    `session.panel` can coexist showing the same run twice. Rather than
    depend on unspecified host behavior, the plugin itself suppresses a
    `sidebar.content` entry for any run that's also currently shown as a
    tile in the open panel.

## Out of scope / deferred

- Pinning a finished run into the grid for comparison against a live
  one — a real possible future request, not built speculatively now.
- A reverse-cycle key for region focus.

## Supersedes

- `docs/specs/_built/opencode-overlay-dialog/spec.md` — host primitive
  (dialog → `session.panel`). The binding-loss reasoning that drove the
  original route→dialog move is unaffected; only the choice of
  non-route primitive changes.
- `docs/specs/_built/opencode-overlay-sizing/spec.md` — freeze-at-open
  sizing → reactive sizing (decision 4 above).
- `docs/specs/_built/opencode-overlay-tabs/spec.md` — tab strip keyboard
  model (direct-jump-only → traversable with visible region focus) and
  row rendering convention (color-only → inverse + glyph).

## Verification strategy

- Live, by hand: confirm `Escape` behavior on an open `session.panel`;
  confirm reactive `width`/`presentation` props actually reflow a mounted
  tile grid without a remount; two concurrent active runs tile
  side-by-side, focusing one promotes it to full detail while the other
  stays condensed; a finished run drops out of the grid on its next poll
  tick.
- Fixture tests: N-up column math at a few width breakpoints including
  N=1; active-only grid membership as runs start/finish; row inverse+
  glyph rendering; region-focus border switching across tab
  strip/content/tiles; sidebar suppression for a run shown as an open
  tile.
