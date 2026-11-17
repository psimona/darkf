# Stall Retry

## The problem

A provider stream can go silent mid-dispatch. The agent process stays
alive. It produces no output. darkf's engine heartbeat only proves the
process is alive. It does not prove the agent is making progress.
Today nothing kills a silently stalled dispatch before the 1-hour
timeout. A human must notice and kill it by hand.

## The core mechanism

Watch for the most recent line on either output stream. Reset a timer
every time a line arrives, on stdout or on stderr. If the timer ever
runs out, the stream has gone silent. Kill the process and retry.

Concretely, in the runner (`darkf/src/kit/agents/opencode.ts`):

1. On spawn, start a timer for `stallMs` (a new leaf config field,
   beside `retries`/`timeoutMs`).
2. Read stdout and stderr concurrently, line by line, using the same
   line splitter (`readIncrementally`) already used for stdout.
3. Every line, from either stream, resets the timer.
4. If the timer fires, kill the child (SIGTERM), mark it `stalled`,
   and throw `AgentFailure({ kind: "agent-stall" })`.
5. The engine's existing attempt loop (`darkf/src/engine/run.ts`)
   already retries any thrown `AgentFailure`, bounded by `def.retries`.
   `agent-stall` needs no new engine code — it just isn't added to
   `NUDGEABLE_KINDS`, so it falls straight through to the normal
   retry path.

That's the whole feature. Everything else below is tuning and two bug
fixes needed to make the mechanism trustworthy.

## What darkf cannot tell apart

Tested directly: dispatched a real `opencode run --format json` with a
prompt that runs `sleep 25` as a shell tool call. Result — the tool
call produced **zero lines of output for the full 25 seconds it ran**.
The `tool_use` event doesn't arrive until the tool already reports
`"status": "completed"`. There is no separate "tool started" event.

So a long legitimate tool call (the cited case: a 10-minute build) and
a provider stream that silently died look **identical** to darkf: both
are plain silence. There is no signal available today **in the NDJSON
stream darkf reads** that tells them apart. Lowering `stallMs` below
the longest real tool-call duration does not catch stalls faster — it
just makes "kill and retry a legitimate long step" the common case.

The real incident this spec is built from (`b5f76215`, see the ticket)
confirms the two failure shapes are genuinely different at the OS
level, even though they're identical in the NDJSON stream. It was
diagnosed from TCP socket state, not a hung subprocess: ESTABLISHED, no
retransmits, `lastsnd 220s` — opencode itself parked in `epoll_wait`
waiting on a provider response that never arrived. No local subprocess
was involved. A long legitimate build, by contrast, *is* a local
subprocess — tested directly below.

**Tried and ruled out: watching the process tree.** The obvious fix is
to check whether the agent has a live child process before killing it —
a running child means a real tool call, not a dead stream. Tested this
directly: dispatched `opencode run --format json "Run the shell
command: sleep 20"` as its own process and inspected `/proc` while it
ran. The `sleep 20` process's parent was **not** the `opencode run`
process darkf spawns and controls — it was a separate, long-lived
`opencode-pty` daemon (confirmed pre-existing, unrelated to this
dispatch) that opencode routes all shell-tool execution through by
default. Walking descendants of the PID darkf actually owns showed
zero child processes. `opencode run --help` confirms this is the
default: it talks to a persistent **background service**
(`~/.local/state/opencode/service.json`: URL, PID, password) instead of
spawning a private one; `--standalone` opts out of that per-invocation.
So the subprocess that does the real work is structurally outside the
tree darkf can see from the PID it owns — there's nothing to walk.
(`/dev/null` redirection was the original worry here and turns out not
to matter: FD redirection doesn't hide a process from `ps`/`/proc`,
PID/cmdline/parent/state are independent of where its output goes. The
daemon indirection is the actual blocker, not FD opacity.)

Given all of that, the kill threshold has to clear the longest known
legitimate gap, not the fastest plausible human reaction time — unless
one of the options below is built first.

## Disambiguation options (unbuilt — open design question)

A pure silence-threshold kill is a gamble: every default has a false-kill
tail, and the only way to shrink it today is to raise `stallMs`, which
also raises how long a real stall survives. The options below would let
darkf tell a live tool call apart from a dead stream, not just guess
from silence duration. None are built; this is the design space before
committing to ship threshold-only.

