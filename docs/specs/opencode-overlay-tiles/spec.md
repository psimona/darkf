# darkf-opencode-plugin: tiled run grid (DRAFT)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/tiled-run-grid.md` (open, unclaimed).

## Problem

The overlay shows one run at a time. With several concurrent runs (a
dev-loop retrying while a feature build runs, parallel feature runs),
watching them means picker → open → close → picker — a modal context
switch per glance. There is no way to see two runs at once.

## Decisions

Locked 2026-11-08 by grill walkthrough (first pass):

- **Tiling = a multi-run grid inside the overlay dialog.** Not a
  host-level split of the opencode window: the TUI plugin contract exposes
  exactly two slots (`app`, `app_bottom`, `tui.d.ts:356-357`) plus
  dialogs — there is no split/tile primitive, and `app_bottom` (the band)
  is host-sized and one line tall. Not a tmux/Zellij integration either —
  out of plugin scope. The dialog's opentui boxes are flex-based, so a
  `flexDirection="row"` grid of fixed-width panes inside the dialog is
  buildable with what the host already gives us.

## Open questions (grill in progress — one at a time)

- **Where the grid lives relative to the existing views** — is it (a) the
  overlay's default main view when more than one run is active, (b) a
  third tab next to workflow/tasks, or (c) an evolution of the picker?
  Each collides differently with auto-open (which binds and opens one
  `runId`), the tab bar (tabs are view modes *within* one run), and the
  picker (modal list). Not decided.
- **2-up vs N-up** — v1 asked and unanswered. 2-up covers the common
  pairwise case in an `"xlarge"` dialog with readable panes; N-up needs a
  focus model, pane minimums, and a degradation story as runs exceed
  columns. Not decided.
- **Focus model** — how a pane is selected (keys `h`/`l`? `[`/`]`?
  click?), and whether the supervisor pane and tasks tab follow focus.
- **Compact behavior** — `"medium"` dialogs can't fit two graph panes
  side by side; does compact stack tiles vertically, show one pane, or
  hide the grid entirely?
- **Which runs tile** — active only? active + most-recent-finished? user-
  pinned? The picker's full-history sort is the natural source; the grid
  needs its own subset rule.
