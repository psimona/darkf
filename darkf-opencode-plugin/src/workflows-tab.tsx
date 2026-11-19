/** @jsxImportSource @opentui/solid */

import { dirname, join, resolve } from "node:path";
import { usePlugin } from "@opencode/plugin/tui";
import { createTextAttributes, type RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import { listWorkflows, type WorkflowListing } from "@psimona/darkf";
import { createMemo, createSignal, For, Show } from "solid-js";
import { loadWorkflowCached } from "./store.ts";
import {
  buildWorkflowGraph,
  type WorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowGraphTarget,
} from "./workflow-graph.ts";

// The `workflows` tab's content (docs/specs/opencode-overlay-tabs/spec.md):
// a catalog of workflow *definitions*, not runs — one collapsed row per
// workflow, expanding to the full static state graph (every node, its
// outgoing edges, composites nested with their entry state). Nothing here
// reads a run: no store, no runId, no journal, no active highlight — this
// tab renders identically with or without an active run. Selecting an edge
// is UI focus only (r10): the cursor/expand-focus moves to the target node
// and nothing else — a catalog view never starts a run.

const TYPE_ICON: Record<"agent" | "script", string> = { agent: "🤖", script: "⚙️" };
const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

// Anchor for the built-in workflows root: the darkf package this module
// already imports, resolved from this module's own directory. This is the
// same package root the CLI's private `selfRoot()` computes as the second
// `listWorkflows` scan root (darkf/src/cli/index.ts) — derived from the
// package's public entry instead of re-deriving the CLI's
// `dirname(cli/index.ts)/../..` arithmetic, so it follows wherever the
// plugin's `@psimona/darkf` resolves (checkout copy, symlink, or tarball).
const DARKF_PACKAGE_ROOT = dirname(
  dirname(Bun.resolveSync("@psimona/darkf/src/exports.ts", import.meta.dir)),
);

/** The directory a listed workflow loads from, mirroring `listWorkflows`'s
 *  two scan roots (r9): workspace entries live under `<cwd>/darkf/<name>`,
 *  built-in under the darkf package's `workflows/<name>`. Path composition
 *  only — the scan itself stays in `listWorkflows`; a listed name is
 *  guaranteed a `workflow.ts` at this path by the scan that produced it. */
export function workflowDirFor(listing: WorkflowListing): string {
  return listing.source === "workspace"
    ? resolve(process.cwd(), "darkf", listing.name)
    : resolve(DARKF_PACKAGE_ROOT, "workflows", listing.name);
}

export interface CatalogEntry {
  /** Globally unique row id, `<source>/<name>` — the same name can be listed
   *  from both roots (a workspace override of a built-in). Every path below
   *  prefixes this key, so one workflow's node paths can't collide with
   *  another's. */
  key: string;
  listing: WorkflowListing;
  dir: string;
}

/** One `listWorkflows()` pass, resolved to loadable entries. Once per mount:
 *  definitions are static while the overlay is open (same assumption as
 *  store.ts's workflow cache), and the scan is a two-root readdir. */
export function catalogEntries(): CatalogEntry[] {
  return listWorkflows().map((listing) => ({
    key: `${listing.source}/${listing.name}`,
    listing,
    dir: workflowDirFor(listing),
  }));
}

/** Node id → tree path for one loaded graph — `edgeFocus`'s lookup. Paths
 *  follow `PlanGraph`'s scheme (`parent/child`, composites included), so one
 *  string both addresses a row for the cursor and names it in the open set.
 *  State ids are unique per definition (`buildRegistry` resolves them
 *  globally); a duplicate would keep its first occurrence's path, walk
 *  order. */
export function buildPathIndex(
  nodes: WorkflowGraphNode[],
  prefix = "",
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    const path = prefix ? `${prefix}/${node.id}` : node.id;
    index.set(node.id, path);
    if (node.children) {
      for (const [id, child] of buildPathIndex(node.children, path)) index.set(id, child);
    }
  }
  return index;
}

/** The ancestor paths that must be open for `path`'s row to render — root
 *  first, nearest last. Takes a tree path only (`parent/child`); the entry
 *  key is `edgeFocus`'s job, since keys contain slashes of their own. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** Where selecting an edge lands (r10): the cursor moves to the target
 *  node's row and every composite above it opens, so the focused row is
 *  actually visible. Pure UI focus — no run is started, nothing dispatches. */
export interface EdgeFocus {
  cursor: string;
  expand: string[];
}

/** `undefined` = nothing to focus, so the selection is a no-op: the target
 *  is a terminal sentinel (done/failed — no node row exists) or a state id
 *  the definition doesn't resolve (targets are recorded as written — broken
 *  definitions still render, they just don't steer the cursor). */
