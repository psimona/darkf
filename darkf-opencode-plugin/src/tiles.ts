import { createSignal } from "solid-js";
import { pickerOrder } from "./locate.ts";
import type { LiveStore } from "./store.ts";

// The open panel's two tile facts (spec:
// docs/specs/opencode-overlay-tiles/spec.md — Tile membership and tile
// focus): which runs the open panel renders as tiles, and which of them (if
// any) holds region focus. A small sibling module next to `store.ts`, not a
// second store: membership derives from `LiveStore`'s own `pickerCandidates`
// classification, and the two panel-owned facts below are the same
// plugin-owned, in-memory, not-persisted shape `locate.ts`'s `bindings` map
// already uses. Plain module, not `overlay.tsx`: readable from
// `sidebar.tsx` without importing anything from the panel's component tree
// (decision 12), and unit-testable without loading the TUI JSX runtime
// (same reasoning `summary.ts` gives).

// --- the two panel-owned facts -------------------------------------------

// Module-level, not component-local — the writers (`overlay.tsx`'s claim
// render, and the panel container's region cycle) sit outside each other's
// render trees. Plain signals, no store: the derived read below composes
// them with the store's own signals instead of duplicating them.
const [open, setOpen] = createSignal(false);
const [focused, setFocused] = createSignal<string | undefined>(undefined);

/** Marks the overlay panel open or closed. Called from
 *  `overlay.tsx`'s `session.panel` claim render — the host re-renders that
 *  claim whenever the open name flips (that same flip is what mounts and
 *  unmounts the content), so it is the one authoritative place the plugin
 *  learns open state; nothing else writes this. Closing also clears region
 *  focus: no open panel means no tiles, so no tile holds focus — a stale
 *  focused id must not survive into the next open (spec: Runtime View —
 *  region focus never points at a tile that no longer renders). */
export function setPanelOpen(panelOpen: boolean): void {
  setOpen(panelOpen);
  if (!panelOpen) setFocused(undefined);
}

// --- the two reads -------------------------------------------------------

/** The open panel's tile membership (decision 9): every currently-active
 *  run, active-first then most-recent-first (`pickerOrder` — the runs
 *  list's own ranking, so the grid, the region cycle's "next remaining
 *  tile", and the list agree on one order). Empty when the panel is closed
 *  — nothing is rendered as a tile then, and there is nothing for
 *  `sidebar.tsx` to suppress against. Reactively tracked: reads the
 *  panel-open signal and the store's `pickerCandidates` signal, so callers
 *  inside a reactive scope (the sidebar's render, the grid's memos)
 *  re-run per poll tick, which is exactly the dropout rhythm the spec
 *  requires ("drops out of the grid on its next poll tick"). Returns a new
 *  array; the store's signal value is untouched. */
export function tileRunIds(store: LiveStore): string[] {
  if (!open()) return [];
  const active = store.pickerCandidates().filter((candidate) => candidate.active);
  return pickerOrder(active).map((candidate) => candidate.entry.runId);
}

/** The region-focused tile's run, or `undefined` when no tile holds region
 *  focus — including before the region-cycle layer exists to drive it, and
 *  after the panel closes (see `setPanelOpen`). Raw read, not auto-healed:
 *  if the focused run stops being active, this keeps returning it until
 *  the focused-tile vanish handoff moves focus itself (spec: Runtime View —
 *  that handoff needs the raw value to detect the vanish). */
export function focusedTileRunId(): string | undefined {
  return focused();
}

/** Moves region focus to a tile, or clears it (`undefined`). Written by the
 *  panel container's region cycle (decision 6) and its vanish handoff —
 *  not by consumers of the reads above. */
export function setFocusedTileRunId(runId: string | undefined): void {
  setFocused(runId);
}

// --- N-up column math -----------------------------------------------------

/** The narrowest a tile stays readable (spec: docs/specs/
 *  opencode-overlay-tiles/spec.md — Components and Interfaces, N-up column
 *  function): wide enough for the condensed per-tile summary — `sidebar.tsx`'s
 *  own view — to stay readable. */
export const MIN_TILE_WIDTH = 40;

