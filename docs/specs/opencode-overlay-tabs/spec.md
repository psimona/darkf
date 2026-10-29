# darkf-opencode-plugin: tabbed compact overlay (DRAFT)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/tabbed-overlay-views.md` (open, blocked by
`session-binding-loss` and `compact-expanded-sizing`).

## Problem

User feedback, verbatim framing: "the compact view has tab navigation of
the current run, the search mask to look for other sessions, and a full
journal visualization." Today the overlay shows exactly one thing at a
time, chosen by whether `params.runId` resolves (`route.tsx:200-204`): the
plan graph, or the picker. There's no tab concept, and no journal view at
all.

## Goals

- Three tabs inside the compact dialog (per
  `docs/specs/opencode-overlay-sizing/spec.md`): **current run** (existing
  `PlanGraph`/`SupervisorPanel`), **search** (the picker, fixed per
  `docs/specs/opencode-search-candidates/spec.md`), **journal** (new — see
  below).
- Switching tabs doesn't lose place in the others (e.g. switching away
  from "current run" and back doesn't reset `manualOpen`'s composite
  expand/collapse state, `route.tsx:210-219`).

## Non-goals

- Expanded-mode layout — per `opencode-overlay-sizing/spec.md`'s open
  question, expanded mode may not use tabs at all; this spec is
  compact-mode only.
- The search picker's own data-source fix — that's
  `opencode-search-candidates/spec.md`; this spec just hosts it as a tab.

## Design sketch (unrefined — needs a session to resolve open questions below)

- New component, e.g. `TabBar` + a `createSignal<"run"|"search"|"journal">`
  selecting which of the three existing/new view components renders.
- **Journal view — genuinely new, nothing to port.** `digest.ts`'s
  `buildPlanView` only ever derives `root`/`current`/`crash`/`stall` from
  `foldJournal` (`darkf-cli/src/status.ts`) — the raw event stream itself
  is read (`readJournalText`, already available via `store.ts`/`locate.ts`)
  but never rendered. A journal tab needs its own small renderer: parse
  `journal.jsonl`'s lines (format: whatever `darkf-engine/src/run.ts`'s
  emit calls write — not re-derived here, read directly from source before
  implementing) into a scrollable, newest-or-oldest-first event list.

## Open questions (not yet resolved)

- Dialog nesting: does the search tab, when it wants its own
  `api.ui.DialogSelect` (the picker's current implementation), stack as a
  second dialog over the tab-container dialog, or does it need to become
  inline content (a list `<box>` with its own filter input, not the host's
  `DialogSelect` component) to live inside one tab of one dialog? Depends
  on the `TuiDialogStack.depth`/stacking fog item flagged in the roadmap
  map — not resolved by `opencode-overlay-dialog/spec.md`, which only ever
  opens one dialog at a time.
- Journal event line format and volume — a long-running workflow's journal
  could be large; whether the journal tab needs its own pagination/
  windowing or can rely on `opentui`'s `scrollbox` (already used elsewhere
  in `route.tsx`) to handle arbitrary length is unverified.
- Whether tab state (which tab was last open) should persist across
  dialog close/reopen via `api.kv`, or always reset to "current run" —
  no signal yet from the user's feedback either way.
