# Tiled run grid

## Question

The overlay should show multiple runs at once — a tiled grid of run views
inside the dialog — instead of one run per open with a modal picker
between them. First grill pass (2026-11-08) locked the shape: a grid
inside the overlay dialog, not a host-level split (the TUI contract has
only `app`/`app_bottom` slots plus dialogs; no split primitive exists) —
see `docs/specs/opencode-overlay-tiles/spec.md`.

## Type

task

## Blocked by

none — builds entirely on shipped work (dialog overlay, width-based
sizing, full-history store views). Design in progress: the spec's open
questions (grid placement vs tabs/picker, 2-up vs N-up, focus model,
compact behavior, which runs tile) need resolving before build.

## Status

(unclaimed)