/** The grid's column count (decision 8): however many `minTileWidth`-wide
 *  tiles fit in `width`, floored — never below 1, so N=1 at narrow widths is
 *  this formula's boundary case, not a special-cased compact-mode branch. No
 *  cap: wider panels fit proportionally more columns (grid-nup-no-cap). The
 *  `minTileWidth` parameter keeps the pure formula reusable at any minimum;
 *  decision 10's focused-mode drop is built on it in `gridColumnCount`.
 *  Pure number in, number out — reactivity lives at the call site: pass the
 *  panel input's live `width` from inside a reactive scope (a memo, the grid's
 *  render) and the count recomputes on every reflow (decision 4 — sizing is
 *  reactive, not frozen at open). */
export function columnCount(width: number, minTileWidth: number = MIN_TILE_WIDTH): number {
  return Math.max(1, Math.floor(width / minTileWidth));
}

/** The narrowest the region-focused tile's full detail view stays readable
 *  (decision 10's "larger minimum width"): the detail view's side-by-side
 *  pane split is deliberate, not measured (r11), so each of its two panes
 *  gets the condensed tile's own readable minimum — twice `MIN_TILE_WIDTH`.
 *  A starting constant like `MIN_TILE_WIDTH` itself: revisit once built
 *  against a real terminal. */
export const MIN_FOCUSED_TILE_WIDTH = 2 * MIN_TILE_WIDTH;

/** The grid's column count (decision 10's column drop): the decision 8
 *  formula with the region-focused tile counted at its larger minimum
 *  (`MIN_FOCUSED_TILE_WIDTH`) and every other tile still counted at
 *  `MIN_TILE_WIDTH`. The delivered geometry: the focused tile grows to its
 *  minimum, the others keep `MIN_TILE_WIDTH` beside it, and the count drops
 *  by exactly one column — the minimal drop — once the focused tile fits at
 *  all; below `MIN_FOCUSED_TILE_WIDTH` nothing fits beside it and the count
 *  is 1. Tiles wrap into additional scroll rows only after that fit is
 *  exhausted — scrolling is the last response to a tight fit, not the first.
 *  No cap in either state (grid-nup-no-cap): wider panels still fit
 *  proportionally more columns, focused or not. `focused` is whether the
 *  focused tile is actually in the grid's membership — the caller checks
 *  that (the focused run may have stopped being active between ticks, before
 *  the vanish handoff moves focus); a focused id pointing at no rendered
 *  tile drops no column. Pure function, same contract as `columnCount`:
 *  reactivity lives at the call site. */
export function gridColumnCount(width: number, focused: boolean): number {
  if (!focused) return columnCount(width, MIN_TILE_WIDTH);
  if (width < MIN_FOCUSED_TILE_WIDTH) return 1;
  return 1 + Math.floor((width - MIN_FOCUSED_TILE_WIDTH) / MIN_TILE_WIDTH);
}

/** One tile's width slice of its row, in percent (decision 10's focused-mode
 *  geometry): the row divides into equal `MIN_TILE_WIDTH`-wide units —
 *  `columns` of them unfocused, `columns + 1` while a tile is promoted (the
 *  column drop reserves the focused tile's two-unit minimum out of the
 *  row's width). The promoted tile takes two units (its
 *  `MIN_FOCUSED_TILE_WIDTH` minimum *is* two units — the two-pane
 *  derivation of the constant), every other tile takes one, so at an
 *  exact-fit width the promoted tile renders exactly
 *  `MIN_FOCUSED_TILE_WIDTH` columns and each other tile exactly
 *  `MIN_TILE_WIDTH`, and every row's units stay the same width whether or
 *  not it holds the promoted tile. A partial row sums below 100% and leaves
 *  its trailing cells empty instead of stretching — the same convention as
 *  the unfocused grid. `promotedRunId` is `promotedTileRunId`'s result —
 *  `undefined` when no tile is promoted, which yields the plain
 *  `100 / columns` slice per tile. Pure function, same contract as the row
 *  math: reactivity lives at the call site. */
export function tileWidthPercent(
  runId: string,
  promotedRunId: string | undefined,
  columns: number,
): number {
  const units = columns + (promotedRunId !== undefined ? 1 : 0);
  return ((runId === promotedRunId ? 2 : 1) * 100) / units;
}

