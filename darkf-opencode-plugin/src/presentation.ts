// Presentation-control math (docs/specs/opencode-overlay-tiles/spec.md,
// decision 3): the panel opens as a side panel by default — `openOverlay`
// passes no presentation option, and the host's own open default is
// "panel" — while the host forces full-screen on terminals too narrow to
// split a side panel, where a toggle press is a documented no-op
// ("toggleFullscreen has no effect until there is enough room for a side
// panel", plugin docs). The control decision 3 requires — always rendered,
// visibly a no-op there — needs to recognize that no-op case from the
// documented reactive state alone: the slot input's `width` and
// `presentation`. Pure module next to `tab-strip.ts`: unit-testable
// without the TUI JSX runtime (the same reasoning `tiles.ts` gives),
// leaving `overlay.tsx` with only the rendering.

/** The two presentations the host reports on the panel input's
 *  `presentation` — `PanelPresentation` in `@opencode/plugin/tui/context`,
 *  restated here so this module stays dependency-free like its sibling
 *  pure modules. */
export type Presentation = "panel" | "fullscreen";

/** The narrowest measured width the host splits a side panel at. Measured
 *  against the installed host (v2.3.0): its panel provider computes
 *  `canSplit = width >= 108` over the same measured width the slot input
 *  delivers as `width` (terminal width minus vertical session tabs,
 *  re-measured even while full-screen hides the tabs), reports
 *  `presentation` as a forced "fullscreen" below it, and makes
 *  `toggleFullscreen` return early below it — the narrow-forced no-op the
 *  docs describe. A starting constant like `MIN_TILE_WIDTH`: the host owns
 *  the real rule, so this drifts only if the host's threshold moves, and
 *  the failure mode is cosmetic, not behavioral — the control might claim
 *  no-op on a press that would now work, while the press itself still
 *  routes through the host and stays correct. */
export const MIN_SPLIT_WIDTH = 108;

/** Whether pressing the presentation control can change anything right now
 *  (decision 3's no-op case): a side panel is showing, or the measured
 *  width leaves room for one. The `presentation` clause is defensive —
 *  the host never delivers "panel" below `MIN_SPLIT_WIDTH` (its
 *  `presentation` is forced "fullscreen" there) — but if a host change
 *  ever broke that invariant, a side panel on screen must not read as
 *  inert: that is the visible lie the control must never tell. Pure
 *  function, same contract as the row math: reactivity lives at the call
 *  site — read both arguments from the panel input inside the render
 *  scope and the verdict tracks resizes and presentation flips live
 *  (decision 4 — sizing is reactive, not frozen at open). */
export function canTogglePresentation(width: number, presentation: Presentation): boolean {
  return presentation === "panel" || width >= MIN_SPLIT_WIDTH;
}