1. **Query the background service's PTY list.** The default (non
   `--standalone`) background service that `opencode run` already talks
   to (`~/.local/state/opencode/service.json`: URL, PID, local password)
   exposes a typed `Pty` model over HTTP/SSE — `GET /pty` /
   `event.subscribe` in the `@opencode-ai/sdk` — with `status: "running"
   | "exited"` and a real `pid`, plus `pty.created` / `pty.updated` /
   `pty.exited` events. Confirmed live: `GET /api/pty` without
   credentials returns `{"_tag":"UnauthorizedError"}` — the endpoint is
   there, behind the same local password already sitting in
   `service.json`. This is the clean fix for the dominant case (a
   shell-tool build): before killing on silence, check whether a PTY is
   currently `"running"` for this session. If yes, extend the wait
   instead of killing — the silence is a real, visible, running command,
   not a dead stream. If no PTY is running, the silence has no
   legitimate local explanation and killing is safe. Needs: reading the
   local password file (already same-user-readable, no new secret
   surface) and the exact auth header shape, plus mapping a PTY back to
   *this* dispatch's session (the API is global across whatever else is
   using the same background service on the machine). Covers the cited
   10-minute-build case exactly, because builds run through this path.
2. **Walk the daemon's process tree by cwd/time correlation.** Same
   signal as #1 without the HTTP API: find the `opencode-pty` daemon's
   own PID (`~/.local/state/opencode/pty/<instance>/service.json`) and
   check its descendants for one with a matching `cwd` and a start time
   inside the stall window. No auth, no new protocol — but it's a
   heuristic over an undocumented, version-coupled directory layout, and
   it can't attribute a child to *this* dispatch's session when two
   dispatches share a cwd concurrently. A stopgap, not a real fix.
3. **Socket-state inspection**, mirroring how the `b5f76215` incident was
   actually diagnosed by hand: a long-idle `ESTABLISHED` socket from the
   agent process to a known provider endpoint is suggestive of a hung
   response. Not pursued as a primary signal — TCP state alone can't
   tell "request outstanding, no response" apart from "idle pooled
   keep-alive connection, nothing in flight," so this needs the
   application-level knowledge (a step is in progress) that darkf
   already loses track of; it would corroborate, not replace, #1.
4. **Narrow the feature's scope instead of solving disambiguation.**
   Ship kill+retry only when some independent signal (any of the above)
   positively confirms "no local work is happening" — i.e., treat "PTY
   running" (or its process-tree proxy) as a hold-off condition gating
   the existing silence timer, rather than trying to classify every
   silence. Tool types with no PTY at all (file read/write, MCP calls,
   web fetch) stay in the original gamble, but those are exactly the
   fast, bounded tool types — not the ones that produce multi-minute
   legitimate silences in practice.

### Cross-harness cost of option 1

darkf already has two runners, `opencode.ts` and `claude-code.ts`
(`darkf/src/kit/agents/`), so "multiple harnesses" isn't hypothetical.
Option 1 is not a generic liveness mechanism, though — it's opencode's
own internal daemon surface. Building on it for real would mean adding
an optional capability to the runner contract, e.g.
`checkLiveness?(): Promise<{ busy: boolean }>`, implemented per
harness, so the engine can call it uniformly without knowing which
runner it's talking to.

Only `opencode.ts` could implement that capability meaningfully today.
`claude-code.ts` has no equivalent to piggyback on — it doesn't even
stream: it reads the whole of stdout as one blob after exit
(`await new Response(proc.stdout).text()`, `claude-code.ts:128`), no
partial output, no background service, no PTY abstraction to query.
The gap isn't "claude-code exposes this differently" — it's
"claude-code's runner has no liveness signal at any layer," which
tracks with this spec's own non-goal that claude-code parity waits for
opencode's slice to prove the approach first. A generic interface
built now would ship with exactly one working implementation and one
harness permanently on the pure-silence fallback: a real interface with
fake generality, buying nothing today.