export function edgeFocus(
  index: ReadonlyMap<string, string>,
  key: string,
  target: WorkflowGraphTarget,
): EdgeFocus | undefined {
  if (target.kind !== "state") return undefined;
  const nodePath = index.get(target.id);
  if (nodePath === undefined) return undefined;
  // Ancestors come from the key-free tree path — keys carry slashes of
  // their own (`built-in/dev-loop`), so splitting the joined cursor path
  // would mistake the key's segments for composites. The key is prepended
  // whole: once for the entry row, once per ancestor composite.
  return {
    cursor: `${key}/${nodePath}`,
    expand: [key, ...ancestorsOf(nodePath).map((ancestor) => `${key}/${ancestor}`)],
  };
}

/** A workflow's own collapsed row — toggling loads it; the tree underneath
 *  is whatever `collectRows` adds once loaded and open. */
export interface EntryRow {
  kind: "entry";
  path: string;
  entry: CatalogEntry;
}

/** One state row — leaf or composite. Leaves are expandable too, now that
 *  edges default to collapsed: `node.edges.length > 0` is what makes a leaf
 *  togglable, same condition `collectNodeRows` uses to decide whether its
 *  edges contribute rows at all. */
export interface NodeRow {
  kind: "node";
  path: string;
  entry: CatalogEntry;
  node: WorkflowGraphNode;
  branch: string;
  isInitial: boolean;
}

/** One outgoing edge, only present while its leaf is open. `index` makes
 *  the path unique among a leaf's own edges — edges aren't addressed by
 *  `buildPathIndex` (only state ids are), so there's no id to reuse. */
export interface EdgeRow {
  kind: "edge";
  path: string;
  entry: CatalogEntry;
  edge: WorkflowGraphEdge;
  branch: string;
}

export type Row = EntryRow | NodeRow | EdgeRow;

/** A state's own row plus whatever's visible underneath it: a composite's
 *  children while open, a leaf's edges while open (edges default closed —
 *  `isOpen` gates both the same way `toggleOpen` already gates composite
 *  children). Mirrors the old recursive `renderNode` walk, minus the JSX —
 *  one list both renders and, via its order, drives keyboard up/down. */
function collectNodeRows(
  entry: CatalogEntry,
  node: WorkflowGraphNode,
  path: string,
  prefix: string,
  isLast: boolean,
  isInitial: boolean,
  isOpen: (path: string) => boolean,
): Row[] {
  const branch = prefix + (isLast ? "└── " : "├── ");
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  const row: NodeRow = { kind: "node", path, entry, node, branch, isInitial };
  if (node.kind === "composite") {
    const children = node.children ?? [];
    if (!isOpen(path)) return [row];
    return [
      row,
      ...children.flatMap((child, i) =>
        collectNodeRows(
          entry,
          child,
          `${path}/${child.id}`,
          childPrefix,
          i === children.length - 1,
          child.id === node.initial,
          isOpen,
        ),
      ),
    ];
  }
  if (node.edges.length === 0 || !isOpen(path)) return [row];
  const edgeRows: EdgeRow[] = node.edges.map((edge, i) => ({
    kind: "edge",
    path: `${path}/edge-${i}`,
    entry,
    edge,
    branch: childPrefix,
  }));
  return [row, ...edgeRows];
}

/** The tab's whole navigable surface, one flat list spanning every catalog
 *  entry in order — a single keyboard cursor can walk from one workflow's
 *  nodes straight into the next entry's row. Loading/error states aren't
 *  rows here (nothing to select while an entry is loading or broken); the
 *  entry row's own render checks those same `graphFor`/error lookups to
 *  show the decoration, same as before this list existed. */
export function collectRows(
  catalog: readonly CatalogEntry[],
  isOpen: (path: string) => boolean,
  graphFor: (key: string) => WorkflowGraph | undefined,
): Row[] {
  return catalog.flatMap((entry): Row[] => {
    const entryRow: EntryRow = { kind: "entry", path: entry.key, entry };
    if (!isOpen(entry.key)) return [entryRow];
    const graph = graphFor(entry.key);
    if (!graph) return [entryRow];
    return [
      entryRow,
      ...graph.nodes.flatMap((node, i) =>
        collectNodeRows(
          entry,
          node,
          `${entry.key}/${node.id}`,
          "  ",
          i === graph.nodes.length - 1,
          node.id === graph.initial,
          isOpen,
        ),
      ),
    ];
  });
}

/** Keeps a cursor index inside `[0, length - 1]`, or `0` for an empty list —
 *  same clamp `runs-tab.tsx`'s own cursor uses, duplicated rather than
 *  imported across tabs that are otherwise independent of each other. */
function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

type LoadedEntry =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "loaded"; graph: WorkflowGraph; index: ReadonlyMap<string, string> };

