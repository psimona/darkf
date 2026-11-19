// Tab-strip keyboard navigation (docs/specs/opencode-overlay-tiles/spec.md,
// decision 7): the tab strip is genuinely keyboard-navigable, not just a
// click surface with number-key shortcuts. Once the strip holds region-level
// focus, arrow keys move a highlighted cursor across the tab labels and
// `Enter`/`Space` activates the one under the cursor; the direct number-key
// jump (`1`/`2`) stays as a shortcut (overlay.tsx's container layer). The
// cursor'd label is marked with the row-focus convention — `❯` gutter plus
// inverse band, from `row-focus.ts` (decision 5) — so the indicator never
// relies on color alone. Pure module next to `row-focus.ts`: unit-testable
// without the TUI JSX runtime (the same reasoning `tiles.ts` gives), leaving
// `overlay.tsx` with only the signal wiring.

/** The strip's two tabs — also the traversal order the cursor walks them
 *  in, left to right, matching the labels' display order. */
export type TabId = "workflows" | "runs";

/** The tabs in traversal order. One array is the single source of both the
 *  step math below and the strip's label order, so a future third tab
 *  extends the cursor's path by appending here — no step-math change. */
export const TAB_ORDER: readonly TabId[] = ["workflows", "runs"];

/** Which way an arrow key pushes the cursor: `left` toward the previous
 *  label in `TAB_ORDER`, `right` toward the next. The strip is one
 *  horizontal row of labels, so left/right are its arrow keys — up/down
 *  stay with the content area's row cursors (`workflows-tab.tsx`/
 *  `runs-tab.tsx`). */
export type TabCursorDirection = "left" | "right";

/** One arrow-key step across the labels (decision 7): `direction` moves one
 *  label over in `TAB_ORDER`, wrapping around at both ends — with two labels
 *  the two directions read as a toggle, and the wraparound is what keeps
 *  every label reachable from every other with the same two keys. A
 *  `current` outside `TAB_ORDER` (impossible from the component's own
 *  signal, but guarded the same way `nextRegion` guards a stale region)
 *  steps from the first label rather than producing an out-of-range index.
 *  Pure function: reactivity lives at the call site. */
export function nextTabLabel(current: TabId, direction: TabCursorDirection): TabId {
  const index = TAB_ORDER.indexOf(current);
  const base = index === -1 ? 0 : index;
  const step = direction === "right" ? 1 : -1;
  return TAB_ORDER[(base + step + TAB_ORDER.length) % TAB_ORDER.length]!;
}