/** The region-focused tile's promotion target (decision 10): the focused
 *  id, but only while it is actually in `runIds` — the grid's current
 *  membership. A focused run that stopped being active between ticks is
 *  no longer a rendered tile: it shows no promoted content and drops no
 *  column. Moving focus itself is the vanish handoff's job (Runtime View)
 *  — this is the render-side half only, so the grid never promotes a tile
 *  that no longer renders. Pure function, same contract as the row math:
 *  reactivity lives at the call site. */
export function promotedTileRunId(
  runIds: string[],
  focusedRunId: string | undefined,
): string | undefined {
  return focusedRunId !== undefined && runIds.includes(focusedRunId) ? focusedRunId : undefined;
}

/** The grid's rows (decision 8): `runIds` chunked in membership order — the
 *  first `columns` runs fill the top row, the rest become additional
 *  scrollable rows. Every run appears in exactly one row and none is
 *  dropped: more active runs than fit one screen is more rows, not a second
 *  pagination mechanism (the runs list's own no-windowing rule, r15 — see
 *  runs-tab.tsx's `runRows`). Pure function, same contract as
 *  `columnCount`: reactivity lives at the call site. A `columns` below 1 is
 *  clamped to 1 — the count never comes from anywhere but `columnCount`,
 *  but a degenerate step would loop forever, so the guard is here and not
 *  trusted to callers. */
export function tileRows(runIds: string[], columns: number): string[][] {
  const step = Math.max(1, Math.floor(columns));
  const rows: string[][] = [];
  for (let i = 0; i < runIds.length; i += step) rows.push(runIds.slice(i, i + step));
  return rows;
}

// --- the region cycle (decision 6) ----------------------------------------

/** The three region kinds the panel container cycles (decision 6): the tab
 *  strip, the content area, and — once tiled — each tile. Tile regions are
 *  named after their run (`tile:` prefix), so one string id covers all
 *  three and the prefix can never collide with the two fixed names. The
 *  container owns the current region (spec: Cross-Component Contracts — the
 *  container, not each leaf view, owns the cycle order and which region is
 *  current); this module owns the vocabulary and the pure math it cycles
 *  with, next to the tile-focus fact the cycle writes. */
export type RegionId = "tab-strip" | "content" | `tile:${string}`;

/** The tab strip region — the cycle's first stop. */
export const TAB_STRIP_REGION: RegionId = "tab-strip";

/** The content area region — the tab strip's forward neighbor. */
export const CONTENT_REGION: RegionId = "content";

/** The region id of one tile. */
export function tileRegionId(runId: string): RegionId {
  return `tile:${runId}`;
}

/** The tile a region id names, or `undefined` for the two fixed regions. */
export function tileRunIdOfRegion(region: RegionId): string | undefined {
  return region.startsWith("tile:") ? region.slice("tile:".length) : undefined;
}

/** The cycle order (decision 6): tab strip, then content area, then each
 *  tile in grid order — the membership order `tileRunIds` returns, so the
 *  cycle visits tiles top-left to bottom-right exactly as the grid lays
 *  them out. Tiles are members only while the grid renders them; the caller
 *  passes the current membership (empty when the runs view isn't tiled).
 *  Pure function, same contract as the row math. */
export function regionOrder(tileIds: readonly string[]): RegionId[] {
  return [TAB_STRIP_REGION, CONTENT_REGION, ...tileIds.map(tileRegionId)];
}

/** The next region in the forward cycle (decision 6): one step forward in
 *  `regionOrder`'s order, wrapping back to the tab strip past the last
 *  region — forward-only wraparound, no reverse-cycle key (decision 6;
 *  ng-reverse-cycle). A `current` outside the order — a tile region whose
 *  run stopped being active between ticks — falls out of `indexOf` at −1
 *  and lands on the first region, so a stale region can never make `Tab` a
 *  no-op. Moving focus off a vanished tile properly is the vanish handoff's
 *  job (Runtime View); this only keeps the step defined. Pure function:
 *  reactivity lives at the call site. */
export function nextRegion(order: readonly RegionId[], current: RegionId): RegionId {
  if (order.length === 0) return CONTENT_REGION;
  const index = order.indexOf(current);
  return order[(index + 1) % order.length]!;
}