/** The workflows tab's content (r2): one collapsed row per listed workflow;
 *  expanding an entry loads it — the plugin's own `import()` per entry
 *  (r9), through store.ts's cached loader — and renders the full static
 *  tree: every node, its outgoing edges (`on` events, then the `next`
 *  fallback), composites nested with their entry state marked. Selecting an
 *  edge row moves the cursor/expand-focus to the target node and nothing
 *  else (r10). The catalog is scan-once per mount; the accent/error colors
 *  follow the same prop convention as `PlanGraph`/`TaskPane`, so the
 *  tab-container passes them straight through. */
export function WorkflowsTab(props: {
  accent: RGBA;
  errorColor: RGBA;
  /** Defaults to a fresh `catalogEntries()` scan. */
  catalog?: CatalogEntry[];
}): JSX.Element {
  const context = usePlugin();
  const catalog = props.catalog ?? catalogEntries();
  const [entries, setEntries] = createSignal<ReadonlyMap<string, LoadedEntry>>(new Map());
  // Every open path in one set — entry keys and node paths share one global
  // path space (`<key>/<parent>/<child>`), so one set and one cursor serve
  // the whole tab. Same manual-open shape `OverlayContent` uses for
  // `PlanGraph`; nothing persists across a close/reopen.
  const [manualOpen, setManualOpen] = createSignal<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = createSignal<string | undefined>(undefined);

  const isOpen = (path: string) => manualOpen().has(path);
  const toggleOpen = (path: string): void => {
    setManualOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const openAll = (paths: string[]): void => {
    setManualOpen((prev) => {
      const next = new Set(prev);
      for (const path of paths) next.add(path);
      return next;
    });
  };

  // Lazy per entry: expanding is what loads — opening the overlay (this tab
  // is the no-active-run default) never executes a workflow module the user
  // didn't open. One attempt per entry, ever: a workflow.ts that fails to
  // import fails the same way every time (store.ts's loader already caches
  // both outcomes by dir). The loader reports `undefined` for any failure —
  // import error or module without a `workflow` export — so the message
  // names the file, not the cause; `darkf validate <dir>` gives the detail.
  const loadEntry = (entry: CatalogEntry): void => {
    if (entries().has(entry.key)) return;
    setEntries((prev) => new Map(prev).set(entry.key, { state: "loading" }));
    void loadWorkflowCached(entry.dir).then((def) => {
      if (def === undefined) {
        setEntries((prev) =>
          new Map(prev).set(entry.key, {
            state: "error",
            message: `cannot load workflow from ${join(entry.dir, "workflow.ts")}`,
          }),
        );
        return;
      }
      const graph = buildWorkflowGraph(def);
      setEntries((prev) =>
        new Map(prev).set(entry.key, {
          state: "loaded",
          graph,
          index: buildPathIndex(graph.nodes),
        }),
      );
    });
  };

  const errorMessage = (key: string): string | undefined => {
    const loaded = entries().get(key);
    return loaded?.state === "error" ? loaded.message : undefined;
  };
  const loadedGraph = (key: string): WorkflowGraph | undefined => {
    const loaded = entries().get(key);
    return loaded?.state === "loaded" ? loaded.graph : undefined;
  };

  const toggleEntry = (entry: CatalogEntry): void => {
    toggleOpen(entry.key);
    setCursor(entry.key);
    if (isOpen(entry.key)) loadEntry(entry);
  };

  const selectEdge = (entry: CatalogEntry, edge: WorkflowGraphEdge): void => {
    const loaded = entries().get(entry.key);
    if (loaded?.state !== "loaded") return;
    const focus = edgeFocus(loaded.index, entry.key, edge.target);
    if (focus === undefined) return;
    openAll(focus.expand);
    setCursor(focus.cursor);
  };

  // Terminal sentinels render as the words, never as state ids — they name
  // the workflow's end, not a node (`done` dim: the normal exit; `failed`
  // in the error color, like every failure surface in this plugin).
  const targetLabel = (target: WorkflowGraphTarget): string =>
    target.kind === "state" ? target.id : target.kind;

  // The tab's whole flat, navigable surface (entries, nodes, and — once a
  // leaf is open — its edges), recomputed whenever an entry loads or
  // anything opens/closes. Keyboard up/down just walks this list; render
  // walks it too, so the two can never disagree about what's visible.
  const rows = createMemo(() => collectRows(catalog, isOpen, loadedGraph));

  const moveCursor = (delta: -1 | 1): void => {
    const list = rows();
    if (list.length === 0) return;
    const index = list.findIndex((row) => row.path === cursor());
    const next = index === -1 ? 0 : clampIndex(index + delta, list.length);
    setCursor(list[next].path);
  };

  // Toggles an entry/composite/open-able leaf, or follows an edge's focus
  // (r10) — the keyboard twin of each row kind's own `onMouseDown`.
  const activateRow = (row: Row): void => {
    if (row.kind === "entry") {
      toggleEntry(row.entry);
      return;
    }
    if (row.kind === "edge") {
      selectEdge(row.entry, row.edge);
      return;
    }
    if (row.node.kind === "composite" || row.node.edges.length > 0) toggleOpen(row.path);
  };

  // Up/down move the highlighted row across the whole flat tree; return
  // activates whatever's under the cursor. `mode: "global"`, not a custom
  // mode name — see overlay.tsx's `OverlayContent` doc comment for why a
  // custom mode never activates from inside `ui.dialog.show` content.
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "darkf.workflows.up",
        title: "Previous row",
        group: "darkf",
        bind: "up",
        run: () => moveCursor(-1),
      },
      {
        id: "darkf.workflows.down",
        title: "Next row",
        group: "darkf",
        bind: "down",
        run: () => moveCursor(1),
      },
      {
        // `space`, not `return` — `return` is globally claimed by the
        // host's default `input.submit` binding (opencode.ai/docs/
        // keybinds) and never reaches this layer when nothing editable
        // has focus (confirmed live: a toast on this command's `run`
        // never fired for `return`, while the same toast on `up`/`down`
        // fired every time). `runs-tab.tsx` only gets away with `return`
        // because that default is gated off specifically for a focused
        // single-line `<input>`; nothing here is an editor at all.
        id: "darkf.workflows.activate",
        title: "Toggle / follow",
        group: "darkf",
        bind: "space",
        run: () => {
          const row = rows().find((candidate) => candidate.path === cursor());
          if (row) activateRow(row);
        },
      },
    ],
    bindings: ["darkf.workflows.up", "darkf.workflows.down", "darkf.workflows.activate"],
  }));

  const renderRow = (row: Row): JSX.Element => {
    const focused = () => cursor() === row.path;

    if (row.kind === "entry") {
      const graph = () => loadedGraph(row.entry.key);
      const error = () => errorMessage(row.entry.key);
      const open = () => isOpen(row.entry.key);
      return (
        <box flexDirection="column">
          <box flexDirection="row" onMouseDown={() => toggleEntry(row.entry)}>
            <text fg={focused() ? props.accent : undefined} attributes={BOLD}>
              {open() ? "⏷ " : "▶ "}
              {row.entry.listing.name}
            </text>
            <text attributes={DIM}> ({row.entry.listing.source})</text>
          </box>
          {/* Three exclusive states — error, tree, or neither (= still
              loading). Plain `when` conditions, no fallback chaining: an
              error must not leave "loading…" up. */}
          <Show when={open() && error() !== undefined}>
            <text fg={props.errorColor}>
              {"  "}
              {error()}
            </text>
          </Show>
          <Show when={open() && error() === undefined && graph() === undefined}>
            <text attributes={DIM}>{"  "}loading…</text>
          </Show>
        </box>
      );
    }

    if (row.kind === "edge") {
      return (
        <box onMouseDown={() => selectEdge(row.entry, row.edge)}>
          <text
            fg={
              focused()
                ? props.accent
                : row.edge.target.kind === "failed"
                  ? props.errorColor
                  : undefined
            }
            attributes={focused() || row.edge.target.kind === "failed" ? undefined : DIM}
          >
            {row.branch}
            {row.edge.event ?? "next"} → {targetLabel(row.edge.target)}
          </text>
        </box>
      );
    }

    // Edges default collapsed (r2 follow-up): a leaf with outgoing edges
    // gets the same expand caret a composite already has, gated by the
    // same `isOpen`/`toggleOpen` the composite's children use — opening a
    // leaf reveals its edges instead of children.
    const node = row.node;
    const expandable = node.kind === "composite" || node.edges.length > 0;
    const expanded = () => isOpen(row.path);
    const caret = expandable ? (expanded() ? "⏷ " : "▶ ") : "";
    const icon = node.kind === "composite" ? "" : `${TYPE_ICON[node.kind]} `;
    return (
      <box
        flexDirection="row"
        onMouseDown={() => {
          if (expandable) toggleOpen(row.path);
          setCursor(row.path);
        }}
      >
        <text fg={focused() ? props.accent : undefined} attributes={BOLD}>
          {row.branch}
          {caret}
          {icon}
          {node.id}
        </text>
        <Show when={row.isInitial}>
          <text attributes={DIM}> (initial)</text>
        </Show>
      </box>
    );
  };

  return (
    <box flexDirection="column">
      <Show
        when={catalog.length > 0}
        fallback={
          <text attributes={DIM}>{"no workflows found — add darkf/<name>/workflow.ts"}</text>
        }
      >
        <For each={rows()}>{renderRow}</For>
      </Show>
    </box>
  );
}
