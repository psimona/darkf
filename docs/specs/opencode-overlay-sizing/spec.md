# darkf-opencode-plugin: compact vs. expanded overlay (DRAFT)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/compact-expanded-sizing.md` (open, blocked by
`session-binding-loss`).

## Problem

User feedback: the overlay should have two layouts — a compact one for
mobile or narrower terminals, and an expanded one otherwise. Today there's
only one layout (`route.tsx`'s full-screen `<box height="100%">`).

## Goals

- Two overlay layouts, reachable via `TuiDialogStack.setSize("medium"|
  "large"|"xlarge")` (available once
  `docs/specs/_built/opencode-overlay-dialog/spec.md` lands — the sizing knob only
  exists on the dialog stack, not on a route).
- Compact layout is the one that hosts the tabbed navigation from
  `docs/specs/opencode-overlay-tabs/spec.md` (current-run / search /
  journal) — this spec defines the two sizes and how the choice is made;
  tab content itself is the other spec's job.

## Non-goals

- The tab contents themselves (search picker, journal view) — separate
  spec.
- Anything about the dialog-vs-route render host — that's
  `opencode-overlay-dialog/spec.md`, a hard prerequisite, not reproduced
  here.

## Design sketch (unrefined — needs a session to resolve the open question below)

- Candidate approach A (manual toggle): a keybind or in-dialog control
  flips `setSize` between two fixed values, persisted via `api.kv`
  (`tui.d.ts`'s `TuiKV`) so the choice survives across opens.
- Candidate approach B (auto-detect): pick compact vs. expanded from
  terminal width at dialog-open time, no user control needed — blocked on
  the open question below.

## Open questions (not yet resolved)

- Does `TuiPluginApi.renderer` (`CliRenderer` from `@opentui/core`) expose
  a queryable terminal width/column count at the point the dialog opens?
  Not checked this session — `@opentui/core`'s own type surface wasn't
  pulled during the feedback review that produced this draft. If yes,
  approach B is viable and probably preferable (no new keybind/setting
  surface, matches `PHILOSOPHY.md`'s "few configuration knobs" stance
  already cited by `opencode-visualizer/spec.md`); if no, falls back to
  approach A.
- Whether `setSize`'s three named sizes (`medium`/`large`/`xlarge`) map
  cleanly onto "compact" and "expanded," or whether compact needs its own
  layout (fewer visible rows, abbreviated labels) independent of the
  dialog's pixel/cell size — i.e. is this purely a `setSize` call, or does
  the JSX inside also need a `compact?: boolean` prop threaded through
  `PlanGraph`/`SupervisorPanel`. Likely the latter once tabs
  (`opencode-overlay-tabs`) are in the picture, since "tab navigation" only
  makes sense as a compact-mode concept per the original feedback framing
  ("the compact view has tab navigation... the search mask... a full
  journal visualization") — expanded mode may just show everything at once
  without tabs at all. Not decided.
