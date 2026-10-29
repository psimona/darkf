# Agent handoff contract

A spec for how `darkf-cli` gets a result out of a CLI-based coding-agent
harness (Claude Code, opencode, pi, codex, deepseek, …) and into darkf's own
`NodeResult` — one shared, harness-agnostic mechanism, not a bespoke parser
per harness. This is a `darkf-cli` concern only: `darkf-core` and
`darkf-engine` stay unaware this convention exists. Script nodes never need
it — they're in-process function calls with no subprocess boundary to cross.

## The contract

**The handoff file IS a `NodeResult`, verbatim.** Not a separate schema that
then gets translated:

```json
{ "event": "approved", "output": { "plan": "..." }, "sessionId": "harness-native-id" }
```

All three fields stay optional, exactly as `NodeResult` already defines them.
Any harness that can write that exact shape to a known path satisfies the
contract — nothing more is required of it.

## Success criteria

- A `ClaudeCodeRunner` exists, implements `AgentRunner`, and drives the CLI's
  own `Plan → Implement{Write,Test} → Review` demo workflow end to end with
  the `Plan` and `Review` agent nodes dispatched through it instead of the
  example's hand-written stub.
- `handoffPath` produces the exact path from the convention below for a
  given `(rootDir, runId, step, nodeId)`, verified by unit test.
- A handoff file written by the harness at that path is read back and
  accepted by the engine as `succeeded` with no `darkf-cli`-side shape
  checking beyond `readHandoff`'s parse.
- A missing or malformed handoff file surfaces as the existing
  `runner-error` or `malformed-result` `CrashReason` — no new crash kind
  reaches the journal.
- A retried dispatch (`attempt` > 1) reuses the same handoff path and the
  engine's existing retry loop drives it, with no new retry machinery added
  anywhere in `darkf-cli`.

## Path convention

```
.darkf/run/<runId>/handoff/<step, zero-padded to 4 digits>-<nodeId>.json
```

Example, for the CLI's own `Plan → Implement{Write,Test} → Review` demo:

```
.darkf/run/<runId>/handoff/0001-Plan.json
.darkf/run/<runId>/handoff/0002-Write.json
.darkf/run/<runId>/handoff/0003-Test.json
.darkf/run/<runId>/handoff/0004-Write.json
.darkf/run/<runId>/handoff/0005-Test.json
.darkf/run/<runId>/handoff/0006-Review.json
```

Listing the directory sorts into one chronological timeline of the whole
run, interleaved across every node — not grouped per node id.

`step` is a **required addition to `DispatchInfo`** (`darkf-core/types.ts`):
the engine's own step counter (`run.ts`'s `steps`), already computed and
already constant across every retry attempt of one visit (it lives in the
outer loop, above the inner `attempt` retry loop) — exposing it is a
one-line change, not new bookkeeping. This is what makes the path
deterministic from data already in hand: no in-memory visit map, no
directory listing to reconstruct history, and it can never drift from the
journal's own step ordering.

`rootDir` is also a **required addition to `DispatchInfo`**: `AgentRunner`
currently has no way to know where the run's artifacts live (`ScriptRunner`
gets a dedicated `baseDir` param for an unrelated reason — locating script
files — but nothing analogous exists for agent runners). `rootDir` mirrors
`RunOptions.rootDir` so an agent runner can compute `<rootDir>/.darkf/run/
<runId>/handoff/...` itself.

## Retry vs. run-retry vs. resume — which one this is

- **Retry of one dispatch** (`attempt` > 1, same `step`): the handoff file
  couldn't be parsed, or the harness process failed, or `validate` rejected
  it. Same file path — attempt 2 overwrites attempt 1's file. This is the
  only kind of "retry" this spec is about.
  - This overwrite is only safe if the *previous* attempt's process is
    actually dead. `run.ts`'s `withTimeout` abandons the dispatch promise on
    timeout without killing anything it was awaiting — if a per-harness
    runner's subprocess is still running when the engine moves on, it could
    still write to this same path later and race or clobber the next
    attempt. Each per-harness runner owns its subprocess's lifecycle and
    must ensure it can no longer write to the handoff path once the runner's
    own `run()` promise settles (resolved, rejected, or abandoned by
    timeout) — e.g. by killing the child process itself before returning or
    on abort. This is a per-harness responsibility (see below), not
    something `handoff.ts` can enforce, since it has no handle on the
    process.
- **Retry of a whole run**: a new `runId`, a new `.darkf/run/<runId>/`
  directory, no continuity with the previous attempt. Not implemented today;
  out of scope here.
