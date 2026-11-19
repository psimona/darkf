/** @jsxImportSource @opentui/solid */
import type { PanelInput } from "@opencode/plugin/tui/context";
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { For, Show } from "solid-js";
import type { PlanView, TaskListView } from "./digest.ts";
import { RunDetailBody } from "./run-detail.tsx";
import { runTitle } from "./runs-tab.tsx";
import { CompactRunView } from "./sidebar.tsx";
import type { LiveStore } from "./store.ts";
import {
  focusedTileRunId,
  gridColumnCount,
  promotedTileRunId,
  tileBoxFocused,
  tileRows,
  tileRunIds,
  tileWidthPercent,
} from "./tiles.ts";

const DIM = createTextAttributes({ dim: true });

// The `runs` view's tiled mode (spec:
// docs/specs/opencode-overlay-tiles/spec.md — decisions 2, 8, 9, 10): what
// the runs view does once runs are active — one tile per currently-active
// run, not a bolted-on third view. Membership and column math live in
// `tiles.ts` (plain functions, readable from outside the panel's tree);
// this module is the JSX that lays the current membership out.

/** The tile grid: `tileRunIds` re-derived inside this render scope, so the
 *  grid tracks the store's own poll tick — a run that starts appears as a
 *  new tile and a run that stops being active drops out on that tick
 *  (decision 9), with no open action and no manual refresh. Columns come
 *  from the panel input's reactive `width` through `gridColumnCount`
 *  (decisions 8 and 10): however many `MIN_TILE_WIDTH`-wide tiles fit,
 *  floored, no cap; while a tile holds region focus the focused tile is
 *  counted at its larger minimum (`MIN_FOCUSED_TILE_WIDTH`) and the others
 *  still at `MIN_TILE_WIDTH` — the column drop, which gives up exactly one
 *  column and happens before the grid ever scrolls a tile out of view.
 *  Each tile renders at its unit slice of the row (`tileWidthPercent`):
 *  the promoted tile takes the two-unit width its detail view needs, the
 *  others keep one `MIN_TILE_WIDTH` unit — nothing shrinks below its
 *  minimum, and only after the fit is exhausted do tiles wrap into
 *  additional scroll rows. More active runs than fit one screen become
 *  additional scrollable rows in the scrollbox below, never a paginated
 *  second page, and no active run is ever sliced off. N=1 at narrow widths
 *  is the formula's boundary case, not a branch here. Rows are explicit
 *  boxes (not flexWrap) so the row math stays in the tested pure function
 *  (`tileRows`) and the grid, the region cycle, and the tests agree on one
 *  layout. Each tile's content is decision 10: the run's title over `sidebar.tsx`'s compact
 *  view (`CompactRunView`, reused verbatim) — and, for the one tile holding
 *  region focus, the full detail view (`RunDetailBody`, the same body the
 *  list's detail view renders) promoted in place inside the still-visible
 *  grid; the other tiles stay condensed rather than being hidden outright,
 *  so side-by-side comparison survives focusing one run. Promotion needs
 *  only the read (`focusedTileRunId`) — the region cycle that writes it is
 *  the panel container's (decision 6, the region-focus task), and until it
 *  lands every tile simply renders condensed. The focused id must be in
 *  the current membership to promote: a focused run that stopped being
 *  active between ticks drops no column and shows no promoted tile —
 *  moving focus itself is the vanish handoff's job, not this render's. */
