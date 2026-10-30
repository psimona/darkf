# Roadmap

Status snapshot, not a durable plan — update this as things move. See
`PHILOSOPHY.md` for the principles this roadmap should never contradict.
Design specs for anything not-yet-built belong under
`<subproject>/docs/specs/<slug>/`, moving to `docs/specs/_built/<slug>/` once
shipped (see the `_built/agent-handoff` entry below for the one example so far).

## Done

> **2026-10-29 — package merge.** The `package-boundaries` spec decided
> Option D: `darkf-core`, `darkf-engine`, and `darkf-cli` are now one
> package, **`darkf`** (v0.3.0), with `src/{core,engine,kit,cli}/`
> subfolders; `darkf-opencode-plugin` stays separate; `darkf-web` is
> deleted. Imports read `darkf/src/core/index.ts` and friends; consumers
> (including the consumer repo) depend on the single `darkf` package. Entries
> below predate the merge and keep the old package names.
>
> **2026-10-29 — OSS publish.** The repo went public as
> `github.com/psimona/darkf` (fresh single-commit history; Forgejo frozen
> as the private archive). Docs site live at
> `psimona.github.io/darkf`. The package publishes to npm as
> **`@psimona/darkf`** — npm's typosquat filter blocks the unscoped name —
> via a staged-publish workflow (`release.yml`): a `v*` tag stages the
> package, a maintainer approves on npmjs.com. See
> `docs/specs/_built/oss-publish/spec.md`. CI runs on GitHub Actions; the
> Forgejo CI workflow was removed.

**darkf-core** — the shared vocabulary
- `types.ts`: `NodeResult`, `DispatchInfo` (incl. `step`/`rootDir`), `AgentRunner`/`ScriptRunner`, the four-phase `NodeStatus`, the 9-variant `CrashReason` taxonomy, `WorkflowDef`/`StateDef` (agent, script, composite with `maxCycles`).
- `graph.ts`: registry-building, target resolution, composite entry.
- `mermaid.ts`: render workflow definitions (and active-state highlighting) to mermaid — one-way, never parsed back.
- `journal.ts`: JSONL event shape.

**darkf-engine** — the interpreter
- `run.ts`: the full dispatch loop — retries with `previousFailure`/`sessionId` threading, per-attempt timeout, `validate` hook, cycle-limit and `maxSteps` circuit breakers, unconditional JSONL journaling to `.darkf/run/<runId>/journal.jsonl`. The journal now always opens with a begin marker (the run's seed) and, on success, closes with an end marker (the final `NodeResult`) — both `EXIT`-tagged `succeeded` lines, so the file alone answers "did it finish, and how" (a crash writes no end marker; the crashing leaf's own `crashed` line is its last). `RunOptions.runId` lets a caller key external state to the run's own journal dir (used by `darkf-cli`'s registry); a UUID when omitted.
- Test coverage in `run.test.ts` (incl. `step`/`rootDir` threading across retries).