- **Resume of a run**: same `runId`, same directory, continuing step
  numbering forward. Not implemented today (wishlist #9); out of scope here,
  but the path convention above is already resume-compatible by construction
  — nothing about it assumes a run starts at step 1 in-memory.

## Failure handling — no new machinery needed

If the handoff file is missing or its JSON is malformed, the shared reader
either throws (harness process never wrote it — becomes a `runner-error`
crash, consuming a retry attempt) or returns whatever it parsed as-is,
un-validated. The **engine already validates** every runner's return value
via `isNodeResult` before accepting it as `succeeded` — a bad shape becomes
today's existing `malformed-result` `CrashReason`, same retry path as any
other crash. No new `CrashReason` kind, no duplicate validation logic in
`darkf-cli`.

## What's shared vs. what's per-harness

**Shared, written once** (`darkf-cli/src/agents/handoff.ts`):
- `handoffPath(rootDir, runId, step, nodeId): string` — the path formula
  above, a pure function of data already on `DispatchInfo`.
- `handoffContractText(path): string` — the fixed instruction block telling
  an agent what JSON to write and where, for harnesses with no native
  structured-output flag.
- `readHandoff(path): Promise<unknown>` — read + `JSON.parse`, nothing else.
  No `isNodeResult` check here — that's the engine's job, not this file's.

**Per-harness, small** (`darkf-cli/src/agents/<harness>.ts`, one file per
harness, each implementing `AgentRunner` directly):
- Argv/invocation for that specific CLI: binary name, flags, how the prompt
  is passed.
- Whether the harness has a native "write structured output to this path"
  flag (use it) or needs `handoffContractText` appended to the prompt (the
  universal fallback — works for any harness that can write a file).
- Deriving/returning `sessionId` in whatever form that harness's own resume
  mechanics need — relayed back via `NodeResult.sessionId` exactly as
  `DispatchInfo.sessionId` already carries it into subsequent retries.
- Owning its own subprocess's lifecycle: killing the child process before
  `run()` settles (including on the engine's timeout aborting the await), so
  a dead attempt can never write to the handoff path after the engine has
  moved on to the next attempt or the next node (see the retry note above).

## Cross-component contracts

- **`darkf-core/types.ts` ↔ `darkf-engine/run.ts`**: `DispatchInfo` gains
  `step: number` and `rootDir: string`. `run.ts` is the sole construction
  site (`const info: DispatchInfo = {...}` in the retry loop) — it must
  populate both from state it already holds (`steps`, `opts.rootDir`) on
  every attempt. No other file constructs a `DispatchInfo`.
- **`darkf-engine/run.ts` ↔ `darkf-cli/src/agents/*`**: an `AgentRunner`
  implementation reads `step` and `rootDir` off the `DispatchInfo` it's
  handed and passes them into `handoffPath` — the engine never calls
  `handoffPath` itself and has no knowledge the handoff convention exists.
- **`darkf-cli/src/agents/handoff.ts` ↔ `darkf-cli/src/agents/<harness>.ts`**:
  each per-harness runner calls `handoffPath` to get the path, then either
  passes it to the harness's native structured-output flag or appends
  `handoffContractText(path)` to the prompt, then calls `readHandoff(path)`
  after the harness process exits and returns its result as-is (no
  `isNodeResult` check on this side of the boundary).

## Initial implementation scope

Only **one** concrete adapter is buildable and verifiable in this
environment: a `ClaudeCodeRunner` wrapping the `claude` CLI. The other four
named harnesses (opencode, pi, codex, deepseek) get the interface and this
spec as their extension point, not speculative stub code — writing an
adapter for a CLI whose actual flags/output format can't be checked here
would just be guessing.

## Testing strategy

- **`handoff.ts` (unit)**: `handoffPath` is a pure function — table-test
  `(rootDir, runId, step, nodeId)` inputs against expected paths, including
  the zero-padding and the repeated-`nodeId`-at-different-`step` case (e.g.
  `Write` appearing at both step 2 and step 4). `readHandoff` — test the
  parse-success case, the missing-file throw, and the malformed-JSON throw.
- **`ClaudeCodeRunner` (integration)**: drive it against the real `claude`
  CLI in a scratch directory with a trivial prompt, asserting the handoff
  file appears at the expected path and round-trips through `readHandoff`
  into a `NodeResult` the engine accepts. Cover the missing-handoff-file
  case (kill or misconfigure the invocation) and confirm it surfaces as
  `runner-error`/`malformed-result`, not a new crash kind.
- **End-to-end**: run the CLI's own demo workflow with `ClaudeCodeRunner`
  wired in place of the hand-written example `agentRunner`, confirming the
  full `Plan → Implement{Write,Test} → Review` sequence completes and every
  step's handoff file is present in `.darkf/run/<runId>/handoff/`.

## Security considerations

No new trust boundary: the handoff file is written by a subprocess the same
user already launched, to a path under a `.darkf` directory that process
already has filesystem access to, and read back by the same process that
launched it. `readHandoff` does `JSON.parse` with no further validation, but
a malformed or adversarial parse result is caught by the engine's existing
`isNodeResult` check before it can affect routing — the same protection any
other runner's return value already gets.

## Non-goals

- No in-memory visit counter, no directory-listing reconstruction — the
  path is a pure function of `(rootDir, runId, step, nodeId)`.
- No new validation layer in `darkf-cli` — reuse `isNodeResult` via the
  engine's existing crash path.
- 4-digit zero-padding is a known, accepted limit (correct sort order only
  up to 9999 steps); not fixed, since it only matters past the point where
  `maxSteps` would already have stopped the run — true at the engine's
  default of 1000, and equally true for any caller-supplied `maxSteps`: a
  caller who raises it past 9999 inherits the same accepted trade-off, not a
  new one.
