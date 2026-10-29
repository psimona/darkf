# Detached run + monitor

A spec for letting an outside agent kick off a darkf workflow without
blocking its own turn on it, and check back on progress with a cheap,
bounded, repeatable command instead of tailing the journal by hand. This is
almost entirely a `darkf-cli` concern, the same way the agent-handoff
contract was — with one small, deliberate exception: `darkf-engine`'s
`run.ts` gains two `emit()` call sites (no new types anywhere in
`darkf-core`) so the journal itself can record a run's beginning and end,
instead of duplicating that information into a separate file. Everything
else here is process-supervision bookkeeping layered on top of the journal,
which stays the one durable record of what a workflow actually did.

Design pattern borrowed from (not copied from) a working reference: an
existing `the earlier reference project`-monitoring skill (`the earlier reference project-status` / `the earlier reference project-monitor` +
`_lib.py`, in a sibling project's skill library) that watches a bounded
window, prints rich transitions, and exits with a status-specific code for
the calling agent to react to — the agent supplies the backoff cadence by
re-invoking with a longer window each time, the script never sleeps
indefinitely on its own. darkf's version is smaller: darkf has one crash
taxonomy (not the earlier reference project's kind/signature/blocked-reason vocabulary), no
human-gate node type, and every dispatch already has an engine-enforced
`timeoutMs` ceiling, so there's no need to reinvent the earlier reference project's long-command
stall heuristic.

## The problem

`darkf run <dir>` blocks in-process until the whole workflow finishes, then
prints a final summary. There is no way to start a run and come back to it
later, and no notion of "the run currently in progress" — a caller has to
already know the `runId` and the workflow's directory to look at anything.

## Design overview

Four additions:

1. **`darkf start`** — a new, separate command (not a flag on `run`) that
   launches a workflow detached: writes a registry entry, spawns a worker,
   confirms the worker is actually alive, prints `{ runId, pid }`, exits.
2. **`darkf run`** — unchanged. Still blocks in-process until the workflow
   finishes, same as today. Existing scripts, tests, and the example
   workflows keep working exactly as they do now.
3. **A run registry** (`darkf-cli` only) — pointers, not workflow outcomes,
   so a caller anywhere under the project can find "the current run"
   without knowing which directory it was started from. Deliberately
   *not* the source of truth for whether a run succeeded — see
   **Terminal-state detection** below.
4. **`darkf status`** (one-shot digest) and **`darkf monitor`** (bounded
   window, prints transitions as they happen, exits with a status-specific
   code) — both read the journal directly; the only thing ever written
   *into* the journal beyond what already exists is the two new
   `run.ts` emits below.

### Why two commands instead of a `--detach` flag

The natural first instinct is a flag. Rejected because the failure modes of
the two flag polarities are asymmetric and both bad:

- Default-blocks, `--detach` opt-in: an agent that forgets the flag blocks
  silently for up to the full `timeoutMs` ceiling (an hour, by default) —
  a bad failure to have riding on "remembered to type a flag."
- Default-detaches, `--wait` opt-out: breaking change to today's behavior,
  and a human doing fast local iteration who forgets `--wait` loses the
  synchronous exit-code guarantee they were relying on.

Two commands (`run` always blocks, `start` always detaches) means there is
no flag to forget on either side — the caller names the behavior they want,
and gets exactly that, unconditionally. `start` internally reuses `run`'s
argument parsing (`dir`, `message`) to avoid the two drifting apart; it
just short-circuits before the blocking `run()` await.

### Why `start` and `monitor` stay fully separate calls

`start`'s one job is "launch, report identity, return." `monitor`'s one job
is "observe." A flag on `start` that also opens a monitor window would
re-blur exactly the blocking/non-blocking distinction the two-command split
above exists to eliminate. So the intended flow is always two separate
calls, with the calling agent deciding the cadence between repeated
`monitor` calls itself:

```
darkf start <dir> [message]     # returns { runId, pid } immediately
darkf monitor                   # auto-discovers via registry, bounded window
darkf monitor                   # agent re-invokes, growing window, on its own cadence
```

## Terminal-state detection — journal-native begin/end markers

`PHILOSOPHY.md` already states the model this should follow: *"a leaf
dispatch, a composite's active descendant, and the whole run's terminal
outcome are all 'a node executing'"* — the same four-phase shape,
recursively, at every depth, including the top. The journal just wasn't
living up to that yet: reaching `EXIT` on the success path returns from
`run()` with **no `emit()` call at all** (a real, pre-existing gap, found
by tracing `run.ts` directly), and there was never any journal entry for
what a run *started with* either. Both gaps close with the same fix, and
neither needs a new type:

- **`EXIT`** (`"[*]"`) is already darkf's reserved sentinel — and mermaid
  itself already dual-uses `[*]` for both the start *and* end pseudostate,
  disambiguated only by direction (`[*] --> A` vs. `A --> [*]`). No real
  workflow state can ever legitimately be named `EXIT`, since it's a
  `Target` value, never a key in a `WorkflowDef`'s `states` record — so any
  journal line with `state === EXIT` is unambiguously one of these two
  markers, never a real leaf.
- **Begin**: `run.ts`, immediately after the journal logger is created and
  *before* `buildRegistry` runs (not merely "before the dispatch loop" —
  `buildRegistry` can crash, e.g. `duplicate-id`, and return before the
  loop), calls `emit({ phase: "succeeded", result: handoff }, EXIT, [])` —
  `handoff` at that point is exactly `opts.input ?? {}`, the run's actual
  seed. Placing it before `buildRegistry` guarantees it is always the
  *first* line in `journal.jsonl`, even on an immediate registry crash.
- **End**: `run.ts`'s existing success path,
  ```ts
  if (target === EXIT) {
    return { runId, trace, node: { phase: "succeeded", result } };
  }
  ```
  gains one line — `emit({ phase: "succeeded", result }, EXIT, [])` — right
  before the `return`. Always the *last* line, when present.
- **Crash needs no equivalent.** Unlike success (reachable from any leaf
  that happens to route to `EXIT`, at any depth), a crash is immediate and
  unwinds straight to the top with no further routing — the crashing
  leaf's own `crashed` emit already *is* the run's own terminal event, same
  moment, nothing to duplicate.

Position (first line vs. last line), not a new field, is what
distinguishes begin from end — both use the identical `{state: EXIT, phase:
"succeeded", scopePath: []}` shape.

**They fire `onEvent` too.** Both markers go through the existing `emit()`
helper, which journals *and* calls `opts.onEvent`. That's deliberate: per
`PHILOSOPHY.md` the whole run's begin/terminal outcome is "a node
executing" at the top depth, the same four-phase shape as any leaf, so the
run machine's own transitions belong in the event stream, not just the
file. Consequence: the two existing `darkf-engine` tests that assert the
exact event/journal stream (`onEvent fires for every transition`, `always
journals to .darkf/run/...`) each gain a begin event/line at the front and
an end event/line at the back, and must be updated (see Testing strategy).

**`EXIT`-is-never-a-state-key is a convention, not an enforced invariant.**
`buildRegistry` (darkf-core) does not reject a state literally keyed
`"[*]"`. That's fine: the engine already special-cases the string `"[*]"`
on its success path (`if (target === EXIT)`), so a workflow that names a
state `"[*]"` is already undefined behavior today — the markers rely on
that existing behavior, not a new guarantee. No code change; noted so a
reader doesn't assume `buildRegistry` polices it.

**What this replaces.** An earlier draft of this spec proposed a
`result.json` sibling file for the same purpose (avoiding the case where a
worker dies between `run()` resolving and a registry update landing, which
would otherwise misreport a real success as an orphaned crash). That's now
unnecessary: reading the journal's own last line already answers "did it
actually finish, and how," with no separate file and no new
`darkf-core` type. This is the one place this spec touches
`darkf-engine` — two `emit()` call sites in `run.ts`, nothing in
`darkf-core/types.ts`.

**Consequence for the registry**: because the journal is now
self-sufficient for outcome, the registry's own `status`/`finishedAt`
fields are a **best-effort cache, never the authority**. The worker still
updates them when it can (cheap fast path: "PID alive" alone is enough to
say "still running" without opening the journal at all), but whenever a
PID is found dead, `status`/`monitor` always fall back to reading the
journal's actual last line before declaring anything — a stale or missing
registry update can never turn a real success into a false orphan report.

## Registry

**Location.** `<projectRoot>/.darkf/registry/<runId>.json`, where
`projectRoot` is the nearest ancestor of cwd containing `.git`, walking up
from cwd (falling back to cwd itself if none is found). This is deliberately
a different subpath (`registry/`) from the existing per-workflow
`<rootDir>/.darkf/run/<runId>/...` (journal, handoff files) — the two never
collide, and the workflow's own artifacts stay exactly where they are today,
addressed by `rootDir` exactly as `RunOptions.rootDir` already works. The
registry only ever stores a pointer to that location plus process-liveness
data.

**Entry shape:**

```json
{
  "schemaVersion": 1,
  "runId": "7248f70a-...",
  "pid": 82441,
  "rootDir": "/absolute/path/to/workflow/dir",
  "startedAt": 1788080000000,
  "message": "classify these articles",
  "status": "running",
  "finishedAt": null
}
```

- `schemaVersion` exists because entries are never deleted — they
  accumulate as run history the same way the journal does, and will
  outlive whatever version of `darkf-cli` wrote them. Unknown/old versions
  should be skipped with a warning, not crash a future reader.
- `message` is the initial input string, if one was given to `start` —
  stored here purely as a convenience label (so a bare `darkf status`
  listing reads as "run X: classify these articles" instead of a bare
  runId), truncated past ~1–2 KB. This is *not* a duplicate source of
  truth: the same value already lives durably as the journal's own first
  line (see above) — the registry copy can be lost, regenerated, or wrong
  without affecting correctness anywhere.
- `status`/`finishedAt` are the best-effort cache described above — never
  trusted alone when a PID is dead.

**PID liveness.** `process.kill(pid, 0)` (raises `ESRCH` if the process is
gone, throws differently — e.g. `EPERM` — if it's alive but unreachable;
both are distinguishable from "no such process"). This needs verifying
against Bun's actual behavior before implementation, not assumed.

**Orphan detection.** `status: "running"` cached in the registry, PID dead,
**and** the journal's last line is not an `EXIT`-tagged `succeeded` marker
→ `orphaned`. This is neither "running" nor an engine `CrashReason` — the
engine's own `run()` loop may never have gotten the chance to finish
observing anything; the process disappeared (OOM kill, `kill -9`, host
restart). New, CLI-only vocabulary, never written into the journal, never
a `CrashReason` variant: a `CrashReason` means "the engine tried and
failed," `orphaned` means "we don't know what happened after this point."

**Known limitation, accepted:** PID reuse. If a run's worker dies and the OS
later reassigns its PID to an unrelated process, the liveness check reports
a false "alive." darkf's trust model is already single-operator/local (same
as the agent-handoff contract's own subprocess trust boundary); this spec
accepts the same small race rather than adding `/proc/<pid>` start-time
comparison or similar — worth revisiting only if it causes a real incident.

## Commands

### `darkf start <dir> [message]`

- `message`, if given, becomes the initial handoff (`opts.input`) passed to
  `run()` — `{ output: { message } }`, wrapped in an object key so future
  callers can add sibling fields without changing the shape already in
  use. It also lands in the registry's `message` field and, durably, as the
  journal's own first line (see above).
- **Precedence over the module's `input`:** a CLI `message` *overrides* the
  workflow module's own `input` export — explicit operator intent beats a
  static module default. `opts.input` is `{ output: { message } }` when a
  message is given, otherwise the module's `input` (or `{}`). `message` is
  a *new* argument — `run` today takes only `<dir>` and seeds from the
  module's `input` export, so "shares argument parsing" means a
  newly-introduced shared parser both commands use, not an existing one.
- Ordering, precisely: write the registry entry (`status: "running"`) →
  spawn the worker → wait a **250ms grace period** → confirm the worker's
  PID is still alive (not merely that spawning didn't throw) → print
  `{ runId, pid }` → exit 0. If the worker has already exited by the time
  of that check, `start` fails loudly (nonzero exit, prints why) instead of
  reporting a fake `{ runId, pid }` for a process that's already dead —
  never write a `"running"` registry entry for a worker confirmed dead.
  - **Why a delay is needed at all**: `Bun.spawn()` returns a `pid` the
    instant the OS forks/execs the child, before the child's own runtime
    has done anything. Checking liveness at 0ms is checking something
    true by construction — a pid that was *just* created still exists a
    moment later even for a worker about to `exit(1)` on a bad import
    three lines in. A zero-delay check can't tell "running fine" from
    "already dying," which defeats the reason `start` checks at all. The
    delay lets the worker get through its own startup (runtime init,
    resolving/importing `darkf-core`/`darkf-engine`, dynamically loading
    the workflow module) so a startup failure has already happened and
    exited by the time we look — only past that window does "still alive"
    mean anything. It's bounded to *that* failure window specifically, not
    "did the workflow itself have a bug" — a bug in the workflow surfaces
    later as a normal `crashed` journal entry, which `status`/`monitor`
    already handle with no help from `start`.
  - **Why 250ms**: measured directly (`bun` on this machine, warm cache) —
    a worker failing on a bad import/module resolution exits in ~9–10ms; a
    real worker (imports `darkf-core`, `darkf-engine`, dynamically loads an
    actual workflow module, reaches `run()`) is alive and past all of that
    in ~24–25ms. 250ms is ~10x the healthy-path latency and ~25x the
    failure-path latency — enough headroom for a slower/cold-cache machine
    without `start` feeling sluggish (imperceptible to a human, trivial for
    an agent). Not a tuned config knob; a one-line constant to revisit if a
    real environment turns out slower than what was measured here.
- The worker is the process that actually calls `run()` from
  `darkf-engine` and, on completion, best-effort updates the registry
  (`status`, `finishedAt`) — see above for why this update is convenience,
  not correctness.
- Whether `Bun.spawn` can fully detach a child (survives the parent shell
  exiting, no `SIGHUP`) needs verifying early — Node's equivalent is
  `detached: true` + `child.unref()`; Bun's exact story here is an open
  implementation question, not assumed.

### `darkf run <dir> [message]`

Gains one optional argument and otherwise behaves exactly as today: blocks
until the workflow finishes, prints the trace and final status, real exit
code. The new `[message]` is an optional positional (same precedence as
`start` — overrides the module's `input`); omitted, `darkf run <dir>` is
byte-for-byte today's behavior. `run` and `start` share one arg parser
(`dir` + optional `message`) so the two can't drift.

### Run resolution (shared by `status` and `monitor`)

Both commands resolve "which run" the same way, given `--run <runId>` or
not:

1. **No registry directory, or empty** → "nothing to monitor."
2. **`--run <runId>` given, no matching entry** → "no such run" — a
   distinct, input-error case, never conflated with "nothing is running."
3. **`--run <runId>` given, matches, already terminal** (registry
   `status`, or — authoritatively — the journal's last line is `crashed`
   or an `EXIT`-tagged `succeeded`) → short-circuit straight to that
   outcome. "Watch/check until terminal" is trivially already satisfied;
   no window needed.
4. **`--run <runId>` given, matches, cached `status: "running"`, dead PID,
   journal's last line is not an `EXIT`-tagged `succeeded`** → orphaned.
5. **No `--run`; registry has entries, none cached `"running"`** →
   "nothing to monitor" (mention the most recent finished run for
   context).
6. **No `--run`; exactly one cached-`"running"` entry with a live PID** →
   resolve to it, proceed.
7. **No `--run`; one cached-`"running"` entry, dead PID** → check the
   journal's last line: `EXIT`-tagged `succeeded` or `crashed` → report
   that outcome; otherwise orphaned. Either way this is a *result*, not
   "nothing to monitor" — silently treating a dead run as "nothing here"
   would hide a real failure.
8. **No `--run`; 2+ cached-`"running"` entries with live PIDs** →
   ambiguous. Refuse to guess: list every live `runId` + `rootDir`,
   require `--run`.
9. **No `--run`; 2+ cached-`"running"` entries, only one with a live PID**
   → resolve to the live one automatically, but still print a warning
   about the other(s) — otherwise a crashed run sitting next to a healthy
   one goes permanently unreported.

### `darkf status [--run <runId>]`

One-shot digest, no loop, using the resolution above. Prints `runId`,
`rootDir`, `message` (if any), current node id + phase, attempt number and
`reason` if crashed, per-node visit counts (folded from the journal),
wall-clock runtime, and `orphaned: true` if applicable.

Exit codes: `0` succeeded, `1` crashed, `2` orphaned, `3` still running
(healthy, no terminal condition — a normal, non-error snapshot outcome),
`4` no such run (`--run` given, no match), `5` ambiguous (need `--run`),
`7` nothing to monitor (no live run, no `--run` given).

### `darkf monitor [--run <runId>] [--window <seconds>] [--once]`

Bounded-window watch, default window 30s. Once a run is resolved (per
above), tails the journal for that run, printing each transition
(`node@visit`, event, dwell time) as it happens — no polling delay beyond
however fast the journal is actually written, since journal writes are
synchronous per transition. The journal's first (`EXIT`-tagged) line, if
present when the window opens, is printed once as "started with: `<input>`"
context rather than as a transition.

**Mid-window handling:**
- Journal file doesn't exist yet (worker hasn't opened it) → not an error;
  treat as "0 transitions so far," keep polling within the window.
- Journal's trailing line is unparseable (caught mid-write) → skip it this
  poll, don't crash, re-read next poll.
- PID was alive at window start, dies partway through → re-check liveness
  **every sub-poll**, not just once at the start; a mid-window death is
  checked against the journal's last line exactly as in resolution step 7
  above (succeeded/crashed if the marker's there, orphaned if not),
  aborting the window immediately either way — never wait out the rest of
  the window once the process is confirmed gone.
- Registry file itself is transiently unreadable (rare torn write) → retry
  next poll, don't crash the whole invocation.

Exit codes: `0` succeeded, `1` crashed (prints `reason`), `2` orphaned,
`4` no such run, `5` ambiguous, `6` window elapsed, run still healthy — the
signal a calling agent's own skill re-invokes on with a longer window
(30s → 90s → 300s, …), `7` nothing to monitor.

The backoff cadence between calls (window growth, when to stop polling and
just narrate to the user) is entirely the calling agent's responsibility,
never darkf-cli's — `darkf monitor` is the eyes, not the judgment.

## Cross-component contracts

- **`darkf-engine/run.ts`**: two new `emit()` call sites (begin, after the
  logger is created and before `buildRegistry`; end, on the `EXIT` success
  path) — both using the existing `NodeStatus`/`NodeEvent` shape and the
  existing `EXIT` sentinel, and both firing `opts.onEvent` via the existing
  `emit()` helper. No change to `darkf-core/types.ts` at all. Two existing
  `darkf-engine` tests assert the exact pre-marker stream and must be
  updated (see Testing strategy).
- Everything else lives inside `darkf-cli` (`src/registry.ts` for the
  registry read/write + PID-liveness helpers, `src/status.ts` for the
  journal-folding digest shared by both commands — including reading the
  journal's first/last lines for begin/end detection — plus the
  `run`/`start`/`status`/`monitor` command implementations in
  `src/index.ts`).

## Non-goals

- **No named-workflow registry.** `darkf run`/`darkf start` still take a
  directory path, same as today. Resolving workflows by a registered name
  is a separate, larger feature and isn't needed to satisfy "detach and
  monitor."
- **No true daemon/service management** (restart policies, supervision
  trees). A detached run is a single spawned process tracked by one
  registry entry; if it dies, that's an orphan to be reported, not
  something darkf-cli restarts.
- **No cross-machine or distributed tracking.** The registry is a local
  filesystem convention, same trust/locality model as the journal.
- **No resume-from-crash.** Already tracked separately in `ROADMAP.md`;
  orphan detection here is about *reporting* an unclean death, not
  recovering from one.
- **No multi-run orchestration or queueing.** The ambiguity policy is
  "refuse and ask," not scheduling or prioritizing between concurrent runs.
- **No `darkf stop`.** Cancelling a detached run is out of scope here;
  today the only way to stop one is an external `kill <pid>` (which then
  reports as `orphaned`, correctly, unless the journal already shows it
  finished).

## Testing strategy

- **`run.ts`'s two new emits (unit, `darkf-engine`)**: the begin marker is
  always `journal.jsonl`'s first line and equals `{state: EXIT, phase:
  "succeeded", result: <input>}`; the end marker, when present, is always
  the last line with the same shape, `result` equal to the final
  `NodeResult`; a crashed run has no end marker at all, only the crashing
  leaf's own `crashed` line. Also: a run that crashes in `buildRegistry`
  (e.g. `duplicate-id`) still has the begin marker as its first line (it is
  emitted before `buildRegistry`), proving the placement.
- **Existing engine test updates (required, not optional):** the markers
  flow through `emit()`, so two current tests assert the old, marker-less
  stream and will fail until updated — `onEvent fires for every
  transition, including retries` (event phases become
  `["succeeded"(EXIT), "running", "running", "succeeded", "succeeded"(EXIT)]`,
  with the two `EXIT`-state events at the ends) and `always journals to
  .darkf/run/<runId>/journal.jsonl, unconditionally` (now four lines:
  begin, running, succeeded, end). Update both to expect the markers, and
  add the new marker-specific assertions above.
- **Registry (unit)**: entry read/write round-trip; PID-liveness against a
  real live PID (e.g. the test process's own) and a definitely-dead one
  (a short-lived child process, awaited to completion first); the full
  resolution matrix (cases 1–9 above) with hand-constructed registry +
  journal fixtures, specifically covering "cached running, dead PID,
  journal actually shows succeeded" resolving to succeeded, not orphaned.
- **`darkf start` (integration)**: confirms the alive-check-before-return
  ordering — a worker that crashes immediately on startup must make
  `start` itself fail, not report a fake `{runId, pid}`.
- **`darkf status`/`darkf monitor` (integration)**: against a real detached
  run of the `haiku-readme` example (stub `agentRunner`, no LLM cost) —
  succeeded, crashed (force a crash, e.g. bad `file:` path in a script
  node), orphan (kill the worker directly, with and without the journal's
  end marker already written), ambiguous (two concurrent detached runs),
  no-such-run, and zero-run "nothing to monitor."
- **Detached survival**: confirm the worker process keeps running and the
  journal keeps growing after the `start` (launcher) process has fully
  exited — the one behavior that can't be verified by unit-testing pure
  functions.

## Security considerations

No new trust boundary beyond what detached execution already implies: a
detached worker is a subprocess of the same user who ran `darkf start`,
same as any other runner-spawned subprocess (e.g. `claudeCodeRunner`). The
registry directory lives under the project's own `.darkf/` (already
gitignored, already local-only). The one accepted risk is the PID-reuse
race noted above.

## Implementation risks — verified

No open design decisions remain — everything above is settled, and the two
implementation risks below were empirically confirmed on Bun 1.3.9 (this
machine, warm cache) before implementation, rather than assumed:

- **`Bun.spawn` can fully detach a child — confirmed.** A child spawned
  with `detached: true`, `stdio: ["ignore","ignore","ignore"]` and
  `child.unref()`, whose parent immediately `process.exit(0)`'d, kept
  running and wrote its marker file ~1.5s later, after the parent was gone.
  So `darkf start` uses `Bun.spawn` + `unref()` directly — no `setsid`/
  `nohup` shell-out needed.
- **`process.kill(pid, 0)` under Bun — confirmed Node-compatible.** A live
  pid (the probe's own `process.pid`) does not throw; a definitely-dead pid
  (a child awaited to exit) and a bogus out-of-range pid both throw with
  `code === "ESRCH"`. So the registry's liveness check is: no throw ⇒
  alive, `ESRCH` ⇒ dead. The `EPERM` live-but-unreachable case is a
  different-user/permission situation outside darkf's single-operator trust
  model and is not relied on.
