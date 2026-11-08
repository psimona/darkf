# darkf-opencode-plugin: compact vs. expanded overlay (IMPLEMENTED)

Roadmap: `docs/roadmap/opencode-overlay-feedback/map.md`,
ticket `tickets/compact-expanded-sizing.md` (done). Prerequisite
`docs/specs/_built/opencode-overlay-dialog/spec.md` (the sizing knob only
exists on the dialog stack, not on a route) is shipped.

## Decisions

Locked 2026-11-08 by grill walkthrough; implementation shipped in the same
session. One former fog item was resolved from the installed type surface,
not assumed:

- **Approach B: auto-detect, no user control.** The overlay's size is
  computed from terminal width at dialog-open time. No keybind, no
  `api.kv` persistence, no setting. Matches `PHILOSOPHY.md`'s few-knobs
  stance; the original feedback framed compact as size-adaptive ("compact
  for narrow terminals / mobile"), not as a preference.
- **Threshold: `width < 100` → `"medium"` (compact), `width >= 100` →
  `"xlarge"` (expanded, the previous always-on value).** `"large"` stays
  unused — three tiers for a two-mode design is a knob we don't need. The
  exact line is a guess until seen live; tune it once observed in a real
  TUI.
- **Freeze at open.** `renderer.width` is read once per `openOverlay` call
  and carried on the overlay state; a mid-session `RESIZE` does not reflow
  an open overlay. Overlay sessions are short glances, and live reflow
  drags in pane-snap and tab-rerender edge cases for no observed need.
- **Size prop only — no second layout.** The dialog's content is identical
  in both sizes; flow is dictated by available space. The layout was
  already fluid (flex/percentage, one 6-col glyph column), so a
  `compact?: boolean` flag threaded through `PlanGraph`/`SupervisorPanel`
  would be speculative work. Content-level compactness is a follow-up
  ticket only if medium visibly truncates in practice.
- **Tabs in both sizes.** Supersedes this spec's earlier lean (and
  `opencode-overlay-tabs/spec.md`'s) that expanded mode might drop tabs
  and show everything at once. One code path, one control scheme; expanded
  is the same tabbed UI in a bigger dialog.
- **Unknown/0 width compacts.** `(renderer.width ?? 0) >= 100` fails
  toward `"medium"`. The content is fluid, so medium never breaks, while
  xlarge can overflow a host that never reported a width. Worst case for a
  wide user is one cramped open — same as a narrow user gets today at
  worst, and strictly better than an overflow.

Fog item resolved by exploration (2026-11-08): `CliRenderer` exposes
public `width`/`height` and a `RESIZE` event
(`@opentui/core` `renderer.d.ts`), and `TuiPluginApi.renderer` is typed
`CliRenderer` (`@opencode-ai/plugin` `tui.d.ts`) — terminal width is
queryable at any time, which made approach B viable and retired the
"if no, fall back to approach A" branch. The knob itself is
`TuiDialogProps.size` (`tui.d.ts`), passed as a prop where the dialog
renders (`overlay.tsx`) — no imperative `TuiDialogStack.setSize` needed.

## Problem

User feedback: the overlay should have two layouts — a compact one for
mobile or narrower terminals, and an expanded one otherwise. The shipped
plugin rendered one layout at one fixed size (`size="xlarge"`).

## Implementation

- `overlay.tsx`: module-level `registeredApi`, set by `registerOverlay`;
  `overlaySize()` maps `renderer.width` to `"medium" | "xlarge"` per the
  decisions above; `OverlayState` carries `size`; `openOverlay` re-reads
  width on every call (replacing the shown run is a new open);
  `<api.ui.Dialog size={state().size}>`.
- No other module changed.

## Open decisions

None — all resolved, see Decisions above. Remaining follow-ups, tracked as
tickets rather than open questions here: live reflow on `RESIZE`
(unrequested), content-level compactness (only if medium truncates badly).
