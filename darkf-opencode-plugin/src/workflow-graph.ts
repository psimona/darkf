import {
  DONE,
  FAILED,
  isComposite,
  type StateDef,
  type WorkflowDef,
} from "@psimona/darkf/src/core/index.ts";

// The workflows tab catalogs workflow *definitions*, not runs: each entry
// expands to the full static state graph — every node and its outgoing
// edges (docs/specs/opencode-overlay-tabs/spec.md). That edge data
// (`StateDef.on` / `StateDef.next`, `isComposite` / `DONE` / `FAILED`
// handling) is already walked once, by darkf-core's mermaid renderer
// (darkf/src/core/mermaid.ts) — but into a Mermaid string, which the TUI
// can't reuse. Same walk pattern, tree output instead. Unlike the
// run-scoped `PlanGraph`, nothing here reads a run: no journal, no visits,
// no active highlight — a definition renders the same tree every time.
//
// Targets are recorded as written; resolving them against the tree (and
// rejecting broken definitions) is `buildRegistry`'s job in the run-scoped
// view, not this walk's — a catalog renders whatever shape it was handed.

/** Where one outgoing edge leads. `state` is a plain state id, resolvable
 *  against the tree this walk produced. `done` and `failed` are the two
 *  terminal sentinels (`DONE`/`FAILED`) — the whole workflow completed, or
 *  the graph gave up. Neither names a state of its own, so an edge to one
 *  is a dead end in the tree; they are exactly the two cases mermaid.ts's
 *  `target()` special-cases (`[*]`, and `[-]`, which mermaid must rename
 *  to render at all). */
export type WorkflowGraphTarget =
  | { kind: "state"; id: string }
  | { kind: "done" }
  | { kind: "failed" };

/** One outgoing edge. `event` is the `on` key that selects the edge;
 *  `undefined` is the `next` fallback — taken when the leaf's result event
 *  matches no `on` key. Edges keep mermaid.ts's order: `on` events in
 *  declaration order, then the fallback. */
export interface WorkflowGraphEdge {
  event?: string;
  target: WorkflowGraphTarget;
}

/** One node of the static tree. Composites nest their states under
 *  `children` and carry the child entered first (`initial`) — the tree's
 *  counterpart of mermaid's `[*] --> initial` line. Leaves carry `edges`
 *  instead: composites own no transitions, the engine only ever executes
 *  leaves, so a composite's `edges` is always empty. */
export interface WorkflowGraphNode {
  id: string;
  kind: "agent" | "script" | "composite";
  /** Composite only: the id of the child state entered first. */
  initial?: string;
  /** Composite only: the states nested inside, declaration order. */
  children?: WorkflowGraphNode[];
  /** Outgoing edges — `on` events in declaration order, then the `next`
   *  fallback. Always empty for composites. */
  edges: WorkflowGraphEdge[];
}

export interface WorkflowGraph {
  /** The root-level state entered first. */
  initial: string;
  /** Every root-level state, declaration order. */
  nodes: WorkflowGraphNode[];
}

function target(t: string): WorkflowGraphTarget {
  if (t === DONE) return { kind: "done" };
  if (t === FAILED) return { kind: "failed" };
  return { kind: "state", id: t };
}

// Same shape as mermaid.ts's walk and digest.ts's `PlanNode` walk: one
// recursive pass over `Object.entries(states)`, composites recursing into
// their own `states`. Declaration order is preserved at every level — that
// is the order the catalog renders.
function walk(states: Record<string, StateDef>): WorkflowGraphNode[] {
  return Object.entries(states).map(([id, def]) => {
    if (isComposite(def)) {
      return {
        id,
        kind: "composite",
        initial: def.initial,
        children: walk(def.states),
        edges: [],
      };
    }
    const edges: WorkflowGraphEdge[] = Object.entries(def.on ?? {}).map(([event, dest]) => ({
      event,
      target: target(dest),
    }));
    if (def.next) edges.push({ target: target(def.next) });
    return { id, kind: def.type, edges };
  });
}

/** Walks a loaded `WorkflowDef`'s static state graph into the tree the
 *  workflows tab renders: every node, every outgoing edge (`on` events
 *  then the `next` fallback), composites nested with their `initial`. Pure
 *  — the caller loads the definition (its own `import()` per listed
 *  workflow), this only shapes it. */
export function buildWorkflowGraph(workflow: WorkflowDef): WorkflowGraph {
  return { initial: workflow.initial, nodes: walk(workflow.states) };
}
