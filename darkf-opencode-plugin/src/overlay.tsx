/** @jsxImportSource @opentui/solid */
import { type Plugin, usePlugin } from "@opencode/plugin/tui";
import type { KeymapCommand, PanelInput } from "@opencode/plugin/tui/context";
import { createTextAttributes, type Renderable, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { type Accessor, createEffect, createSignal, Show } from "solid-js";
import { canTogglePresentation, type Presentation } from "./presentation.ts";
import { BOLD_INVERSE, INVERSE, rowGutter } from "./row-focus.ts";
import { RunsTabContent } from "./run-detail.tsx";
import type { LiveStore } from "./store.ts";
import { nextTabLabel, type TabCursorDirection, type TabId } from "./tab-strip.ts";
import {
  CONTENT_REGION,
  nextRegion,
  type RegionId,
  regionBoxFocused,
  regionOrder,
  setFocusedTileRunId,
  setPanelOpen,
  TAB_STRIP_REGION,
  tileRunIdOfRegion,
  tileRunIds,
  vanishHandoffTarget,
} from "./tiles.ts";
import { ToggleTab } from "./toggle-tab.tsx";
import { WorkflowsTab } from "./workflows-tab.tsx";

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

// Module-level, not component-local — `openOverlay`/`closeOverlay` are called
// from `toggle.tsx`'s slot handler and `tui.tsx`'s auto-open/command, none of
// which sit inside this module's own render tree. `undefined` = not
// initialized (setup hasn't run); once set, open state lives entirely in the
// host (an open panel under `PANEL_NAME` — `ui.panel.current()` — is an open
// overlay). `panel` holds the slot input captured at the claim's last render,
// so `openOverlay` can reach the contribution's own `focus` action from
// outside any render tree; `requestedRunId` carries the run an auto-open or
// the footer toggle asked for, consumed when the content mounts. Same
// "plugin-owned, in-memory, not persisted" shape `locate.ts`'s `bindings`
// map already uses.
let registered:
  | {
      context: Plugin.Context;
      store: LiveStore;
      panel?: PanelInput;
      requestedRunId?: string;
    }
  | undefined;

/** Captures the context and store the overlay opens against. Called once
 *  from `setup`; before it runs, `openOverlay`/`closeOverlay` no-op. */
export function initOverlay(context: Plugin.Context, store: LiveStore): void {
  registered = { context, store };
}

/** The one `session.panel` contribution's content name — what `ui.panel.open`
 *  must select for the claim below to render. Plugin-prefixed, mirroring the
 *  existing `darkf.open` command id. */
export const PANEL_NAME = "darkf.panel";

/** Registers the overlay's home: one `session.panel` slot claim, added once
 *  from `tui.tsx`'s `setup` (see spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — Panel registration; decision
 *  1). The host owns the panel's layout and input scope, and `input.name` —
 *  set by `ui.panel.open` — selects which contribution renders, so this
 *  renders nothing until the panel is opened under `PANEL_NAME`. The panel
 *  is session-scoped, not a route: opening it never changes
 *  `router.current()` — the same guarantee the host dialog gave. Each render
 *  also captures the live input on the module state above: its
 *  `focus`/`close`/`toggleFullscreen` actions are the panel-side half of
 *  `openOverlay`/`closeOverlay` and of the presentation control (decision
 *  3). */
export function registerOverlayPanel(context: Plugin.Context, store: LiveStore): void {
  context.ui.slot({
    append: "session.panel",
    render: (input) => {
      // Capture the live input for `openOverlay`'s already-open path (see
      // the module state above). Plain variable write — no signal — so it is
      // safe inside this reactive render.
      const host = registered;
      if (host) host.panel = input;
      const open = () => input.name === PANEL_NAME;
      // Publish open state to the tile reads (spec:
      // docs/specs/opencode-overlay-tiles/spec.md — Tile membership and tile
      // focus): this claim render is the one place the host tells the plugin
      // the open name flipped — the same flip the `Show` below reacts to —
      // so it is where the sidebar-readable membership derives its open
      // fact from. A repeated value is a no-op write (Solid skips equal
      // signal values), so re-renders that don't change open state don't
      // disturb anything downstream.
      setPanelOpen(open());
      // Callback children, not element children: Bun's JSX transform builds
      // JSX children eagerly (no lazy `get children()`), so element children
      // would mount `OverlayContent` — its `usePlugin` read and its
      // `1`/`2` keymap layer — even while another name is selected. The
      // callback body runs only when `Show` calls it, i.e. only once this
      // contribution's name is the selected one; the declared parameter is
      // required (Solid invokes callback children only when they take one).
      return (
        <Show when={open()}>
          {(_selected: Accessor<boolean>) => (
            <OverlayContent store={store} panel={input} runId={host?.requestedRunId} />
          )}
        </Show>
      );
    },
  });
}

/** The tab the overlay opens on (r3): `workflows` — the catalog of workflow
 *  definitions — unless a specific run was asked for, which lands on `runs`.
 *  Every no-`runId` open (`/darkf`, the footer toggle with no bound run)
 *  therefore opens with no run context at all: the catalog, not the stacked
 *  `pickRun` dialog this replaces. */
export function initialTab(runId?: string): TabId {
  return runId !== undefined ? "runs" : "workflows";
}

/** Opens the overlay: the one `session.panel` contribution hosting the
 *  `workflows`/`runs` tab container. `runId` — auto-open and the footer
 *  toggle's bound run — selects the `runs` tab; without one the `workflows`
 *  catalog is the default (r3). The runId seeds the content when it mounts;
 *  while the panel is already open, a newly observed run reaches it through
 *  the store's own poll tick instead — grid membership is automatic, so
 *  auto-open needs no re-open (spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — Runtime View). Never touches
 *  the router — the panel is session-scoped, not a route (decision 1). Safe
 *  to call whether or not the overlay is already open: already-open resolves
 *  to the captured input's `focus` action (no remount); otherwise
 *  `ui.panel.open` under `PANEL_NAME` — the documented open path for call
 *  sites outside the panel's render tree. No presentation option is
 *  passed: the host's own open default is the side panel, and its
 *  narrow-terminal rule is exactly decision 3's policy — side panel
 *  whenever there's room, full-screen forced where a split wouldn't fit —
 *  so the plugin re-stating it would only let the two disagree.
 *  `open` returns false outside a
 *  session, so a home-screen auto-open — which the dialog used to serve —
 *  degrades to a no-op; the panel is session-scoped by spec decision 1.
 *  There is no second surface anywhere: both tabs are inline content in the
 *  one contribution. */
export function openOverlay(runId?: string): void {
  const host = registered;
  if (!host) return;
  host.requestedRunId = runId;
  if (host.context.ui.panel.current()?.name === PANEL_NAME) {
    host.panel?.focus();
    return;
  }
  host.context.ui.panel.open(PANEL_NAME);
}

/** Closes the overlay: closes this plugin's active panel — a no-op when
 *  nothing is open, and never another plugin's panel. Replaces the
 *  dialog-era `ui.dialog.clear` for the call sites outside the panel's
 *  render tree. Closing stays explicit (decision 11): a panel documents no
 *  escape behavior of its own, so nothing here assumes one — the keyboard
 *  close is the plugin's own binding (`panelCloseCommand`, carried by
 *  `OverlayContent`'s keymap layer) and the mouse close is the footer
 *  badge's press, both landing on this same `ui.panel.close`. */
export function closeOverlay(): void {
  registered?.context.ui.panel.close();
}

/** The keymap-bound close action (decision 11 — the explicit-close
 *  requirement). The dialog era's escape-to-close was the host dialog's own
 *  behavior; a `session.panel` documents none, so instead of assuming one
 *  the plugin binds close itself. Bound to `escape` to keep the muscle
 *  memory the dialog shipped, and given a stable id — ids double as config
 *  keybind identifiers, so the binding is user-rebindable without a code
 *  change if the live check below says the host claims the key.
 *
 *  Unverified until checked live (the same pending-empirical discipline
 *  decision 11 names): whether this binding actually wins dispatch on an
 *  open panel. The host is understood to claim `escape` for
 *  `session.interrupt` elsewhere in the TUI, and the runs list's filter
 *  input may consume it while it holds native focus — either would starve
 *  this command, which the spec's live check ("confirm `Escape` behavior
 *  on an open `session.panel`") exists to settle. Until then the footer
 *  badge's press — verified, the dialog era's own close control — stays
 *  the close path that doesn't depend on the check.
 *
 *  `close` is injected rather than reached for globally: the call site
 *  passes its panel input's own `close` action — the same action the
 *  footer toggle's press uses — keeping this factory pure and testable
 *  without the render tree. Callers register it inside a layer whose
 *  lifetime is the panel content's mount (`OverlayContent`'s layer is
 *  disposed by the host when the panel closes), so the command is
 *  unreachable while no panel is open — closing can't fire from a closed
 *  panel. */
export function panelCloseCommand(close: () => void): KeymapCommand {
  return {
    id: "darkf.panel.close",
    title: "Close darkf panel",
    group: "darkf",
    bind: "escape",
    run: () => close(),
  };
}

// The top-level tab strip (r1): `workflows │ runs`, replacing the run-scoped
// `workflow/tasks` strip the dialog used to carry when bound to one run.
// Both tabs are unconditional — unlike the old `tasks` tab (hidden until
// tasks.json existed), a tab never disappears here.
//
// The strip is genuinely keyboard-navigable (decision 7): the container's
// `1`/`2` number-key jump stays as a shortcut, and once the strip holds
// region-level focus, left/right move a highlighted cursor across the labels
// and `Enter`/`Space` activate the label under it — the host's own
// "Tab focus then Enter" convention from its Select actions docs. The cursor
// state (which label it sits on) lives in the container, next to the tab
// selection it acts on; this component renders it and carries the strip's
// own keys, the same "each view registers its own layer" participation the
// leaf views already do (spec: Cross-Component Contracts,
// keymap-region-participation).
function TabBar(props: {
  active: TabId;
  accent: RGBA;
  regionFocused: boolean;
  cursor: TabId;
  onSelect: (tab: TabId) => void;
  onMove: (direction: TabCursorDirection) => void;
  onActivate: () => void;
}): JSX.Element {
  const context = usePlugin();

  // The strip's own keys (decision 7): left/right move the container-held
  // cursor, `Enter`/`Space` activate the label under it. One layer, scoped
  // to this mount — the host disposes it when the panel closes. Three
  // pieces make these keys fire only when the strip really is the thing
  // under the user's fingers, and win when they do:
  //
  // - `target` — the strip region box below. A targeted layer's bindings
  //   are live only while that renderable holds native focus ("focus-within"
  //   — the same shape the host's own dialog layers use, including how the
  //   host's select/prompt dialogs capture `return` away from the editor's
  //   global `input.submit`). Region boxes take native focus exactly when
  //   they are the current region and the panel owns input (their `focused`
  //   prop below), so the target alone is already the right gate.
  // - `priority: 1` — while the strip holds focus, these bindings outrank
  //   the leaf views' `mode: "global"` layers (no priority): the runs list
  //   binds `return` ("Open run") and the workflow tree binds `space`
  //   ("Toggle / follow"), and without the ranking those globals would fire
  //   while the strip is focused — Enter would open a run, Space would
  //   toggle a tree row. With it, the strip wins precisely while it holds
  //   focus, and hands both keys straight back the moment focus leaves.
  // - `enabled` — the same region fact the border uses (below). The target
  //   already implies it; this keeps the commands out of the reachable set
  //   (command palette, keyboard help) while the strip isn't current, rather
  //   than merely unmatched.
  //
  // `mode: "global"`, not a custom mode name — a custom-mode layer never
  // activates from panel-hosted content (see OverlayContent's doc comment).
  // `bind: "space,return"` is one command with two keys: Enter and Space are
  // the same action under the two names the host convention uses. Enter's
  // arrival is expected from the target+priority shape but is exactly the
  // kind of dispatch behavior this codebase confirms live once built (the
  // same discipline decision 11 applies to Escape on a panel); Space and the
  // arrows are the already-verified key class (`up`/`down` fire the same
  // way, per workflows-tab.tsx's layer note).
  let stripBox: Renderable | undefined;
  context.keymap.layer(() => ({
    mode: "global",
    target: () => stripBox,
    priority: 1,
    enabled: () => props.regionFocused,
    commands: [
      {
        id: "darkf.tab.cursor.left",
        title: "Previous tab label",
        group: "darkf",
        bind: "left",
        run: () => props.onMove("left"),
      },
      {
        id: "darkf.tab.cursor.right",
        title: "Next tab label",
        group: "darkf",
        bind: "right",
        run: () => props.onMove("right"),
      },
      {
        id: "darkf.tab.activate",
        title: "Activate tab",
        group: "darkf",
        bind: "space,return",
        run: () => props.onActivate(),
      },
    ],
    bindings: ["darkf.tab.cursor.left", "darkf.tab.cursor.right", "darkf.tab.activate"],
  }));

  // One label: its gutter reserves the cursor glyph's two cells at all times
  // (`rowGutter`, the row-focus convention) so the strip keeps its width as
  // the cursor moves instead of shifting under it, and the inverse band
  // marks the cursor'd label without touching color — the accent/bold
  // treatment stays the active tab's non-focus meaning (decision 5), and
  // focus is band + glyph alone. No cursor renders while the strip doesn't
  // hold region focus: the cursor exists for traversal, and the labels then
  // look exactly as before this layer existed.
  const label = (id: TabId): JSX.Element => {
    const cursorHere = () => props.regionFocused && props.cursor === id;
    const active = () => props.active === id;
    return (
      <text
        fg={active() ? props.accent : undefined}
        attributes={
          cursorHere() ? (active() ? BOLD_INVERSE : INVERSE) : active() ? BOLD : undefined
        }
        onMouseDown={() => props.onSelect(id)}
      >
        {rowGutter(cursorHere())}
        {id}
      </text>
    );
  };

  return (
    // The strip is the region cycle's first region (decision 6): one native
    // `focusable` `Box` around both labels, shown with `focusedBorderColor`.
    // The always-on border needs `borderColor="transparent"` — setting
    // `focusedBorderColor` alone forces `border` on, in the default white —
    // so the strip only shows its accent outline while it holds region
    // focus, and otherwise looks as before (keeping the one-cell inset the
    // border reserves at both times). `focused` carries native focus here
    // with the region, which is what makes the border paint and what the
    // layer's `target` above keys off. `flexShrink={0}`: boxes shrink by
    // default, and a tall content side (the tile grid's natural height)
    // would squeeze the strip's label row out of the layout — the strip
    // keeps its row and the content side, a scroll region, absorbs the
    // deficit.
    <box
      ref={(el: Renderable) => {
        stripBox = el;
      }}
      flexDirection="row"
      gap={1}
      flexShrink={0}
      borderColor="transparent"
      focusedBorderColor={props.accent}
      focusable={true}
      focused={props.regionFocused}
    >
      {label("workflows")}
      <text>│</text>
      {label("runs")}
    </box>
  );
}

/** The presentation control (decision 3): `panel │ full` — the active
 *  presentation accented and bold (the detail view's layout-toggle
 *  convention), clicking the other label asking the host to flip via
 *  `panel.toggleFullscreen()`, routed through the host like every other
 *  panel action so the host's own narrow-terminal rule stays the one
 *  enforcement point. Always rendered (decision 3): both labels render in
 *  both presentations and at every measured width — never conditionally
 *  hidden, so the control is consistently discoverable. On a terminal too
 *  narrow to split a side panel the host forces full-screen and refuses
 *  the press; `canTogglePresentation` recognizes that case from the
 *  documented reactive state (the slot input's `width`/`presentation`),
 *  and the control shows it — every label dims, the accent drops, and a
 *  trailing `narrow` hint names the reason. That is the visibly-a-no-op
 *  rendering the narrow-fullscreen criterion requires: an inert control
 *  must not keep the "this one is active" accent (it would read as two
 *  live choices), but it also must not vanish — the labels keep their
 *  places and the press stays routable, the host doing the refusing.
 *  Click, not keys: the footer's other control (the close badge) is
 *  click-only, the control holds no region in the cycle (decision 6's
 *  order is the container's, and this task adds no region to it), and a
 *  press that can be refused is a request, not a command worth a binding.
 *  Reactive by the same read the tile grid uses (decision 4): the slot
 *  input's `width`/`presentation` are live getters, read inside this
 *  render's attribute expressions, so the control re-renders across the
 *  narrow threshold and across presentation flips without a remount. */
function PresentationToggle(props: { panel: PanelInput; accent: RGBA }): JSX.Element {
  const inert = () => !canTogglePresentation(props.panel.width, props.panel.presentation);
  const label = (id: Presentation): JSX.Element => (
    <text
      fg={props.panel.presentation === id ? props.accent : undefined}
      attributes={inert() ? DIM : props.panel.presentation === id ? BOLD : undefined}
      onMouseDown={() => {
        if (props.panel.presentation !== id) props.panel.toggleFullscreen();
      }}
    >
      {id === "panel" ? "panel" : "full"}
    </text>
  );
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      {label("panel")}
      <text attributes={DIM}>│</text>
      {label("fullscreen")}
      <Show when={inert()}>
        <text attributes={DIM}>narrow</text>
      </Show>
    </box>
  );
}

