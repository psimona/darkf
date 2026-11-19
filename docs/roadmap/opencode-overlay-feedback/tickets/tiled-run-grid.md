# Tiled run grid

## Question

The overlay should let a user watch multiple active runs at once — a
tiled grid — instead of one run per open with a modal picker between
them. First grill pass (2026-11-08) locked the shape as a grid *inside*
the existing dialog, reasoning that the TUI contract exposed only
`app`/`app_bottom` slots plus dialogs. Re-grilled 2026-11-19 against the
plugin's current `@opencode/plugin@2.3.2` docs, which describe a
`session.panel` primitive that wasn't on the table at the first pass —
see `docs/specs/opencode-overlay-tiles/spec.md` for the full resolved
design and rationale.

## Type

task

## Blocked by

none. Builds on shipped work (full-history store views, active
classification) plus this ticket's own now-resolved design.

## Status

Decided — ready to build. Not yet implemented.

## Design (resolved 2026-11-19 via re-grill — see
## `docs/specs/opencode-overlay-tiles/spec.md` for full detail and
## rationale; summarized here for this ticket's own scope)

- Scope grew past "where does the grid live": the whole overlay (today's
  modal dialog — `workflows`/`runs` tabs, run-detail) migrates off the
  dialog onto `session.panel`. Tiling is the `runs` view's own behavior
  once more than one run is active, not a third view bolted on.
- Presentation: side panel by default when there's room, full-screen
  when width is reduced (host-forced on narrow terminals regardless); an
  explicit, always-rendered toggle lets the user flip presentation by
  hand at any width. Panel width/presentation are reactive props, so
  sizing reflows live — supersedes `compact-expanded-sizing`'s
  freeze-at-open rule.
- Two-layer focus model, fixing the standing keyboard-visibility
  complaint plugin-wide rather than just in the new grid:
  - Row-level: inverse-video band + leading cursor glyph, replacing the
    color-only `fg: accent` cursor convention in the workflow tree and
    runs list.
  - Region-level: tab strip, content area, and each tile are native
    `focusable` boxes using `focusedBorderColor` (unused until now);
    `Tab` cycles regions forward only, confirmed live free of the host's
    session-tab and plan/build-mode bindings. The tab strip itself
    becomes keyboard-traversable (arrow keys + Enter/Space), not just a
    direct-jump hotkey.
- Grid: N-up by available width (no hard cap), active runs only,
  automatic membership (no pinning in v1). Non-focused tiles show the
  condensed `sidebar.tsx`-style summary; region-focusing a tile promotes
  it to the full graph+supervisor detail view.
- Closing the panel keeps an explicit keymap-bound action rather than
  assuming `Escape` is wired for free; the plugin itself suppresses a
  `sidebar.content` entry for any run already shown as an open tile,
  rather than relying on unspecified host sidebar/panel coexistence.

## Verification strategy

- Live check (same discipline as `session-binding-loss`'s own pending
  check): confirm `Escape` behavior on an open `session.panel`; confirm
  reactive `width`/`presentation` props actually reflow a mounted tile
  grid without a remount.
- Fixture tests: N-up column math at a few width breakpoints including
  N=1 (compact degrades to single-tile, no special-cased "compact mode"
  branch); active-only grid membership as runs start/finish; row
  inverse+glyph rendering; region focus border switching between tab
  strip/content/tiles; sidebar suppression for a run shown as an open
  tile.
- By hand: two concurrent active runs, confirm both tile, confirm
  focusing one promotes it to full detail while the other stays
  condensed, confirm a finished run drops out of the grid.
