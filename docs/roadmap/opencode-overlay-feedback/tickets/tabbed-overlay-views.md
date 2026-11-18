# Tabbed overlay views

## Question

The compact dialog (see **compact-expanded-sizing**) should hold three
views reachable by tab: current-run (already exists — `PlanGraph`/
`SupervisorPanel` in `overlay.tsx`; the tab strip itself shipped via the
`task-list-json` slice, see `TabBar`), search-other-sessions (the picker
fixed by **search-picker-empty**), and a new full-journal visualization
that doesn't exist yet anywhere in this plugin (`digest.ts`'s
`buildPlanView` only derives a tree + current/crash/stall from
`foldJournal` (`darkf/src/kit/status.ts`) — it never renders the raw
event stream). Needs:
a new journal-log renderer reading
`readJournalText` directly, wired in as a third tab. The dialog-stacking
fog item from **session-binding-loss** still applies if tabs are meant to
layer a second dialog rather than switch content inline within one.

## Type

task

## Blocked by

session-binding-loss, compact-expanded-sizing

## Status

done — shipped 2026-11-18 as `fbd5981`, "feat: opencode-overlay-tabs
(opencode-overlay-tabs)". Reframed first (see
`docs/specs/_built/opencode-overlay-tabs/spec.md`): not the
current-run/search/journal shape this ticket originally described —
superseded by a user-directed `workflows`/`runs` two-tab design (no
journal tab; the search-other-sessions ask is folded into the `runs`
tab's inline, searchable all-runs list). Dispatched via the `dev-loop`
darkf workflow (run `d94b3041-616d-4379-8927-99ec6f37a3a8`); feedback at
`darkf/feedback/2026-11-18-opencode-overlay-tabs.md`.