/** The overlay's content: the tab container, hosted in the one
 *  `session.panel` contribution instead of a registered route — opening it
 *  never changes `ui.router.current()`, so a run first detected while it's
 *  open still binds to the real session (see spec:
 *  docs/specs/opencode-overlay-tiles/spec.md — decision 1). The panel input
 *  carries the host-owned facts (`focused`, `width`, `presentation`) and the
 *  content-side actions: the footer toggle closes via `panel.close()`, and
 *  `panel.toggleFullscreen()` is threaded through for the presentation
 *  control (decision 3). The layer here carries the tab shortcuts (`1`/`2`),
 *  the region cycle (`Tab`), and the keymap-bound close action (decision 11
 *  — `panelCloseCommand`, bound to `escape` by the plugin's own choice since
 *  a panel documents no escape behavior; its live dispatch is unverified
 *  until checked), while the tab strip's own traversal keys — arrow-key
 *  cursor across the labels, `Enter`/`Space` activation (decision 7) — are
 *  `TabBar`'s own layer, targeted at the strip's region box so they fire
 *  (and outrank the leaf views' globals) only while the strip holds native
 *  focus.
 *
 *  This container also owns the region cycle (decision 6, the region-focus
 *  layer): the tab strip, the content area, and — once tiled — each tile are
 *  one native `focusable` `Box` each, shown with `focusedBorderColor`, and
 *  `Tab` cycles region focus forward through them with wraparound. The
 *  container — not each leaf view — owns the cycle order and which region is
 *  current (spec: Cross-Component Contracts, keymap-region-participation):
 *  the order comes from `regionOrder` over the current tile membership, and
 *  the current region is this component's `region` signal, projected onto
 *  the region boxes as their `focused` prop (native focus follows, which is
 *  what paints the border — probe-verified against `@opentui/core`:
 *  `focusedBorderColor` paints while a `focusable` box — or any descendant
 *  of it — holds native focus). The cycle writes the tile-facing half of the
 *  state into `tiles.ts`'s `focusedTileRunId` — the read the grid promotes
 *  on (decision 10) and later consumers read. Region focus starts at the
 *  content area: the panel's keys have always landed there (its layers
 *  drive the rows), so opening must not change what input does — and the
 *  border shows where input is from the first frame, the focus-visibility
 *  fix this spec exists for. `mode: "global"` (not a custom mode name) —
 *  the host's own `keymap.tsx` only gates a layer on a custom mode string
 *  via the mode stack's `enabled()` check, which depends on
 *  `useInteractivity()` reporting this subtree as interactive;
 *  empirically it never does, so a custom-mode layer registered from
 *  dialog-hosted content never activates (confirmed live: no bound key
 *  fired, in two separate sessions, until switched to `"global"`). The
 *  host's own test fixture for this exact shape (`setup-keymap/tui.tsx`'s
 *  `FixtureDialog`) uses `mode: "global"` too — no first-party code
 *  combines a custom `mode.push` name with dialog/panel-hosted content. Per
 *  the plugin docs, the layer is active only while the panel owns input.
 *  The `runs` tab's content — the tile grid while runs are active
 *  (decision 9), else the list (r5) and its detail view (r6/r7) — lives in
 *  `run-detail.tsx`'s `RunsTabContent` and renders inside the content-area
 *  region box; the shared scrollbox stays on the `workflows` branch,
 *  because the runs side owns its scroll regions (the list's filter input
 *  must stay put while its rows scroll, and the detail view's panes scroll
 *  under a pinned header). */
