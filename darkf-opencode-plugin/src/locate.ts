import { join } from "node:path";
import {
  classifyTerminal,
  isPidAlive,
  journalPathFor,
  listEntries,
  projectRoot,
  type RegistryEntry as RunEntry,
  readJournalText,
  runArtifactsDir,
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

/** One registry entry plus the facts derived from it per poll tick: the
 *  same defensive terminal classification `darkf-cli`'s `resolveRun`
 *  applies (a cached "running" status is never trusted alone), and the
 *  journal text that classification already had to read — reused for
 *  view-building so each entry's journal is read once per tick, not
 *  twice. */
export interface RunEntryState {
  entry: RunEntry;
  /** `classifyTerminal(...) === "running"` — live, not merely cached-live. */
  active: boolean;
  journalText: string;
}

/** Every registry entry this project root has ever recorded — live and
 *  past — each classified. This is the plugin's single raw-read pass: the
 *  old `liveRunEntries` filtered the same `listEntries` output down to
 *  running-only, which excluded history from everything downstream of it
 *  (the picker's "search always displays empty"; see
 *  docs/specs/opencode-search-candidates/spec.md). */
export function runEntryStates(directory: string): RunEntryState[] {
  const root = projectRoot(directory);
  return listEntries(root).map((entry) => {
    const journalText = readJournalText(journalPathFor(entry));
    return {
      entry,
      active: classifyTerminal(journalText, isPidAlive(entry.pid)) === "running",
      journalText,
    };
  });
}

/** Display shape for the picker: what to show and how to mark it, with no
 *  journal payload carried into render land. */
export interface PickerEntry {
  entry: RunEntry;
  active: boolean;
}

export const PICKER_PAGE_SIZE = 50;

/** Active runs first, then most-recent-first within each group — an active
 *  run must never rank below a just-finished one just because its last
 *  event is older (see docs/specs/opencode-search-candidates/spec.md).
 *  Returns a new array; the input is untouched. */
export function pickerOrder(entries: PickerEntry[]): PickerEntry[] {
  return [...entries].sort((a, b) =>
    a.active !== b.active ? (a.active ? -1 : 1) : b.entry.startedAt - a.entry.startedAt,
  );
}

/** One page of an already-ordered list, plus whether a `→ more…` row
 *  applies. Only bounds display — `listEntries` still returns everything,
 *  so no historical data is lost, just how far back one page shows. */
export function pickerPage(
  ordered: PickerEntry[],
  page: number,
): { rows: PickerEntry[]; hasMore: boolean } {
  const start = page * PICKER_PAGE_SIZE;
  const rows = ordered.slice(start, start + PICKER_PAGE_SIZE);
  return { rows, hasMore: ordered.length > start + rows.length };
}

export function bindingFor(runId: string): RunBinding | undefined {
  return bindings.get(runId);
}

/** The run's canonical task list (Decisions: Colocation) — the run root
 *  joined to `tasks.json`, mirroring `journalPathFor`. The run's plan phase
 *  writes it there; nothing copies it. */
export function taskListPathFor(entry: RunEntry): string {
  return join(runArtifactsDir(entry.rootDir, entry.runId), "tasks.json");
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
