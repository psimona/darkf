// Pure, synchronous structure of a WorkflowDef — no dispatch, no I/O, no
// async. Anything that just wants to know the graph's shape (a renderer, a
// validator, a future web viewer) depends on this, not on the execution loop.
import {
  DONE,
  FAILED,
  isComposite,
  type StateDef,
  type Target,
  type WorkflowDef,
} from "./types.ts";

export interface RegistryEntry {
  def: StateDef;
  scopePath: string[];
}

export class DuplicateStateIdError extends Error {
  constructor(public readonly id: string) {
    super(`Duplicate state id "${id}"`);
  }
}

export function buildRegistry(workflow: WorkflowDef): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>();

  function walk(states: Record<string, StateDef>, scopePath: string[]) {
    for (const [id, def] of Object.entries(states)) {
      if (registry.has(id)) {
        throw new DuplicateStateIdError(id);
      }
      registry.set(id, { def, scopePath });
      if (isComposite(def)) {
        walk(def.states, [...scopePath, id]);
      }
    }
  }

  walk(workflow.states, []);
  return registry;
}

/** Descend composites via their `initial` field, recursively, down to a leaf. */
export function enter(registry: Map<string, RegistryEntry>, id: string): string {
  let current = id;
  for (;;) {
    const entry = registry.get(current);
    if (!entry) return current; // unresolved — caller checks registry.has() and reports the crash
    if (!isComposite(entry.def)) return current;
    current = entry.def.initial;
  }
}

/** Exact event-name match against `on`, else the `next` fallback. No throw — undefined means no route. */
export function resolveTarget(def: StateDef, event: string | undefined): Target | undefined {
  if (isComposite(def)) return undefined;
  if (event !== undefined && def.on?.[event] !== undefined) return def.on[event];
  return def.next;
}

export type WorkflowValidationError =
  | { kind: "unresolved-target"; from: string | null; target: string }
  | { kind: "initial-cycle"; cycle: string[] }
  | { kind: "dead-end-leaf"; state: string };

/**
 * Eager, whole-graph structural check over an already-built registry — a
 * second, cheap pass over the same flat `Map` `buildRegistry` produced, not
 * a second tree-walk. Collects every problem found; never stops at the
 * first. `DONE`/`FAILED` are valid targets only for a leaf's `on`/`next`,
 * never for any `initial` (composite or top-level).
 */
export function validateWorkflow(
  registry: Map<string, RegistryEntry>,
  initial: string,
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!registry.has(initial)) {
    errors.push({ kind: "unresolved-target", from: null, target: initial });
  }

  for (const [id, entry] of registry) {
    if (isComposite(entry.def)) {
      if (!registry.has(entry.def.initial)) {
        errors.push({ kind: "unresolved-target", from: id, target: entry.def.initial });
      }
      continue;
    }

    const def = entry.def;
    const targets = Object.values(def.on ?? {});
    if (def.next !== undefined) targets.push(def.next);
    for (const target of targets) {
      if (target !== DONE && target !== FAILED && !registry.has(target)) {
        errors.push({ kind: "unresolved-target", from: id, target });
      }
    }

    if (Object.keys(def.on ?? {}).length === 0 && def.next === undefined) {
      errors.push({ kind: "dead-end-leaf", state: id });
    }
  }

  // Every composite in the registry is a chain-walk start, plus the
  // workflow's own top-level `initial` — a hazard sitting in the registry is
  // live regardless of how (or whether) a run happens to reach it.
  const chainStarts = [initial];
  for (const [id, entry] of registry) {
    if (isComposite(entry.def)) chainStarts.push(id);
  }

  const foundCycles: string[][] = [];
  for (const start of chainStarts) {
    const visited: string[] = [];
    let current = start;
    for (;;) {
      const seenAt = visited.indexOf(current);
      if (seenAt !== -1) {
        foundCycles.push(visited.slice(seenAt));
        break;
      }
      const entry = registry.get(current);
      if (!entry || !isComposite(entry.def)) break; // unresolved or leaf — not a cycle
      visited.push(current);
      current = entry.def.initial;
    }
  }

  // The same cycle is found once per feeder composite (A -> B -> A starting
  // from A, and again starting from B) — dedupe by rotating each to start at
  // its lexicographically smallest member before comparing.
  const seenCanonical = new Set<string>();
  for (const cycle of foundCycles) {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i]! < cycle[minIdx]!) minIdx = i;
    }
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    const key = rotated.join("\u0000");
    if (!seenCanonical.has(key)) {
      seenCanonical.add(key);
      errors.push({ kind: "initial-cycle", cycle: rotated });
    }
  }

  return errors;
}