function OverlayContent(props: {
  store: LiveStore;
  panel: PanelInput;
  runId?: string;
}): JSX.Element {
  const context = usePlugin();

  const accent = context.theme.text.action.primary.base;
  const errorColor = context.theme.text.feedback.error.base;

  // r3: `workflows` is the default with no active run. Auto-open passes the
  // run it observed and lands on `runs`; that run seeds the tab's selection
  // (`RunsTabContent`'s `selectedRunId`), so an auto-open opens on the
  // observed run's detail view — back from there is the list (r7). The
  // selection lives here, not in `RunsTabContent`: the content region's
  // native-focus decision below needs the same grid/list/detail fact the
  // content renders (a selected run means no filter input to hold focus).
  const [tab, setTab] = createSignal<TabId>(initialTab(props.runId));
  const [selectedRunId, setSelectedRunId] = createSignal<string | undefined>(props.runId);

  // The region cycle's current region (decision 6). Component-local — the
  // host disposes it with the panel; the next open starts at the content
  // area again. Tiles.ts's `focusedTileRunId` is this signal's tile-facing
  // projection, kept in sync by the effect below.
  const [region, setRegion] = createSignal<RegionId>(CONTENT_REGION);

  // The host's panel-focus fact: region boxes only take native focus while
  // the panel owns input at all — claiming focus while the host has handed
  // keys back to chat would swallow typing (the same fight the root box's
  // comment below already documents for the dialog era).
  const panelFocused = () => props.panel.focused;

  // The runs view's tile membership, and whether the plain list is what the
  // content area is showing (grid > list > detail — run-detail.tsx's
  // precedence). Tiles join the cycle only while the grid renders them.
  const tiles = () => tileRunIds(props.store);
  const listShowing = () =>
    tab() === "runs" && tiles().length === 0 && selectedRunId() === undefined;

  // The cycle order over the current membership (decision 6): strip, then
  // content, then one region per rendered tile.
  const regions = () => regionOrder(tab() === "runs" ? tiles() : []);

  // A tab switch swaps the content area's whole surface: a tile region
  // would point at a tile that no longer renders on the other tab, and the
  // old tab's region has no meaning there. Region focus resets to the
  // content area — the surface the switch just brought forward.
  const switchTab = (next: TabId): void => {
    setTab(next);
    setRegion(CONTENT_REGION);
  };

  // The tab-strip cursor (decision 7): which label the strip's arrow keys
  // would highlight and `Enter`/`Space` would activate. It only means
  // something while the strip holds region focus, and it starts wherever
  // the active tab is: `Tab` landing on the strip always highlights the
  // tab you're already on — focus lands somewhere sensible, Enter commits
  // it — so traversal begins from a true statement about the world. The
  // snap is an effect on the region, so re-entering the strip after any
  // tab change (keys, click, `1`/`2`) re-syncs the cursor before the first
  // arrow press can run.
  const [cursorTab, setCursorTab] = createSignal<TabId>(initialTab(props.runId));
  createEffect(() => {
    if (region() === TAB_STRIP_REGION) setCursorTab(tab());
  });

  // Arrow keys step the cursor (wraparound per `nextTabLabel`); activation
  // is `switchTab` on the cursor'd label — exactly what `1`/`2` do, so
  // activating from the strip and jumping by number are the same action,
  // including the reset of region focus onto the surface the switch
  // brought forward.
  const moveTabCursor = (direction: TabCursorDirection): void => {
    setCursorTab(nextTabLabel(cursorTab(), direction));
  };
  const activateTabCursor = (): void => {
    switchTab(cursorTab());
  };

  // Created after the signals: the layer factory runs once untracked at
  // registration, so everything it reads must already exist. Scoped to this
  // mount — the host disposes it when the panel closes. The layer carries
  // the panel-wide keys: the tab shortcuts, the region cycle, and decision
  // 11's keymap-bound close (below) — close is the container's concern, not
  // a region's or a leaf view's, so it needs no target and no priority
  // (nothing else in the plugin binds `escape`; the leaf views leave it
  // unbound on purpose).
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "darkf.tab.workflows",
        title: "Workflows tab",
        group: "darkf",
        bind: "1",
        run: () => {
          switchTab("workflows");
        },
      },
      {
        id: "darkf.tab.runs",
        title: "Runs tab",
        group: "darkf",
        bind: "2",
        run: () => {
          switchTab("runs");
        },
      },
      {
        // The region cycle's forward step (decision 6): bare `Tab` —
        // confirmed live (user testing, 2026-11-19) that the host's
        // session-tab cycling does not claim it, and `Shift+Tab` (the
        // host's plan/build toggle) is a different key. Forward-only
        // wraparound, no reverse-cycle key (decision 6;
        // ng-reverse-cycle). The leaf views' own layers participate in
        // the order this defines; they never bind `Tab` themselves.
        id: "darkf.region.next",
        title: "Next region",
        group: "darkf",
        bind: "tab",
        run: () => {
          setRegion(nextRegion(regions(), region()));
        },
      },
      // Closing stays explicit (decision 11): the keyboard half of the
      // panel's close paths — the footer badge's press is the mouse half.
      // `escape` is this command's binding by choice, not an assumed host
      // behavior; whether it wins dispatch on a live panel is the binding's
      // own pending live check (panelCloseCommand's doc comment).
      panelCloseCommand(() => props.panel.close()),
    ],
    bindings: ["darkf.tab.workflows", "darkf.tab.runs", "darkf.region.next", "darkf.panel.close"],
  }));

  // The tile-facing half of region focus (decision 6): the grid promotes
  // the focused tile (decision 10) from `tiles.ts`'s read, so the cycle
  // keeps it in step with this signal. Writes only on region changes — a
  // membership change alone never writes here, which is what leaves the
  // vanish handoff (Runtime View) free to move focus on its own tick.
  createEffect(() => {
    setFocusedTileRunId(tileRunIdOfRegion(region()));
  });

  // The vanish handoff (Runtime View — region focus when the focused tile's
  // run disappears): when the run backing the region-focused tile stops
  // being active, the same poll tick that drops its tile re-points region
  // focus — at the next remaining tile if one exists, else at the content
  // area (whose surface is then the plain runs list, `RunsTabContent`'s
  // grid > list > detail precedence) — never left pointing at a tile that
  // no longer renders. An effect on both reads: the region (which run, if
  // any, holds focus) and the membership (the tick that reclassified the
  // run). The pure decision is `vanishHandoffTarget` — its `undefined`
  // means no handoff applies (no tile holds focus, or the focused run is
  // still in membership) and this changes nothing. Writing `region` re-runs
  // the projection effect above, so `focusedTileRunId` follows in the same
  // tick; this effect's own re-run then sees focus back inside membership
  // and stops — one move, no loop. Until it fires, the grid's own
  // promotion guard (`promotedTileRunId`) already renders no promoted tile
  // for a vanished run, so no frame shows a stale reference.
  createEffect(() => {
    const target = vanishHandoffTarget(tiles(), tileRunIdOfRegion(region()));
    if (target !== undefined) setRegion(target);
  });

  // Where the content area's native focus goes while it is the current
  // region: the region box itself — except on the plain runs list, where
  // the filter input is the content's native focus holder. Standing the
  // box down there keeps the input's typing alive and the host's
  // `input.submit` gate off the list's `return` binding (the input is
  // focused, so the host still yields `return` — see runs-tab.tsx's
  // layer note); the region border still paints, because a focusable box
  // paints `focusedBorderColor` while a focused descendant holds input.
  // Both verdicts are `tiles.ts`'s pure `regionBoxFocused` — the render
  // half of region focus (decision 6), fixture-tested in tiles.test.ts.
  const contentBoxFocused = () =>
    regionBoxFocused(region(), CONTENT_REGION, panelFocused(), listShowing());
  const listInputFocused = () =>
    regionBoxFocused(region(), CONTENT_REGION, panelFocused()) && listShowing();

  return (
    // `focused` is the host's call now, not the content's: the dialog era
    // hardcoded it because dialog content had no other way to receive keys,
    // but a panel is non-modal — the host focuses the panel when it owns
    // input (`panel.focused` reports it) and hands keys back to chat
    // otherwise, so a hardcoded `focused={true}` would fight the host and
    // swallow typing. `focusable` stays: the box is the host's landing
    // target when it focuses the panel, and the region boxes below move
    // that native focus onto whichever region is current.
    <box flexDirection="column" height="100%" padding={1} focusable={true}>
      <TabBar
        active={tab()}
        accent={accent}
        regionFocused={regionBoxFocused(region(), TAB_STRIP_REGION, panelFocused())}
        cursor={cursorTab()}
        onSelect={switchTab}
        onMove={moveTabCursor}
        onActivate={activateTabCursor}
      />
      {/* The content area region (decision 6): one `focusable` `Box` around
          whatever the active tab shows. The always-on border is transparent
          while the region isn't current (`focusedBorderColor` alone would
          force `border` on in the default white), so the box shows its
          accent outline only while the content area holds region focus —
          keeping the one-cell inset the border reserves at both times.
          `focused` moves native focus here with the region, except where
          `contentFocused` stands the box down for the list's input. This is
          the box that yields layout space first (default shrink): both
          sides of it — the strip above and the footer toggle below — hold
          their rows with `flexShrink={0}`, and what the content shows is a
          scroll region on every branch. */}
      <box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        borderColor="transparent"
        focusedBorderColor={accent}
        focusable={true}
        focused={contentBoxFocused()}
      >
        <Show
          when={tab() === "workflows"}
          fallback={
            <RunsTabContent
              store={props.store}
              panel={props.panel}
              selectedRunId={selectedRunId()}
              contentFocused={listInputFocused()}
              onSelectRun={setSelectedRunId}
              accent={accent}
              errorColor={errorColor}
            />
          }
        >
          {/* `focusable={false}`: `ScrollBoxRenderable` defaults focusable
              (`ScrollBox.d.ts`'s `defaultFocusable = true`) — left on, it
              grabs native keyboard focus and swallows up/down for its own
              scrolling before `WorkflowsTab`'s global-mode command layer
              ever sees them (confirmed live: the tree's own up/down/return
              commands never fired until this was set). `runs-tab.tsx` never
              hit this — it owns its own scrollbox and sits next to the
              filter input, which holds native focus while the list is the
              content region's focus holder. */}
          <scrollbox flexGrow={1} minHeight={0} scrollY border>
            <WorkflowsTab errorColor={errorColor} />
          </scrollbox>
        </Show>
      </box>
      <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
        <PresentationToggle panel={props.panel} accent={accent} />
        <ToggleTab
          active={true}
          width={6}
          rows={2}
          accent={accent}
          onPress={() => props.panel.close()}
        />
      </box>
    </box>
  );
}