export function TileGrid(props: {
  store: LiveStore;
  panel: PanelInput;
  accent: RGBA;
  errorColor: RGBA;
}): JSX.Element {
  const ids = () => tileRunIds(props.store);
  // The focused tile's promotion (decision 10): the focused id counts only
  // while it is actually in membership — see the component doc above.
  const promoted = () => promotedTileRunId(ids(), focusedTileRunId());
  const columns = () => gridColumnCount(props.panel.width, promoted() !== undefined);
  // Each tile's unit slice of its row (decision 10's focused-mode geometry):
  // the promoted tile takes two `MIN_TILE_WIDTH`-wide units, the others one.
  const tileWidth = (runId: string): `${number}%` =>
    `${tileWidthPercent(runId, promoted(), columns())}%`;
  const rows = () => tileRows(ids(), columns());
  // `tileRunIds` returns ids; the entry lookup fills in each tile's title.
  // Past-tick lookups can't dangle: `views()`/`pickerCandidates()` hold
  // every registry run, so the tick that retires a tile also removes the
  // tile itself before any lookup could miss.
  const entry = (runId: string) =>
    props.store.pickerCandidates().find((candidate) => candidate.entry.runId === runId)?.entry;
  const title = (runId: string): string => {
    const found = entry(runId);
    return found ? runTitle(found) : runId;
  };
  // The same maps the detail view reads: `views()` holds every registry run,
  // so a tile's compact view renders exactly like the sidebar's and the
  // promoted tile's body exactly like the list's detail view. The one gap
  // is a run's first tick — the auto-open can fire before the store's first
  // view for it lands (the same placeholder both show).
  const view = (runId: string): PlanView | undefined => props.store.views().get(runId);
  const taskView = (runId: string): TaskListView | undefined => props.store.taskViews().get(runId);

  return (
    // `focusable={false}`: `ScrollBoxRenderable` defaults focusable
    // (`ScrollBox.d.ts`'s `defaultFocusable = true`) — left on, it grabs
    // native keyboard focus and swallows up/down for its own scrolling
    // before this tab's global-mode command layers see them (the same
    // confirmed behavior the `workflows` branch's scrollbox guards against
    // in overlay.tsx). The grid owns no input of its own — the runs list's
    // filter input was what kept its scrollbox safe — so the guard is
    // required here, not optional.
    <scrollbox flexGrow={1} minHeight={0} scrollY border focusable={false}>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" flexShrink={0}>
            <For each={row}>
              {(runId) => (
                // One tile per active run, at its unit slice
                // (`tileWidthPercent`): one `MIN_TILE_WIDTH` unit each, two
                // for the promoted tile, so a partial row leaves its
                // trailing cells empty instead of stretching its tiles —
                // the grid stays aligned with the rows above it at every
                // column count, focused or not. Each tile is also one
                // region of the panel container's cycle (decision 6): a
                // native `focusable` `Box` whose `focusedBorderColor` —
                // the accent, matching every focus indicator's color
                // source — paints only while this tile is the current
                // region (`focusedTileRunId`, written by the container in
                // overlay.tsx) and the panel owns input; the tile's own
                // border color is left at the default so an unfocused
                // tile looks exactly as before. `focused` moves native
                // focus with the region, which is what makes the border
                // paint — and what carries input into the promoted tile.
                // The verdict is `tiles.ts`'s pure `tileBoxFocused` — the
                // render half of region focus (decision 6), fixture-tested
                // in tiles.test.ts.
                <box
                  flexDirection="column"
                  width={tileWidth(runId)}
                  flexShrink={0}
                  border
                  focusable={true}
                  focusedBorderColor={props.accent}
                  focused={tileBoxFocused(runId, focusedTileRunId(), props.panel.focused)}
                >
                  <text attributes={DIM} wrapMode="none">
                    {title(runId)}
                  </text>
                  <Show when={view(runId)} fallback={<text attributes={DIM}>loading run…</text>}>
                    {(resolved: () => PlanView) => (
                      // The promotion branch is this inner Show's `when`, not
                      // a ternary here: `Show` runs its children untracked,
                      // so a ternary would only re-decide on the next poll
                      // tick — a focus flip must promote (and revert) at
                      // once, not one tick late. Same nesting as
                      // `RunsTabContent`'s list↔detail switch.
                      <Show
                        when={promoted() === runId}
                        fallback={
                          <CompactRunView
                            view={resolved()}
                            accent={props.accent}
                            errorColor={props.errorColor}
                          />
                        }
                      >
                        {/* Decision 10's promotion: the full detail view,
                            inside the still-visible grid — this tile renders
                            at its two-unit minimum width for it, the other
                            tiles stay condensed beside it. */}
                        <RunDetailBody
                          view={resolved()}
                          taskView={taskView(runId)}
                          accent={props.accent}
                          errorColor={props.errorColor}
                        />
                      </Show>
                    )}
                  </Show>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </scrollbox>
  );
}