/** The focused-tile vanish handoff (spec: Runtime View — region focus when
 *  the focused tile's run disappears): where region focus moves when the run
 *  backing the currently region-focused tile stops being active and so drops
 *  out of the grid (decision 9). `focusedRunId` is the focused tile's run
 *  (`tileRunIdOfRegion` of the container's current region), `tileIds` the
 *  current membership (`tileRunIds`) — both read on the tick that
 *  reclassified the run. The handoff applies only while a tile holds focus
 *  and its run is no longer in membership; any other state returns
 *  `undefined` — no handoff, the caller changes nothing (a focused run still
 *  in membership is focus working as intended, and no tile holding focus
 *  means nothing can point at a tile that no longer renders). When it
 *  applies, focus moves to the next remaining tile if one exists — the first
 *  of the remaining membership, the `pickerOrder` ranking the grid, the
 *  region cycle, and the list agree on (see `tileRunIds`) — else to the
 *  content area: its own default, the region whose surface is then the plain
 *  runs list (`RunsTabContent`'s grid > list > detail precedence leaves the
 *  list once no tiles remain, so with nothing selected the handoff lands on
 *  exactly that list; a list selection survives the tiled stretch, per
 *  run-detail.tsx — the handoff re-points the region, it does not rewrite
 *  the content's own state). `nextRegion` only keeps a stale region
 *  *steppable*; this is what re-points it, on the same tick the tile drops,
 *  before the next keypress. Pure function, same contract as the cycle
 *  math: reactivity lives at the call site — the panel container's effect
 *  reads both inputs inside its reactive scope, so the handoff fires on the
 *  poll tick that dropped the tile. */
export function vanishHandoffTarget(
  tileIds: readonly string[],
  focusedRunId: string | undefined,
): RegionId | undefined {
  if (focusedRunId === undefined) return undefined;
  if (tileIds.includes(focusedRunId)) return undefined;
  return tileIds.length > 0 ? tileRegionId(tileIds[0]!) : CONTENT_REGION;
}

// --- the region-focus border (decision 6's render half) --------------------
//
// Where the border paints as the cycle moves — which `focusable` `Box` takes
// native focus, and so `focusedBorderColor`, per region. Same split as the
// promotion's render half (`promotedTileRunId`): the container owns the state
// (its `region` signal and the projection effect on `focusedTileRunId`),
// these own the per-box verdict the JSX projects it through, so the
// switching matrix is fixture-testable without a render tree.

/** Whether a region's `focusable` `Box` takes native focus — and so paints
 *  its `focusedBorderColor` (decision 6's region indicator) — via its own
 *  `focused` prop. `current` is the panel container's current region, `box`
 *  the candidate box's own region, `panelFocused` the host's
 *  `panel.focused` — region boxes stand down whenever the host has handed
 *  keys back to chat, since claiming focus then would swallow typing. The
 *  one exception to "the box is its region's focus holder": the content area
 *  showing the plain runs list (`RunsTabContent`'s grid > list > detail
 *  precedence), where the filter input, not the box, holds the region's
 *  native focus — pass `listShowing` and the box's prop stays false so the
 *  input keeps its typing. The border still paints there: a focusable box
 *  paints `focusedBorderColor` while a focused descendant holds input
 *  (probe-verified, overlay.tsx). The tab strip and every tile are always
 *  their own region's focus holder — `listShowing` stays false for them.
 *  Pure function, same contract as the cycle math: reactivity lives at the
 *  call site. */
export function regionBoxFocused(
  current: RegionId,
  box: RegionId,
  panelFocused: boolean,
  listShowing = false,
): boolean {
  if (!panelFocused) return false;
  if (current !== box) return false;
  return !(box === CONTENT_REGION && listShowing);
}

/** Whether one tile takes native focus — its `focused` prop, and so its
 *  `focusedBorderColor` (decision 6) — from the tile-facing projection the
 *  container's cycle writes (`focusedTileRunId`): exactly the focused tile,
 *  and only while the panel owns input. A focused id that names no rendered
 *  tile — the frame where a focused run just stopped being active, before
 *  the vanish handoff lands — matches nothing, so no tile renders focused;
 *  an unfocused grid lights none either. Pure function, same contract as
 *  the cycle math. */
export function tileBoxFocused(
  runId: string,
  focusedRunId: string | undefined,
  panelFocused: boolean,
): boolean {
  return panelFocused && focusedRunId === runId;
}
