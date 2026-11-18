import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@opencode/plugin/tui";
import { journalPathFor, type RegistryEntry as RunEntry } from "@psimona/darkf";
import type { WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { createSignal } from "solid-js";
import { buildPlanView, buildTaskListView, type PlanView, type TaskListView } from "./digest.ts";
import {
  bindingFor,
  ensureBinding,
  forgetUnless,
  type PickerEntry,
  type RunBinding,
  runEntryStates,
  taskListPathFor,
} from "./locate.ts";
import { supervisorViewFor } from "./supervisor.ts";

const POLL_MS = 1000;

// Cached by `workflowDir` for the plugin's lifetime — workflow modules don't
// change at runtime, and re-importing on every poll tick would be wasted
// work. `null` means "tried once, failed" (missing file, bad module shape,
// etc.) so a broken workflowDir isn't retried every tick either; it degrades
// the same way an absent `workflowDir` does (see digest.ts). Shared with the
// workflows tab's catalog (workflows-tab.tsx), whose per-entry `import()`
// this is — one loader, one cache, both consumers.
const workflowCache = new Map<string, WorkflowDef | null>();

export async function loadWorkflowCached(
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

function currentSessionID(context: Plugin.Context): string | undefined {
  const route = context.ui.router.current();
  // A plugin route carries no session; only the session route does.
  return route.type === "session" ? route.sessionID : undefined;
}

export interface LiveStore {
  views: () => ReadonlyMap<string, PlanView>;
  taskViews: () => ReadonlyMap<string, TaskListView>;
  /** Every run this project's registry has ever recorded, active-first
   *  then most-recent-first — the picker's full data source, not just
   *  live-and-unbound ones (see docs/specs/opencode-search-candidates/
   *  spec.md). */
  pickerCandidates: () => PickerEntry[];
  bindingFor: (runId: string) => RunBinding | undefined;
  /** Monotonic poll counter: +1 once per `POLL_MS` interval tick, nothing
   *  else. The runs tab derives its spinner frame from it (r14) — the frame
   *  advances exactly when this loop ticks, so no second timer exists. */
  tick: () => number;
}

export interface LiveStoreHandle {
  store: LiveStore;
  /** Stops the poll/watch loop and closes its file watchers. The setup hook
   *  returns this so the host disposes it on plugin unload. */
  dispose: () => void;
}

/**
 * Starts the one poll/watch loop this plugin runs, and returns its teardown.
 * `onNewRun` fires once per run the instant it's first observed — including
 * one with no session bound (the `home`-screen case) — see spec: Auto-open
 * and the toggle. It never fires again for the same `runId`.
 */
export function startStore(
  context: Plugin.Context,
  directory: () => string,
  onNewRun: (binding: RunBinding) => void,
): LiveStoreHandle {
  const [views, setViews] = createSignal<ReadonlyMap<string, PlanView>>(new Map());
  const [taskViews, setTaskViews] = createSignal<ReadonlyMap<string, TaskListView>>(new Map());
  const [picker, setPicker] = createSignal<PickerEntry[]>([]);
  // The spinner's clock (r14): incremented only by the interval below, so
  // watcher-triggered `refresh()` calls can't spin the glyph faster than
  // one frame per second.
  const [tick, setTick] = createSignal(0);
  const watchers = new Map<string, FSWatcher>();
  const taskWatchers = new Map<string, FSWatcher>();
  // Past runs' journals never change, and there can be far more of them
  // than live runs — rebuilt only when the file's mtime moves, so a tick
  // costs a `stat` per historical run instead of a re-parse.
  const viewCache = new Map<string, { mtimeMs: number; view: PlanView }>();
  const taskCache = new Map<string, { mtimeMs: number; view: TaskListView }>();

  function mtimeOf(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return -1;
    }
  }

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

  // Same pattern as the journal watcher, one file over: tasks.json may not
  // exist yet (the run hasn't written its plan) — retried next tick until
  // the watch takes, with the 1s poll covering the gap.
  function ensureTaskWatcher(entry: RunEntry): void {
    if (taskWatchers.has(entry.runId)) return;
    try {
      const watcher = watch(taskListPathFor(entry), { persistent: false }, () => {
        void refresh();
      });
      taskWatchers.set(entry.runId, watcher);
    } catch {
      // retried next tick, same as the journal watcher
    }
  }

  function dropStaleWatchers(liveIds: ReadonlySet<string>): void {
    for (const [runId, watcher] of watchers) {
      if (liveIds.has(runId)) continue;
      watcher.close();
      watchers.delete(runId);
    }
    for (const [runId, watcher] of taskWatchers) {
      if (liveIds.has(runId)) continue;
      watcher.close();
      taskWatchers.delete(runId);
    }
  }

  /** `undefined` = tasks.json absent (the tasks tab hides) — distinct from
   *  `""`-ish contents, which count as invalid instead. */
  function readTaskListText(entry: RunEntry): string | undefined {
    try {
      return readFileSync(taskListPathFor(entry), "utf8");
    } catch {
      return undefined;
    }
  }

  async function refresh(): Promise<void> {
    const states = runEntryStates(directory());
    const entries = states.filter((s) => s.active).map((s) => s.entry);
    const liveIds = new Set(entries.map((e) => e.runId));
    forgetUnless(liveIds);

    const sessionID = currentSessionID(context);
    for (const entry of entries) {
      const { binding, isNewlyBound } = ensureBinding(entry, sessionID);
      if (isNewlyBound) onNewRun(binding);
    }

    const next = new Map<string, PlanView>();
    const nextTasks = new Map<string, TaskListView>();
    for (const state of states) {
      const entry = state.entry;
      // Live runs rebuild every tick (their journal is moving, and a
      // binding/supervisor may have appeared mid-run); past runs take the
      // memo unless the journal mtime moved, which for a finished run it
      // never does.
      const journalMtime = mtimeOf(journalPathFor(entry));
      const cachedView = viewCache.get(entry.runId);
      const view =
        state.active || cachedView === undefined || cachedView.mtimeMs !== journalMtime
          ? buildPlanView(
              entry.runId,
              await loadWorkflowCached(entry.workflowDir),
              state.journalText,
              supervisorViewFor(context.data, bindingFor(entry.runId)?.supervisorSessionID),
            )
          : cachedView.view;
      viewCache.set(entry.runId, { mtimeMs: journalMtime, view });
      next.set(entry.runId, view);

      const tasksMtime = mtimeOf(taskListPathFor(entry));
      const cachedTasks = taskCache.get(entry.runId);
      const taskView =
        state.active || cachedTasks === undefined || cachedTasks.mtimeMs !== tasksMtime
          ? buildTaskListView(entry.runId, readTaskListText(entry))
          : cachedTasks.view;
      taskCache.set(entry.runId, { mtimeMs: tasksMtime, view: taskView });
      nextTasks.set(entry.runId, taskView);

      if (state.active) {
        ensureWatcher(entry);
        ensureTaskWatcher(entry);
      }
    }

    setViews(next);
    setTaskViews(nextTasks);
    setPicker(states.map(({ entry, active }) => ({ entry, active })));
    dropStaleWatchers(liveIds);
  }

  void refresh();
  const interval = setInterval(() => {
    setTick((t) => t + 1);
    void refresh();
  }, POLL_MS);
  const dispose = (): void => {
    clearInterval(interval);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const watcher of taskWatchers.values()) watcher.close();
    taskWatchers.clear();
  };

  return {
    store: { views, taskViews, pickerCandidates: picker, bindingFor, tick },
    dispose,
  };
}
