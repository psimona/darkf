# opencode TUI plugin: plan + position visualizer

A spec for a new workspace package, `darkf-opencode-plugin`, that renders a
running darkf workflow — its plan (the state graph) and its position (the
current state, phase, and health) — live, inside opencode's own interactive
TUI, replacing the raw chat transcript as the way to watch a darkf run that
an agent kicked off. This is a repo-root concern: it adds a new workspace
member and a small, additive export surface to `darkf-cli`, so it lives at
`docs/specs/` rather than under any one existing subproject's own
`docs/specs/`.

## Problem

The motivating use case: an opencode agent (the **supervisor**) runs `darkf
start` or `darkf run` as a shell tool call, on the operator's behalf, from
inside an ordinary chat session. Today, watching that happen means reading
the supervisor's raw chat transcript — tool-call blocks, stdout dumps — which
says nothing about *darkf's* state (which workflow state is active, whether
it's healthy) without separately running `darkf status`/`darkf monitor` in
another terminal. The post-hoc `.darkf/last-run.mmd` mermaid file `darkf run`
writes only exists once the whole run is already over.

opencode has its own plugin system for exactly this class of problem: a
**TUI plugin** (distinct from its server-side "hooks" plugins) can register
live UI in several places — a persistent band, a per-session sidebar panel,
a full-screen route — all backed by plugin-owned state, confirmed against
the authoritative reference (`packages/opencode/specs/tui-plugins.md` in
opencode's own repo) and against a real precedent already on npm
(`opencode-tui-plugin-workflows`, which renders `"<workflow>: <phase>"` in
the sidebar from an MCP's tool calls). There is no darkf-side plumbing
missing to use it: `darkf-core` already computes the plan as a structured
graph (`buildRegistry`, `renderMermaid`, `renderActive`) and `darkf-cli`
already folds the live journal into a digest (`foldJournal`,
`classifyTerminal`, `stallWarning`). This spec is almost entirely
integration, not new mechanism.

## Goals

- From inside an interactive `opencode` session, see at a glance whether a
  darkf run is active in the current project, which state it's in, and
  whether it's healthy (running normally, stalled, crashed, orphaned) — even
  with no session focused.
- The moment an agent starts a darkf run from the session you're watching,
  get dropped into a dedicated plan view instead of continuing to read the
  raw tool-call transcript — and get back to that same chat with one keybind.
- While in that view, see not just darkf's state but **what the supervisor
  itself is doing** — busy/idle/retrying, and a short synopsis of its last
  message — so the plan view is a genuine replacement for watching the chat,
  not just an addition to it.
- On demand, see the whole workflow graph — including nested composite
  states — with the current state (and its composite ancestors) highlighted,
  each state's visit count, and, on crash, the reason.
- Work identically regardless of which agent runner (`opencode` or
  `claude-code`) dispatched any given node — the plugin reads the journal,
  which is runner-agnostic by construction.
- Zero behavioral change to `darkf-core`/`darkf-engine`/`darkf-cli`. Strictly
  a read-only observer: it is not in the loop of any workflow it displays and
  cannot affect one.

## Non-goals

- **Sub-node visibility — deferred, not impossible.** Watching what happens
  *inside* a single agent dispatch (tool calls, streamed text) is out of
  scope for this spec, but it may be cheaper than it first looked:
  third-party write-ups of `opencode run --format json` describe it as
  streaming NDJSON — one `step_start`/`tool_use`/`text`/`step_finish`/
  `error` event per line — as the agent works, though this is sourced from
  a blog summary, not opencode's own docs or source, and needs confirming
  firsthand before it's load-bearing for anything. darkf's
  `opencodeRunner` just doesn't read it that way today: it buffers the
  *entire* stream before parsing anything
  (`await new Response(proc.stdout).text()`,
  `darkf-cli/src/agents/opencode.ts:73`). Tapping it would mean teeing that
  stream to a sidecar file as it arrives — a real but separate change to
  `darkf-cli`, not this package, and one that would need an equivalent
  investigation for `claude-code.ts` (does `claude` have a comparable
  streaming flag? unverified) so one runner isn't visualized better than the
  other. Left as the obvious next spec once this one ships, not ruled out.
- **A Claude Code mod.** Claude Code's plugin sandbox has no filesystem/Node
  access, so an equivalent there needs a new `darkf status --json` CLI
  surface and shells out on a timer instead of importing darkf's functions
  directly. Different host, different constraints, separate spec if wanted.
- **Remote or cross-machine runs.** Only a run whose `.darkf/registry` and
  `.darkf/run/<runId>/journal.jsonl` are readable from the same filesystem
  opencode's TUI process runs on.
- **Any control surface.** No pause/resume/kill/retry from the plugin. v1 is
  strictly observational; this is also why it's safe for it to be wrong or
  stale without consequence beyond a misleading display.
- **Precise supervisor-session binding.** See **Design overview — Binding a
  run to its supervisor session** — v1 uses a cheap heuristic with a known
  race window, by deliberate choice, not oversight.
- **Publishing as an installable package.** Ships first as a local file
  plugin referenced by path in the operator's own `tui.json` (explicitly
  supported by the TUI plugin spec: "Local file plugins are configured
  directly in `tui.json`"). Publishing to npm, if ever wanted, is a later,
  independent step — nothing in the design below is npm-shaped-only.

## Design overview

### Why a TUI plugin, not darkf growing its own terminal UI

`PHILOSOPHY.md`'s "Mermaid is a render target, never a parsed input" and "the
journal is the durable record" both already say what this plugin must be:
a presentation layer over darkf's existing truth, generated on demand, never
a second source of state. Building darkf its own standalone terminal UI
would duplicate opencode's rendering stack (`@opentui/core`) for no reason
when the operator is already sitting inside opencode's TUI for the
underlying coding work; riding opencode's existing plugin surface is strictly
less code and puts the visualizer exactly where it's useful — next to the
session actually doing the work.

### Three tiers, not one

The slot list in `tui-plugins.md` makes a distinction worth taking
seriously: `sidebar_content` takes a `{ session_id }` prop and sits
alongside the other per-session built-ins (`internal:sidebar-todo`,
`sidebar-mcp`, `sidebar-lsp`) — it only makes sense while a session is
focused. A darkf run is not a property of any session; it's a property of
the directory, running whether or not a session is open. `app_bottom`, by
contrast, "is rendered in normal layout flow below the active route" —
visible under any route, home or session. That split maps directly onto
three tiers, from least to most intrusive:

1. **`app_bottom` — compact, always.** One line, visible regardless of what
   screen you're on: whether any darkf run is live, and the coarsest
   possible state. Replaces nothing; just ambient awareness.
2. **`sidebar_content` — detailed, per session.** Whenever a session is
   focused, a richer (but still narrow-column) view: the workflow graph as a
   compact vertical list (no wide nesting, indentation only), current state
   highlighted, visit counts. Shows the run bound to *that* session if one
   exists (see binding below) — coexists with the chat, doesn't replace it.
3. **The full-screen route — zoomed, exclusive, auto-opened.** The same
   graph with more room, plus the supervisor status assessment (below).
   Opened automatically the moment a run starts in the session you're
   watching, replacing the chat view entirely; one keybind toggles back to
   that exact chat and forth again.

### Binding a run to its supervisor session

The full-screen route's auto-open and its supervisor-status panel both need
to know *which* session is "the supervisor" for a given run. There's a
precise way to do this (a server-side `tool.execute.before` hook recording
`{sessionID, cwd, timestamp}` for every Bash call matching `darkf (start|run)`,
matched against new registry entries by timestamp/cwd proximity) and a cheap
way (just look at `api.route.current` at the instant the plugin's poll first
notices a new registry entry; if it's a session route, bind that
`sessionID` to the run for its lifetime).

**v1 uses the cheap heuristic, by deliberate choice.** It's right in the
overwhelmingly common case — you're watching the chat when you ask it to run
something — and wrong only if you switch away between the run starting and
the next poll tick, in which case the run just shows up unbound (sidebar/full
-view degrade to darkf-only, no supervisor panel, no auto-open target).
Given this plugin is explicitly observational and safe to be wrong (see
Non-goals), that's an acceptable failure mode, not a bug to design around
up front. The precise two-plugin version is noted as a non-goal above and is
the first thing to build if the race turns out to matter in practice.

```ts
interface RunBinding {
  runId: string;
  rootDir: string;
  supervisorSessionID?: string; // bound once, at first detection; never rebound
}
```

Kept as in-memory module state (a solid-js signal map keyed by `runId`), not
persisted — a plugin reload losing bindings is an acceptable, cheap
degradation, consistent with "safe to be wrong."

### Auto-open and the toggle

When a poll first observes a new live run (a registry entry with no
existing `RunBinding`):

- If `api.route.current` at that instant is a session route, bind its
  `sessionID` and `api.route.navigate("darkf-plan", { runId })` immediately
  — this is the "nicer UI instead of raw chat" moment.
- If it's `home` (or anything else), there's no chat to replace and no
  session to bind — open the full route anyway (darkf-only; the supervisor
  panel stays empty until/unless a session later gets bound to this run).

The toggle keybind flips between the full route and
`api.route.navigate("session", { sessionID: boundSessionID })` using exactly
the `sessionID` captured at bind time — no separate "last route" tracker
needed, it's the same state the binding above already holds. With no bound
session, toggle-back goes to `home`.

Both the route's render and its mode-push follow the pattern the TUI plugin
spec's own example uses for a full-screen plugin route: `api.mode.push(...)`
while the route is open, with the toggle binding scoped to that mode (plus a
base-mode binding to re-enter from anywhere a run is bound).

### Multiple live runs

`resolveRun` can report `"ambiguous"` — today's CLI just refuses and asks for
`--run`. The per-session binding above mostly dissolves this: `sidebar_content`
is already scoped to "the run bound to *this* session," so two runs bound to
two different sessions are never ambiguous to either sidebar. `app_bottom`,
with no session scope, shows a count ("2 darkf runs active") rather than
picking one. The only place ambiguity still bites is opening the full route
from a session (or `home`) with **no bound run and more than one
unbound candidate** — there, `api.ui.DialogSelect` lists each candidate
(`runId`, `rootDir`, current state) for an explicit pick, rather than
silently guessing "most recent."

### New workspace package: `darkf-opencode-plugin`

Added to the root `package.json`'s `workspaces` array, alongside
`darkf-core`, `darkf-engine`, `darkf-cli`, `darkf-web`.

```
darkf-opencode-plugin/
  package.json
  src/
    tui.tsx        # entrypoint: default export { id, tui }
    locate.ts      # live runs + per-run supervisor-session binding
    digest.ts       # journal digest + static graph + supervisor status -> PlanView
    band.tsx        # app_bottom slot component (compact, always)
    sidebar.tsx     # sidebar_content slot component (detailed, per session)
    route.tsx       # full-screen plan view: auto-open, toggle, DialogSelect
    poll.ts         # refresh scheduling (fs.watch + interval fallback)
```

`package.json`:

```json
{
  "name": "darkf-opencode-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/tui.tsx",
  "dependencies": {
    "darkf-core": "workspace:*",
    "darkf-cli": "workspace:*"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.14.0",
    "@opentui/core": ">=0.1.99",
    "@opentui/solid": ">=0.1.99"
  },
  "engines": {
    "opencode": ">=1.14.0"
  }
}
```

(`engines.opencode` is read by opencode's own install-target detection for
npm-distributed plugins; harmless to include now even though v1 ships as a
file plugin, which skips that check entirely per the TUI plugin spec.)

### darkf-cli needs one small, additive change: a real export surface

`darkf-cli/package.json` currently sets `bin` only — no `main`, no
`exports`. `foldJournal`, `classifyTerminal`, `stallWarning` (in
`src/status.ts`) and `resolveRun`, `readJournalText`, `isPidAlive`,
`journalPathFor`, `projectRoot`, `RegistryEntry` (in `src/registry.ts`) are
all plain named exports, reachable today only by a deep import
(`darkf-cli/src/status.ts`). This repo's own quality-scaffold spec already
flagged deep reach-through imports across a package boundary as the one
pattern it considered banning outright (dropped only for lack of a rule
engine to express it, not because it was judged fine) — this plugin
shouldn't be the thing that establishes the precedent.

Fix: give `darkf-cli` the same shape `darkf-core` already has, without
touching its existing CLI entrypoint. `darkf-cli/src/index.ts` is already
the launched-via-`bin` script — reusing that name for the new export barrel
would force a rename of working, unrelated code. Instead, a differently
named file does the job `main` needs:

`darkf-cli/src/exports.ts` (new, small, re-exports only):

```ts
export * from "./status.ts";
export * from "./registry.ts";
```

`darkf-cli/package.json` gains `"main": "src/exports.ts"`, `"types":
"src/exports.ts"`. `src/index.ts` (the CLI entrypoint, launched via `bin`,
which resolves independently of `main`) is untouched. No behavior changes
anywhere in `darkf-cli`.

`darkf-opencode-plugin` then does:

```ts
import { renderMermaid, buildRegistry, isComposite, EXIT, type WorkflowDef } from "darkf-core";
import { foldJournal, classifyTerminal, stallWarning, resolveRun, readJournalText,
         isPidAlive, journalPathFor, projectRoot, type RegistryEntry } from "darkf-cli";
```

No subprocess, no new CLI flag, no duplicated status logic. Everything
darkf-side this plugin shows is computed by the exact same functions `darkf
status` already uses.

### Run discovery (`locate.ts`) — and two necessary darkf-cli corrections found while specifying it

`resolveRun` is built for the CLI's "pick one run" question (`darkf status`)
and deliberately refuses to pick when more than one is live. The per-session
binding model (**Multiple live runs**, above) needs the opposite: the *set*
of all currently-live runs, so each can be checked against its own binding
independently. `locate.ts` therefore calls `listEntries` directly and
applies the same defensive check `resolveRun`'s own `classifyResolved`
already uses (a cached `"running"` status is never trusted alone — the
journal's terminal marker decides):

```ts
function liveRunEntries(directory: string): RegistryEntry[] {
  const root = projectRoot(directory);
  return listEntries(root).filter((entry) => {
    const text = readJournalText(journalPathFor(entry));
    return classifyTerminal(text, isPidAlive(entry.pid)) === "running";
  });
}
```

Building this surfaced two real gaps, found only by checking what a
`RegistryEntry` actually carries — not visible from the earlier,
resolveRun-shaped design:

- **A registry entry names no workflow.** `buildPlanView` needs the actual
  `WorkflowDef` object to call `buildRegistry`/`renderMermaid` on, but
  `RegistryEntry` (`darkf-cli/src/registry.ts`) carries `rootDir`, `pid`,
  `message` — never which `workflow.ts` produced the run. `darkf-cli/src/index.ts`'s
  own `startCmd` already has the resolved workflow directory in scope right
  where it calls `writeEntry`; it just never recorded it. Fix: `RegistryEntry`
  gains one new **optional** field, `workflowDir?: string` (old entries
  without it still parse — `parseEntry` doesn't require it), written by
  `startCmd` from the `dir` it already resolved.
- **`darkf run` (blocking) wrote no registry entry at all.** Only `darkf
  start` (detached) did — so a run launched the other way (explicitly part
  of this spec's own Problem statement: "an agent runs `darkf start` *or*
  `darkf run`") was invisible to `listEntries` while in progress, discoverable
  only after the fact via the final `journal:` line it prints on exit. Fix:
  `runCmd` now pre-generates its `runId` (rather than leaving it to `run()`'s
  own default), writes a `"running"` entry before dispatch starts, and
  updates it to `succeeded`/`crashed` after — the same two-write pattern
  `startCmd`'s spawned worker already uses, just inline instead of across a
  process boundary.

Both changes are additive (one optional field; one new write path for a
command that wrote nothing before) and were verified against this repo's
actual test suite and `tsc` after making them — `bun test` (49 pass) and
`bun x tsc --noEmit` both clean in `darkf-cli` with these changes in place.
This supersedes the "no change to... registry schema" line under **Cross-
component contracts** below; see the correction there.

`directory` (fed into `liveRunEntries`) comes from `api.state.path.directory`
(confirming this against `path.worktree` once the plugin is wired up is
tracked separately — see **Open decisions**). Polled on the same cadence as
the journal (below), since the operator can `cd`/switch workspace without
restarting opencode.

With `entry.workflowDir` in hand, loading the actual `WorkflowDef` is the
same dynamic import `darkf-cli/src/index.ts`'s own `loadWorkflow` already
does: `import(pathToFileURL(resolve(entry.workflowDir, "workflow.ts")).href)`.
An entry with no `workflowDir` (written before this change, or by some other
future caller) degrades the same way a `buildRegistry` throw does — see
**Error handling**: no graph to show, darkf-only fields (current/crash/stall)
still computed from the journal, which never needed the workflow object.

### Data mapping (`digest.ts`)

One pure function, `buildPlanView(workflow, journalText, supervisor?)`,
composing darkf's existing primitives with no new status semantics beyond
the supervisor overlay:

- `buildRegistry(workflow)` for the static shape: every state's `def` and
  its composite `scopePath` (ancestor chain) — this is what makes ancestor
  highlighting possible without any journal change, since nesting is a
  property of the workflow definition, not the run.
- `foldJournal(journalText)` for the live digest: current state, phase,
  heartbeat age, visit counts, crash reason.
- Ancestors of the current state for highlighting:
  `registry.get(digest.current.state).scopePath` — note `renderActive`'s own
  `ancestors` parameter is never actually populated by any caller today
  (`darkf-cli/src/index.ts:286` always passes `[]`); this plugin is what
  first makes that information flow.

  **Two states this lookup must handle before it runs, not after it
  throws.** `digest.current` is built from the journal's *last event*, not
  "the currently dispatching leaf" — those coincide while a run is active,
  but not otherwise. Checked directly against `run.ts`: every dispatch
  (`run.ts:189`, `:244`) emits a real leaf id, confirming the lookup is safe
  *while a node is running or has just finished* — but the run's own end
  marker (`run.ts:261`) emits `EXIT` (`"[*]"`) as `state`, which has no
  registry entry, and a run with no journal yet gives `digest.current ===
  null`. `buildPlanView` branches on both before touching the registry:
  `current === null` → "not started"; `current.state === EXIT` → "finished
  successfully, no leaf to highlight"; otherwise → the leaf lookup above.
- If a `RunBinding.supervisorSessionID` exists: `api.state.session.status(sessionID)`
  (`idle | busy | retry(attempt, message, next)`) plus a short synopsis
  pulled from the last assistant message in `api.state.session.messages(sessionID)`
  — the same "last assistant text" extraction `opencode-ralph-loop` already
  does, reused as a pattern, not imported as code (different plugin target).

Output shape (consumed by the sidebar and the route — the band only needs a
small slice of this):

```ts
interface PlanNode {
  id: string;
  kind: "agent" | "script" | "composite";
  children?: PlanNode[];
  active: boolean;       // this state, or an ancestor of the current leaf
  isCurrentLeaf: boolean;
  visits: number;
}
interface SupervisorView {
  sessionID: string;
  status: SessionStatus;   // idle | busy | retry
  lastMessage?: string;    // short synopsis, truncated for display
}
interface PlanView {
  runId: string;
  root: PlanNode[];
  current: JournalDigest["current"];
  crash: JournalDigest["crash"];
  stall: string | null;    // stallWarning(digest) verbatim
  supervisor?: SupervisorView;
}
```

### Compact band (`band.tsx`)

Registered via `api.slots.register({ slots: { app_bottom: Component } })`.
Renders nothing when no run is live. One run live: one line, same vocabulary
`darkf status` already uses —

```
series-ordering: Implement (running, attempt 1) · 42s
```

or, on stall/crash:

```
series-ordering: Implement — stall suspected: no heartbeat for 103s
series-ordering: Review — crashed: {"kind":"timeout"}
```

Multiple runs live: `"2 darkf runs active"` (no per-run detail at this tier
— that's what the sidebar/route are for).

### Sidebar detail (`sidebar.tsx`)

Registered via `api.slots.register({ order: 450, slots: { sidebar_content: Component } })`
— `450` sits between the built-in `internal:sidebar-todo` (400) and
`internal:sidebar-footer`/`internal:sidebar-files` (500), so it reads as
"one more fact about this session" rather than displacing anything. Shows
the run bound to the current `session_id` prop, if any, as a compact
vertical list of `PlanNode`s (no wide nesting — indentation conveys
composite grouping) with the current leaf highlighted.

### Full plan view (`route.tsx`)

A plugin route (`api.route.register([{ name: "darkf-plan", render }])`),
auto-opened per **Auto-open and the toggle** above, and reachable manually
via a registered command/keybind for a bound run with no auto-open target.
Renders `PlanView.root` as nested `<box>`s — one level of indentation per
composite, matching `renderMermaid`'s own nesting exactly — each leaf tagged
with the same type icon `mermaid.ts` already uses (🤖 agent, ▸ script), the
active leaf (and its active ancestors) drawn with `api.theme.current.accent`
as border/text color, a visit count per state, and — when `crash` is set —
the reason rendered in `api.theme.current.error`. Below the graph, the
supervisor panel (when `PlanView.supervisor` is present): status
(idle/busy/retry) and the last-message synopsis.

When opened with no bound run and multiple unbound candidates, renders
`api.ui.DialogSelect` first (see **Multiple live runs**) before the graph.

This is, deliberately, a JSX re-rendering of exactly what `renderActive()`
already describes in mermaid syntax — same information, different render
target, per "Mermaid is a render target" taken literally: the plugin has its
own render target (opentui boxes) fed by the identical graph-building call.

### Refresh (`poll.ts`)

No event bridge exists from an external darkf process into opencode's host
event bus for this — `api.event.on`'s `Event` union
(`@opencode-ai/sdk/v2`'s `types.gen.d.ts:1740`) is entirely session/message/
file-edit/LSP/MCP/VCS/PTY/workspace events scoped to opencode's own activity.
It does include `EventFileWatcherUpdated` (`{file, event: "add"|"change"|"unlink"}`),
which is tempting — if the host's project file watcher happens to cover
`.darkf/registry/*.json` and `.darkf/run/*/journal.jsonl`, the plugin could
piggyback on it instead of rolling its own. Whether it actually covers
runtime-written files from an external process (vs. only tracked/edited
files) isn't verifiable from documentation and needs a live spike. **v1
does not wait on that spike** — it ships with its own mechanism now, and
swaps the source later as a pure optimization if the spike confirms it works,
since the fallback below has to exist regardless (the host watcher might
never cover these paths, or might miss an external process's writes
unreliably):

- Primary: `fs.watch` on the resolved run's `journal.jsonl` (cheap, typically
  near-instant) — re-run `buildPlanView` and update the plugin's own reactive
  state (a solid-js signal written from the watch callback) on each change
  event.
- Fallback: a 1s interval that re-resolves `liveRuns()` from scratch, so a
  newly-started run is picked up, a finished run's row disappears, and
  filesystems where `fs.watch` is unreliable (confirmed flaky on some
  network/bind-mounted filesystems) still converge. Same order of magnitude
  as `darkf monitor`'s own `MONITOR_SUB_POLL_MS = 500` — this is a passive
  display, not a blocking wait loop, so the cost is pure CPU/redraw churn,
  not latency to a decision.
- All disposed via `api.lifecycle.onDispose(...)` on plugin deactivation —
  per the TUI plugin runtime's own tracked-cleanup contract.

## Cross-component contracts

- **New workspace package** `darkf-opencode-plugin`, added to root
  `package.json`'s `workspaces`.
- **`darkf-cli`**: new `src/exports.ts` (re-exports only, no logic),
  `package.json` gains `main`/`types` pointing at it. No change to
  `src/status.ts`, `src/registry.ts`, `src/index.ts` (the CLI entrypoint), or
  any CLI command's behavior.
- **`darkf-core`**: no change — its export surface (`darkf-core/src/index.ts`)
  already covers everything needed (`renderMermaid`, `buildRegistry`,
  `isComposite`, `EXIT`, `WorkflowDef`, `StateDef`).
- **No change** to `darkf-engine` or any runtime execution path. The journal
  format, heartbeat cadence, and registry schema are all read, never written,
  by this plugin.
- **Deployment**: the operator adds one entry to their own `tui.json`:

  ```json
  { "plugin": ["<darkf-checkout>/darkf-opencode-plugin/src/tui.tsx"] }
  ```

  matching the TUI plugin spec's documented local-file-plugin path exactly.
  No install script — single operator, single machine, not worth
  automating yet.

## Error handling

Two failure surfaces this design introduces, both must degrade the display,
never crash the plugin — consistent with this spec's own "safe to be wrong"
stance (see Non-goals):

- **`buildRegistry(workflow)` throws.** It throws `DuplicateStateIdError` for
  a workflow definition with a duplicate state id — the same case
  `darkf-engine`'s own `run.ts:117-124` has to catch. `digest.ts` calls the
  same function; a throw here means the workflow itself is broken, not that
  darkf's run failed. `buildPlanView` catches it and returns a
  "workflow definition error" view (the id that collided, from the error),
  rendered in place of the graph — not propagated as an unhandled exception.
- **A bound `supervisorSessionID` goes stale.** The session it names can be
  deleted or compacted away after binding (Q4's heuristic binds once, at
  detection time, and never rebinds). `api.state.session.status(sessionID)`/
  `session.messages(sessionID)` returning nothing for a stale id degrades
  the supervisor panel to absent — the same as if no session had ever been
  bound — not an exception.

Everything else the plugin reads (`readJournalText`, `listEntries` via
`resolveRun`) already degrades safely by construction — both catch their own
read errors and return an empty/absent result rather than throwing
(`darkf-cli/src/registry.ts`) — so no additional handling is needed there.

## Assumptions and dependencies

Collected here so they're checked up front, not discovered mid-implementation
— each is already flagged where it's used, repeated together for visibility:

- **opencode version floor** (`engines.opencode >= 1.14.0` in `package.json`)
  and the `@opentui/core`/`@opentui/solid` peer-dependency floors
  (`>= 0.1.99`) — the versions installed locally at spec-writing time; not
  independently verified as the actual minimum the APIs used here require.
- **`api.state.path.directory` vs `path.worktree`** — which one matches
  `projectRoot()`'s `.git`-walk semantics for a subdirectory-opened session
  is unconfirmed (see Open decisions).
- **`EventFileWatcherUpdated`'s actual coverage** — whether opencode's host
  file watcher fires for `.darkf/registry/*.json`/`.darkf/run/*/journal.jsonl`
  (written by an external process, not edited through opencode) is
  unconfirmed; v1 doesn't depend on it (see Refresh), but the deferred
  optimization does.
- **The NDJSON shape of `opencode run --format json`** — sourced from a
  third-party write-up, not opencode's own docs or source; only relevant to
  the deferred sub-node-visibility follow-up, not to anything in this spec's
  own implementation (see Non-goals).

## Security considerations

No new trust boundary. The plugin only reads files already readable by
whatever process starts a darkf run and the opencode process the operator is
already running as themselves, plus the supervisor session's own messages
via the already-authorized `api.state`/`api.client` — no new process is
spawned, no new network call is made, no data leaves the local filesystem.
Two things worth naming explicitly: a crash `reason` or run `message` could
in principle contain operator-authored text rendered verbatim in the TUI
(same as `darkf status` already does today — no new exposure); and the
supervisor-status synopsis renders a slice of the supervisor's own last
message, which is the operator's own agent conversation, already visible to
them in that same session — not a new disclosure, just a second place it's
echoed.

## Non-goals, revisited — why not more

Everything above is additive and small on purpose, matching
`PHILOSOPHY.md`'s "few configuration knobs" stance: no new config file, no
new flags on `darkf` itself, no DSL for choosing what to display (the plan
view always shows the whole graph; there's exactly one workflow's shape to
show per run). Sub-node visibility and precise supervisor-binding are both
explicitly deferred, not silently dropped (see **Non-goals** above) — new,
separately-scoped specs if they turn out to be needed, not a reason to make
this one bigger than the problem it solves today.

## Verification strategy

- **Digest correctness**: unit tests on `buildPlanView` against the
  `series-ordering` workflow's real shape (`darkf-cli/workflows/series-ordering/workflow.ts`)
  and a captured `journal.jsonl` fixture, covering: no run (`"none"`),
  mid-run on a leaf inside the `Fix` composite (ancestor highlighting),
  crashed, and a `supervisor` overlay present vs. absent.
- **Binding + auto-open, by hand**: from a live opencode session, have an
  agent invoke `darkf start` as a shell tool call; confirm the plugin
  navigates to the full route automatically, the supervisor panel reflects
  that session's status, and the toggle keybind returns to the exact same
  chat. Separately, start a darkf run from a plain terminal (not via a
  session's tool call) and confirm it shows up unbound (band/sidebar/route
  all degrade to darkf-only, no auto-open since no session route was current
  at detection) — this exercises the heuristic's known failure mode on
  purpose, not by accident.
- **Live run, by hand**: with a run active, confirm the band and sidebar
  update on each transition, cross-checked against `darkf monitor` running
  concurrently in a second terminal — the two must always agree, since both
  fold the same journal.
- **Multiple runs**: start two darkf runs under the same project root bound
  to two different sessions; confirm each session's sidebar shows only its
  own run, the band shows "2 darkf runs active," and opening the full route
  from a third, unbound session surfaces the `DialogSelect` picker listing
  both.
- **Stall/crash paths**: reuse this repo's existing stall-warning and crash
  fixtures (same journal shapes `darkf-cli/src/status.test.ts` already
  exercises) to confirm the band/sidebar/route render the warning/reason
  instead of silently showing a stale "running."
- **Cleanup**: deactivate the plugin via opencode's plugin manager while a
  watch is active; confirm no error and no orphaned `fs.watch` handle (check
  via the process's open file descriptors, or simply confirm no further
  console warnings after deactivation).

## Success criteria

- An agent invoking `darkf start`/`darkf run` as a shell tool call from a
  focused session results in that session's chat being replaced by the full
  plan view within one refresh cycle, with no manual action, and a single
  keybind returns to the same chat.
- The full plan view's supervisor panel reflects the bound session's actual
  `idle`/`busy`/`retry` status and last-message synopsis at all times it's
  checked against the live session.
- The band's and sidebar's state/phase always match what `darkf status`
  reports at the same instant (manual side-by-side check during
  verification).
- The full plan view's highlighted leaf and its ancestors always match the
  journal's last event, including across composite boundaries (e.g. while
  inside `Fix > Implement`, both `Fix` and `Implement` render highlighted).
- No darkf run's behavior, timing, or output changes in any way with the
  plugin loaded versus not loaded (purely observational, confirmed by diffing
  a run's journal with the plugin active vs. inactive).
- `bun run typecheck`/`bun run lint`/`bun run arch-check` all pass with the
  new package included (extends naturally once `darkf-opencode-plugin` is
  added to those scripts' package list).

## Open decisions

- **Confirm `api.state.path.directory` vs `path.worktree`.** Not verifiable
  from documentation alone; check both against a real multi-root/subdirectory
  opencode session once the plugin is wired up, and use whichever actually
  matches `projectRoot()`'s `.git`-walk semantics.
- **The `EventFileWatcherUpdated` spike** (see **Refresh**) — ship with the
  plugin's own `fs.watch`, revisit only if the host's watcher is confirmed to
  cover `.darkf/` paths and the swap is worth the (small) simplification.
- **The precise supervisor-binding hook** (see **Design overview — Binding a
  run to its supervisor session**) — build only if the cheap heuristic's race
  window turns out to matter in practice.

Everything else raised during review (sidebar vs. band placement, auto-open
scope, toggle target, multi-run handling, poll cadence, the `darkf-cli`
export-surface naming, ancestor-highlighting correctness, sub-node
visibility's real cost) is resolved above, not left open.
