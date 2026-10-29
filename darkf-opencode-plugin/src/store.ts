import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { journalPathFor, type RegistryEntry as RunEntry, readJournalText } from "@psimona/darkf";
import type { WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { createSignal } from "solid-js";
import { buildPlanView, type PlanView } from "./digest.ts";
import {
  bindingFor,
  ensureBinding,
  forgetUnless,
  liveRunEntries,
  type RunBinding,
  unboundOf,
} from "./locate.ts";
import { supervisorViewFor } from "./supervisor.ts";

const POLL_MS = 1000;

// Cached by `workflowDir` for the plugin's lifetime — workflow modules don't
// change at runtime, and re-importing on every poll tick would be wasted
// work. `null` means "tried once, failed" (missing file, bad module shape,
// etc.) so a broken workflowDir isn't retried every tick either; it degrades
// the same way an absent `workflowDir` does (see digest.ts).
const workflowCache = new Map<string, WorkflowDef | null>();

async function loadWorkflowCached(
  workflowDir: string | undefined,
): Promise<WorkflowDef | undefined> {
  if (workflowDir === undefined) return undefined;
  const cached = workflowCache.get(workflowDir);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const url = pathToFileURL(resolve(workflowDir, "workflow.ts")).href;
    const mod = (await import(url)) as { workflow?: WorkflowDef };
    workflowCache.set(workflowDir, mod.workflow ?? null);
    return mod.workflow;
  } catch {
    workflowCache.set(workflowDir, null);
    return undefined;
  }
}

function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current;
  if (route.name !== "session") return undefined;
  // Validated defensively rather than narrowed directly: `TuiRouteCurrent`'s
  // trailing catch-all variant (`{ name: string; params?: Record<string,
  // unknown> }`) shares `name`'s primitive type with the `"session"` variant,
  // so TS keeps both in play after the `===` check and widens `params`
  // accordingly — a known discriminated-union narrowing gap, not a real
  // runtime ambiguity (a `"session"` route's `params.sessionID` is always a
  // string per the TUI plugin spec).
  const sessionID = (route.params as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

export interface LiveStore {
  views: () => ReadonlyMap<string, PlanView>;
  unboundCandidates: () => RunEntry[];
  bindingFor: (runId: string) => RunBinding | undefined;
}

/**
 * Starts the one poll/watch loop this plugin runs, and wires its own
 * teardown to `api.lifecycle.onDispose`. `onNewRun` fires once per run the
 * instant it's first observed — including one with no session bound (the
 * `home`-screen case) — see spec: Auto-open and the toggle. It never fires
 * again for the same `runId`.
 */
export function startStore(
  api: TuiPluginApi,
  directory: () => string,
  onNewRun: (binding: RunBinding) => void,
): LiveStore {
  const [views, setViews] = createSignal<ReadonlyMap<string, PlanView>>(new Map());
  const [unbound, setUnbound] = createSignal<RunEntry[]>([]);
  const watchers = new Map<string, FSWatcher>();

  function ensureWatcher(entry: RunEntry): void {
    if (watchers.has(entry.runId)) return;
    try {
      const watcher = watch(journalPathFor(entry), { persistent: false }, () => {
        void refresh();
      });
      watchers.set(entry.runId, watcher);
    } catch {
      // Journal file may not exist yet (run just registered, hasn't written
      // its first event) — retried next tick via this same `ensureWatcher`
      // call until it succeeds; the interval fallback below still converges
      // in the meantime.
    }
  }

  function dropStaleWatchers(liveIds: ReadonlySet<string>): void {
    for (const [runId, watcher] of watchers) {
      if (liveIds.has(runId)) continue;
      watcher.close();
      watchers.delete(runId);
    }
  }

  async function refresh(): Promise<void> {
    const entries = liveRunEntries(directory());
    const liveIds = new Set(entries.map((e) => e.runId));
    forgetUnless(liveIds);

    const sessionID = currentSessionID(api);
    for (const entry of entries) {
      const { binding, isNewlyBound } = ensureBinding(entry, sessionID);
      if (isNewlyBound) onNewRun(binding);
    }

    const next = new Map<string, PlanView>();
    for (const entry of entries) {
      const workflow = await loadWorkflowCached(entry.workflowDir);
      const text = readJournalText(journalPathFor(entry));
      const supervisor = supervisorViewFor(api, bindingFor(entry.runId)?.supervisorSessionID);
      next.set(entry.runId, buildPlanView(entry.runId, workflow, text, supervisor));
      ensureWatcher(entry);
    }

    setViews(next);
    setUnbound(unboundOf(entries));
    dropStaleWatchers(liveIds);
  }

  void refresh();
  const interval = setInterval(() => void refresh(), POLL_MS);
  api.lifecycle.onDispose(() => {
    clearInterval(interval);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  });

  return { views, unboundCandidates: unbound, bindingFor };
}
