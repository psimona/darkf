# Tabbed overlay views

## Question

The compact dialog (see **compact-expanded-sizing**) should hold three
views reachable by tab: current-run (already exists — `PlanGraph`/
`SupervisorPanel` in `route.tsx`), search-other-sessions (the picker fixed
by **search-picker-empty**), and a new full-journal visualization that
doesn't exist yet anywhere in this plugin (`digest.ts`'s `buildPlanView`
only derives a tree + current/crash/stall from `foldJournal`
(`darkf-cli/src/status.ts`) — it never renders the raw event stream). Needs:
a tab-container component, and a new journal-log renderer reading
`readJournalText` directly. Also needs the dialog-stacking fog item from
**session-binding-loss** resolved first if tabs are meant to layer a second
dialog rather than switch content inline within one.

## Type

task

## Blocked by

session-binding-loss, compact-expanded-sizing

## Status

(unclaimed)