That argues against building the interface, and against building
option 1 at all in its current shape. The daemon's `/pty` endpoint was
built for the TUI's own live rendering, not as a documented integration
surface — depending on it means depending on opencode's internals
rather than its CLI contract, and this project has already been bitten
once by exactly that class of coupling (`fix(opencode-plugin): restore
plugin loading under opencode 2.3.0`). The sturdier fix is upstream: ask
opencode to emit a `tool_use`/`status:"started"` event into the same
`--format json` NDJSON stream darkf already reads, the same way
`tool_use`/`"completed"` already arrives. That's the harness exposing
the signal through its actual public contract — no new auth, no new
process, no internal coupling — and it would read the same way for any
future NDJSON-streaming harness, for free, instead of needing a
per-harness capability at all.

**Revised recommendation**: don't build option 1 as scoped. Either
raise this with opencode as a feature request on its documented output
format, or — if that's not pursued — ship stall-retry threshold-only
with the false-kill risk written down as a real, accepted tradeoff (see
"The threshold," below) rather than something a hidden integration
quietly solved. The existing attempt-bound retry already makes a false
kill cheap — one consumed attempt, not data loss — which is the
argument for shipping threshold-only now rather than blocking on either
path.

## The threshold

- **`stallMs` default: 15 minutes.** Above the longest tool-call
  duration on record (a 10-minute build), with margin. Far below the
  1-hour timeout ceiling.
- **Warn at 5 minutes**, display-only, before the kill
  (`AGENT_STALL_MS` in `darkf/src/kit/status.ts`, 15 → 5). This is
  just an earlier heads-up in the journal; it does not act.
- Per-leaf override for workflows with longer or shorter legitimate
  gaps. Revisit the default on the first false kill or the first
  wasteful wait — one incident and one anecdotal tool-call duration is
  not a distribution.
- **Accepted, not solved: a legitimate tool call longer than
  `stallMs` gets killed and retried too.** No disambiguation option
  above is built (see "Disambiguation options"); this threshold is the
  whole mitigation. The retry is cheap (one consumed attempt) but not
  free, and a leaf whose longest legitimate gap is unknown or grows
  past 15 minutes needs its `stallMs` override raised by its author,
  not discovered by a false kill in production.

## On kill

A stall-killed process exits the same way the existing 1-hour timeout
kill does (SIGTERM → exit code 143, confirmed against Bun directly).
The runner checks its own `stalled` flag *before* checking the exit
code, so a stall is never misclassified as a generic `runner-error`.
The retry starts a fresh session — resuming a session SIGTERM killed
mid-turn is unproven, so this stays out of scope.

```typescript
// darkf/src/core/types.ts
type CrashReason =
  // ...existing variants...
  | { kind: "agent-stall"; idleMs: number; lastEvent: string };

interface BaseLeafDef {
  stallMs?: number; // default 15 * 60_000
}
```

## Two bug fixes this needs

**stderr must be drained concurrently, not only after exit.** Today
only stdout is read live; stderr is read once, after a non-zero exit.
A child that writes more than the pipe buffer to stderr can block on
that write and produce no stdout either — read as a stall (or worse,
missed for a full hour). Reading stderr concurrently also means its
lines count toward liveness. One real consequence: the existing
post-exit `new Response(proc.stderr).text()` must be deleted and
replaced with the text already captured by the concurrent reader — a
stream a reader has already consumed throws if read a second time.

**`agentStepCount` is counting the wrong field.** Confirmed by the
real capture above: the event's outer `type` is `step_finish`
(underscore). The code checks `event.type === "step-finish"`
(hyphenated) — a string that only exists one level down, in
`part.type`. It has never matched. Fix: match the outer field,
underscored: `event.type === "step_finish"`. This also fixes
`agentSessionId` attachment, which is gated on the same (currently
dead) check.

## Non-goals

- No opencode-side stream timeout — that belongs upstream.
- No way to tell a long tool call from a dead stream — no such signal
  exists today; the threshold is the only lever available.
- No session resume after a stall kill.
- No claude-code parity in this slice — its output is a single JSON
  summary, not an NDJSON stream with a separate stderr channel.

## Testing

- Runner: a fake binary that emits lines then goes silent — assert
  the kill fires at `stallMs`, the thrown failure carries
  `agent-stall` and `idleMs`. A stderr-only fixture — assert no kill
  while stderr flows, and no pipe block.
- Engine: a stub runner throwing `agent-stall` — assert the attempt is
  consumed, the retry is fresh (no resume, no nudge).
- A fixture built from the captured sample above, for the
  `step_finish` match.
