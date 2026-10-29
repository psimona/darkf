import {
  classifyTerminal,
  isPidAlive,
  journalPathFor,
  listEntries,
  projectRoot,
  type RegistryEntry as RunEntry,
  readJournalText,
} from "@psimona/darkf";

/**
 * Which session is "the supervisor" for a run, bound once at first
 * detection (see spec: Binding a run to its supervisor session) and never
 * rebound. In-memory only — a plugin reload losing bindings is an
 * acceptable, cheap degradation (this plugin is observational by design;
 * see Non-goals).
 */
export interface RunBinding {
  runId: string;
  rootDir: string;
  supervisorSessionID?: string;
}

const bindings = new Map<string, RunBinding>();

/** All registry entries this project root currently believes are live,
 *  cross-checked against the journal's own terminal marker the same
 *  defensive way `darkf-cli`'s own `resolveRun` does — a cached "running"
 *  status is never trusted alone (see darkf-cli/src/registry.ts). */
export function liveRunEntries(directory: string): RunEntry[] {
  const root = projectRoot(directory);
  return listEntries(root).filter((entry) => {
    const text = readJournalText(journalPathFor(entry));
    return classifyTerminal(text, isPidAlive(entry.pid)) === "running";
  });
}

export function bindingFor(runId: string): RunBinding | undefined {
  return bindings.get(runId);
}

/** Binds a newly-seen run to `currentSessionID` (the session route current
 *  at the instant this is first called for this `runId`) if it isn't
 *  already bound. Returns whether this call is the one that created the
 *  binding — callers use that to decide whether to auto-open the full
 *  route (see spec: Auto-open and the toggle). */
export function ensureBinding(
  entry: RunEntry,
  currentSessionID: string | undefined,
): { binding: RunBinding; isNewlyBound: boolean } {
  const existing = bindings.get(entry.runId);
  if (existing) return { binding: existing, isNewlyBound: false };
  const binding: RunBinding = {
    runId: entry.runId,
    rootDir: entry.rootDir,
    supervisorSessionID: currentSessionID,
  };
  bindings.set(entry.runId, binding);
  return { binding, isNewlyBound: true };
}

/** Drops bindings for runs that are no longer live, so a finished run's
 *  binding doesn't linger forever. */
export function forgetUnless(liveRunIds: ReadonlySet<string>): void {
  for (const runId of bindings.keys()) {
    if (!liveRunIds.has(runId)) bindings.delete(runId);
  }
}

export function unboundOf(entries: RunEntry[]): RunEntry[] {
  return entries.filter((e) => !bindings.has(e.runId));
}