**darkf-cli** — the harness
- `src/index.ts`: `render` and `run` commands, loads a `workflow.ts` module (workflow + optional `input`/`agentRunner`/`scriptRunner`), writes `.darkf/last-run.mmd`. `scriptRunner` is a workflow's opt-in override for run-aware script dispatch — forwarded straight to `run()`; omitted, it falls back to darkf-engine's default, which only ever passes a script's default export the plain `handoff`, with no `DispatchInfo`/`runId` at all. Added because a script needing its own `.darkf/run/<runId>/...` artifact (mirroring the journal/handoff-file convention) had no way to get `info` without it — found while porting an earlier project's build-backend workflow (that port was its own deliverable, not an engine effort).
- **Detached run + monitor** (`docs/specs/_built/detached-run-monitor`): `darkf start <dir> [message]` launches a workflow as a detached worker (survives the launcher exiting via `Bun.spawn` + `unref`), prints `{ runId, pid }` and exits; `darkf status [--run]` and `darkf monitor [--run] [--window] [--once]` read the journal directly to report / watch a run, with status-specific exit codes for a calling agent to react to. A run registry (`<projectRoot>/.darkf/registry/<runId>.json`, keyed off the nearest `.git` ancestor) points at each run's journal so a caller anywhere under the project can find "the current run"; its `status`/`finishedAt` are a best-effort cache — the journal's own begin/end markers are the authority for terminal state (succeeded / crashed / orphaned). `start` and `run` share one arg parser; a CLI `message` overrides the workflow module's `input` export. `run` stays blocking/in-process.
- `src/agents/handoff.ts` + `src/agents/claude-code.ts`: the agent-handoff contract — `handoffPath`/`handoffContractText`/`readHandoff`, and `claudeCodeRunner` (the one concrete per-harness adapter, `_built/agent-handoff`). Unit-tested; not yet live-smoke-tested against the real `claude` CLI.
- `src/agents/opencode.ts`: `opencodeRunner`, a second concrete `AgentRunner` adapter (OpenCode CLI, `opencode run -m <provider/model> --format json`), built and live-smoke-tested for real (see the consumer repo/docs/roadmap/the earlier project/tickets/real-agent-wiring-pilot.md`) — one real call against a real prompt from that pilot, a self-hosted zero-cost model, correctly wrote a valid handoff file and returned a working `NodeResult`, confirmed via a standalone script, not a modified pilot file. `--format json` is NDJSON (one event per line), not a single blob like Claude's — `parseSessionId` reads the whole stream instead of one `JSON.parse`. No `--auto`/`--dir` needed: the existing global `~/.config/opencode/opencode.json` permission policy already covers headless tool use with zero permission-asks, and `Bun.spawn`'s own `cwd` option already resolves relative paths correctly. Not yet wired into any example or any consumer workflow's committed files — that's real follow-up work, not done here.
- Two example workflows under `examples/`:
  - `haiku-readme/` — the original Plan/Implement/Review demo, stub `agentRunner` (no LLM cost).
  - `article-classifier/` — classify-then-act loop over a small article list (`data/articles.ts`), wired to the real `claudeCodeRunner` (spends real API usage when run). Demonstrates a composite with `maxCycles`, agent `retries`, several `on` events converging on one target, and durable run-scoped state kept in a script module (`scripts/queue.ts`) rather than the handoff.

**Quality scaffold** (`docs/specs/_built/quality-scaffold`) — the repo-root
equivalent of the consumer repo's Detekt/ArchUnit/Kover/gitleaks stack, sized
for a 3-package straight-line dependency graph instead of a hex-module one:
- `biome.json`: lint + format, one tool, gated via `bun run lint`.
- `.dependency-cruiser.mjs`: `core-is-a-leaf` and
  `engine-does-not-import-cli` enforce `darkf-core → darkf-engine →
  darkf-cli`'s one-way dependency direction, plus `no-circular`; gated via
  `bun run arch-check`. Requires `typescript@^5` pinned (dependency-cruiser
  18.2.0 doesn't yet support TS 7).
- `darkf-engine/bunfig.toml`, `darkf-cli/bunfig.toml`: per-package
  `coverageThreshold`, scoped away from sibling workspace files via
  `coveragePathIgnorePatterns`; gated via `bun run test:coverage`.
  `darkf-core` has no test suite yet, so it's excluded until it does.
- `.gitleaks.toml`: secret scanning, gated via `bun run secret-scan`.
- `bun run check` chains all of the above — the local equivalent of
  a consumer repo's `./gradlew check` — and CI runs the same sequence on
  every push (`.github/workflows/ci.yml`).
- `.editorconfig`, `docs/adr/_template.md` ported from an earlier project as-is.

**Same-session nudge** (`docs/specs/_built/session-nudge`, part of the
`docs/roadmap/run-resilience/` effort) — a dispatch that fails the output
contract (no handoff written, handoff unparseable, or an event with no
route) gets up to 3 short corrective messages resumed in its own harness
session before the engine falls back to a full fresh-session retry.
`darkf-core`'s `AgentFailure` carries a session id across a thrown
failure; `CrashReason` splits `handoff-missing`/`handoff-unparseable` out
of the generic `runner-error` bucket. `darkf-engine/run.ts`'s dispatch
loop nests the nudge loop inside each outer attempt — invisible to
`def.retries`, sharing one deadline per outer attempt so a nudge sequence
can't multiply the configured timeout. `opencode.ts` only ever reports a
resumable session id once `scanStepFinish` sees at least one `step-finish`
event (the fix for a session resumed with zero evidence it had done
anything, which once hung a dispatch for 15 minutes); `-s` resume stays
scoped to the nudge call itself, never a plain retry. `status.ts` gains
`nudgeWarning`, printed by `status`/`monitor` alongside `stallWarning`.

**Local distribution** (`scripts/pack-local.sh`, `bun run pack:local` /
`bun run install:global`) — a real `0.3.0` on the single merged `darkf`
package (past the `0.0.0` placeholder era), and a packing script that
builds a true frozen snapshot instead of the live `workspace:*` symlink
this repo's own dev setup still uses. It archives the package from
`git archive HEAD` (never the dirty working tree) and packs with
`bun pm pack`. The merged package has zero dependencies, so the
sibling-tarball rewriting — and the Bun `file:` diamond/dual-package
hazards the pre-merge script had to dodge — is gone entirely (see the
package-boundaries spec). `bun install -g` on the resulting `darkf`
tarball installs a real, independent copy (not a symlink) with a working
global `darkf` bin — confirmed end to end from a scratch directory with
no relation to this repo, and confirmed that editing this repo's source
afterward has zero effect on the already-installed copy.

## Not started

- **Other harness adapters** — pi, codex, deepseek were named in the agent-handoff spec's non-goals as deferred; OpenCode also has a real adapter (`darkf/src/kit/agents/opencode.ts`, see "Done" above). With the package public, outsider demand is the deciding input — see `docs/specs/harness-adapters/spec.md`.
- **Resume-from-journal** — PHILOSOPHY.md states the journal + last `NodeResult` should be enough to resume a run, but no resume command/logic exists yet in the CLI. Investigation draft: `docs/specs/resume-from-journal/spec.md`.
- **Observability / learning loop** — no infra yet for capturing cross-run traces or evals to learn from past workflow runs. Candidate: [Opik](https://github.com/comet-ml/opik) (comet-ml's LLM tracing + eval platform, self-hosted or Comet-hosted) as the backing store, instrumenting the engine's dispatch loop to emit spans per node/task. Would sit alongside (or replace) the existing lightweight `.darkf/run/<runId>/journal.jsonl` convention — worth weighing that overlap before committing. Still at "should we even do this" — revisit when learning/improvement becomes the focus, not before.
- **Shared task-list JSON types** — blueprint's plan/tasks.json shape and this repo's `examples/task-queue` `Task` are two ad-hoc definitions of the same concept. One shared type vocabulary (core types + `item-loop.ts`) unlocks reuse across workflows and renders the task list in the OpenCode TUI plugin. Draft: `docs/specs/task-list-json/spec.md`.
- **Machine-readable roadmap format** — `docs/roadmap/*/map.md` is prose-first; a JSON sidecar would let the TUI plugin and the docs site render the decision map and its frontier. Draft: `docs/specs/roadmap-json/spec.md`.

## Open questions

- ~~What darkf-web is actually for~~ — resolved 2026-10-29: deleted with the package merge (the package-boundaries decision); it had no source and no consumer.
- Neither example exercises cross-retry `sessionId` resume (a runner reusing its own native session after a validation failure) — worth a third example if that path needs demonstrating.
- ~~Whether the sibling-checkout constraint on the workspaces-based consumption model (above) is acceptable long-term~~ — resolved 2026-10-21: the consumer repo now consumes the `pack:local` tarballs (its `package.json` depends on `darkf-cli` via an absolute `file:` tarball path, no `workspaces` field, `darkf-core`/`darkf-engine` dropped and hoisted — same diamond-avoidance shape `pack-local.sh` already uses internally), not the live sibling-checkout symlink. Re-running `bun run pack:local` in this repo and `bun install` in the consumer repo is now a required step to pick up darkf changes there — they no longer show up live.
