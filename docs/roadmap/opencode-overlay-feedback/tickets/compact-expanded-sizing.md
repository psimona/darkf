# Compact/expanded sizing

## Question

Once **session-binding-loss** lands (the overlay is a `TuiDialogStack`
dialog instead of a route), `TuiDialogStack.setSize("medium"|"large"|
"xlarge")` gives a built-in two-size knob almost for free. Open question:
should compact-vs-expanded be auto-detected from terminal width, or a
manual toggle the user flips? Auto-detection needs confirming whether
`TuiPluginApi.renderer` (`CliRenderer`, from `@opentui/core`) exposes a
queryable terminal width/column count at render time — not checked yet,
tracked as fog in the map, not resolved here.

## Type

task

## Blocked by

session-binding-loss

## Status

done — built and typechecked clean (plugin-only: `overlay.tsx`). Decisions
locked 2026-11-08 by grill walkthrough: auto-detect (`width < 100` →
`"medium"`, else `"xlarge"`, unknown/0 compacts), freeze at open, size
prop only, tabs in both sizes. The blocking fog item (does `CliRenderer`
expose a queryable width) was resolved from the installed type surface
before implementation: yes. Full writeup:
`docs/specs/_built/opencode-overlay-sizing/spec.md`.
