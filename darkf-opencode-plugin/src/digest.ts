import { foldJournal, type JournalDigest, stallWarning } from "@psimona/darkf";
import {
  buildRegistry,
  EXIT,
  isComposite,
  type RegistryEntry as PlanRegistryEntry,
  type StateDef,
  type WorkflowDef,
} from "@psimona/darkf/src/core/index.ts";

export interface PlanNode {
  id: string;
  kind: "agent" | "script" | "composite";
  children?: PlanNode[];
  active: boolean;
  isCurrentLeaf: boolean;
  visits: number;
}

export type SupervisorStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export interface SupervisorView {
  sessionID: string;
  status: SupervisorStatus;
  lastMessage?: string;
}

export interface PlanView {
  runId: string;
  /** Set instead of `root`/`current`/etc. when `buildRegistry` itself threw —
   *  the workflow definition is broken, not the run. See Error handling. */
  workflowError?: string;
  root: PlanNode[];
  current: JournalDigest["current"];
  crash: JournalDigest["crash"];
  stall: string | null;
  supervisor?: SupervisorView;
}

function activeIds(
  registry: Map<string, PlanRegistryEntry>,
  leafId: string | undefined,
): Set<string> {
  if (leafId === undefined) return new Set();
  const entry = registry.get(leafId);
  return entry ? new Set([leafId, ...entry.scopePath]) : new Set([leafId]);
}

function walk(
  states: Record<string, StateDef>,
  visits: Record<string, number>,
  active: Set<string>,
): PlanNode[] {
  return Object.entries(states).map(([id, def]) => {
    if (isComposite(def)) {
      return {
        id,
        kind: "composite",
        children: walk(def.states, visits, active),
        active: active.has(id),
        isCurrentLeaf: false,
        visits: visits[id] ?? 0,
      };
    }
    // A leaf id only ever enters `active` as the set's own leaf element
    // (`activeIds`'s `[leafId, ...entry.scopePath]`) — `scopePath` holds only
    // composite ancestor ids, never a leaf (`buildRegistry` only extends it
    // when recursing into a composite). So for a leaf, membership in
    // `active` already means "this is the current leaf," not just "an
    // ancestor of it."
    return {
      id,
      kind: def.type,
      active: active.has(id),
      isCurrentLeaf: active.has(id),
      visits: visits[id] ?? 0,
    };
  });
}

/**
 * The current leaf's id, or `undefined` when there's nothing to highlight:
 * no journal events yet (`current === null`), or the run already finished
 * successfully (`current.state === EXIT` — the run's own end marker, not a
 * leaf; see darkf-engine/src/run.ts's EXIT emit). Checked before any
 * registry lookup — `EXIT` has no registry entry.
 */
function currentLeafId(current: JournalDigest["current"]): string | undefined {
  if (current === null) return undefined;
  if (current.state === EXIT) return undefined;
  return current.state;
}

/**
 * `workflow` is `undefined` when the run's registry entry has no
 * `workflowDir` (written before that field existed, or by some future
 * caller that doesn't set it) — there's no `WorkflowDef` to load at all, not
 * even one to try `buildRegistry` on. That and a `buildRegistry` throw (a
 * broken workflow definition) degrade the same way: no graph, but the
 * darkf-only fields (`current`/`crash`/`stall`) are still computed from the
 * journal, which never needed the workflow object in the first place — see
 * Error handling.
 */
export function buildPlanView(
  runId: string,
  workflow: WorkflowDef | undefined,
  journalText: string,
  supervisor?: SupervisorView,
): PlanView {
  const digest = foldJournal(journalText);
  const noGraph = (workflowError?: string): PlanView => ({
    runId,
    workflowError,
    root: [],
    current: digest.current,
    crash: digest.crash,
    stall: stallWarning(digest),
    supervisor,
  });

  if (workflow === undefined) return noGraph(undefined);

  let registry: Map<string, PlanRegistryEntry>;
  try {
    registry = buildRegistry(workflow);
  } catch (err) {
    return noGraph(err instanceof Error ? err.message : String(err));
  }

  const leafId = currentLeafId(digest.current);
  const active = activeIds(registry, leafId);

  return {
    runId,
    root: walk(workflow.states, digest.visits, active),
    current: digest.current,
    crash: digest.crash,
    stall: stallWarning(digest),
    supervisor,
  };
}
