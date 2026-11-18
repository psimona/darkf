/** @jsxImportSource @opentui/solid */

import { basename } from "node:path";
import { createTextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";
import type { RegistryEntry as RunEntry } from "@psimona/darkf";
import { createSignal, For, Show } from "solid-js";
import { type PickerEntry, pickerOrder } from "./locate.ts";
import type { LiveStore } from "./store.ts";

// The `runs` tab's list content (docs/specs/opencode-overlay-tabs/spec.md):
// every run — date + title — with its own inline filter input, replacing the
// stacked `pickRun` native select this overlay used to open. The data source
// is the store's `pickerCandidates`: `listEntries` unfiltered, live and past
// runs alike (docs/specs/opencode-search-candidates/spec.md), so the search
// the user asked for actually finds history. Selecting a run into the detail
// view is the tab's own tab-local state (r6/r7) and lives with the detail
// view (`run-detail.tsx`'s `RunsTabContent`), not here — this module is the
// list only; rows just report clicks through `onSelect`.

const DIM = createTextAttributes({ dim: true });

const FILTER_PLACEHOLDER = "search (title or run id)";

/** The spinner's glyph set (r14): braille dots, one frame per store poll
 *  tick. Small on purpose — the tick is 1s, so this set loops in 10s. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The glyph for one poll tick (r14): `tick` is the store's monotonic 1s
 *  counter, so consecutive ticks walk the set in order, wrapping at the
 *  end. Every active row reads the same counter, so they spin in step —
 *  the frame comes from the existing poll loop, never a timer of its own. */
export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

/** The run's display title (r12): the free-text `message` passed at
 *  `darkf run <dir> [message]` time when set, else the workflow directory's
 *  basename, else the bare `runId`. Same degrade-gracefully chain as
 *  `supervisorViewFor` — every entry has a title, just not always a human
 *  one. A blank `message`/`workflowDir` counts as unset (an empty string is
 *  no title), so each step falls through to the next. */
export function runTitle(entry: RunEntry): string {
  if (entry.message) return entry.message;
  if (entry.workflowDir) return basename(entry.workflowDir);
  return entry.runId;
}

/** The row's date half (r5): the run's start time, local-time
 *  `YYYY-MM-DD HH:mm`. Fixed shape, no locale dependency — the same string
 *  on every host, newest-first readable at a glance. */
export function formatDate(startedAt: number): string {
  const at = new Date(startedAt);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    ` ${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** One candidate against the filter (r13): the query matches the title this
 *  row displays — whichever of `message`/workflow name/`runId` resolved —
 *  and always the `runId` too, so a run stays findable by id even when a
 *  message or workflow name is shown instead. Case-insensitive substring; a
 *  blank query matches everything. */
export function runMatches(candidate: PickerEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    runTitle(candidate.entry).toLowerCase().includes(q) ||
    candidate.entry.runId.toLowerCase().includes(q)
  );
}

/** The list's full contents: the unfiltered candidates, active-first then
 *  most-recent-first (`pickerOrder` — r8's `(isActive, startedAt) desc`,
 *  already tested in locate.test.ts), narrowed by the filter. Everything
 *  renders — no paging, no windowing (r15): the scrollbox is what makes an
 *  unbounded history viewable, so no slice ever hides a row. Returns a new
 *  array; the store's signal value is untouched. */
export function runRows(candidates: PickerEntry[], query: string): PickerEntry[] {
  return pickerOrder(candidates).filter((candidate) => runMatches(candidate, query));
}

/** The `runs` tab's default content (r5): the filter input, then every run
 *  — spinner glyph on active rows (r14), `○` not — as `date title` rows in
 *  a scrollbox of its own. The input must stay put while the list scrolls,
 *  so the component owns its scroll region rather than living inside the
 *  tab-container's shared one (the `workflows` tab keeps that one).
 *  Active rows carry the ordering too (r8): `pickerOrder` puts them on top
 *  of the list. Reading the store's `tick` here is what animates the rows —
 *  each 1s poll advances the counter, and the active-row glyphs move.
 *  Clicking a row reports it through `onSelect`; the caller — the tab-local
 *  selection in `run-detail.tsx` — decides what that shows (r6). */
export function RunsTab(props: {
  store: LiveStore;
  onSelect: (runId: string) => void;
}): JSX.Element {
  const [filter, setFilter] = createSignal("");
  const rows = () => runRows(props.store.pickerCandidates(), filter());
  const anyRuns = () => props.store.pickerCandidates().length > 0;

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <input placeholder={FILTER_PLACEHOLDER} onInput={setFilter} />
      <scrollbox flexGrow={1} minHeight={0} scrollY border>
        <Show
          when={rows().length > 0}
          fallback={
            <text attributes={DIM}>{anyRuns() ? "no runs match the filter" : "no runs yet"}</text>
          }
        >
          <For each={rows()}>
            {(candidate) => (
              <box flexDirection="row" onMouseDown={() => props.onSelect(candidate.entry.runId)}>
                <text attributes={DIM}>
                  {candidate.active ? spinnerFrame(props.store.tick()) : "○"}{" "}
                  {formatDate(candidate.entry.startedAt)}
                </text>
                <text> {runTitle(candidate.entry)}</text>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
