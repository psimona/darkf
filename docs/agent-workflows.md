# Authoring agent workflows

Lessons from the first real dogfood run (series-ordering: a repo-targeting
implement → verify → review loop over a Kotlin/Gradle repo). Everything here
came from a failure or near-failure in that run.

## Install + run

Install options:

- **Dev machine (tracks the checkout — recommended while darkf is moving):**
  `cd darkf/darkf-cli && bun link` → a bare `darkf` on PATH that always runs
  the working clone.
- **Other machines (git head, no version):** `bun add -g git+<repo-url>` or
  `npm i -g git+<repo-url>` — the monorepo root exposes the `darkf` bin.

`rootDir` — the run-artifact root AND the agent runner's working directory —
is the **invocation cwd**, not the workflow dir:

```bash
cd /path/to/target-repo
darkf start my-workflow "initial message"
```

## Workflow references

`darkf run|start|render <ref>` resolves `<ref>` as:

1. a path (contains `/`, or an existing dir relative to cwd — back-compat),
2. `<cwd>/darkf/<ref>` — project workspace,
3. `<darkf-cli>/workflows/<ref>` — shipped with darkf.

A candidate counts only if it contains `workflow.ts`. `darkf workflows` lists
what is visible. Ship a reusable workflow with darkf by adding it to
`darkf-cli/workflows/`; keep project-specific ones in the target repo's
`darkf/`.

**`darkf/` vs `.darkf/` — two directories, two different lifetimes.**
`darkf/<name>/` (no dot) is versioned workflow config: `workflow.ts`,
`scripts/` — commit it like any other source. `.darkf/` (dot-prefixed) is
darkf's own runtime/run-storage directory — the journal, handoff files,
the registry, and the agent's own cwd all land there, under the target
repo's `.darkf/run/<runId>/` — and is meant to be gitignored wholesale.
Putting workflow config under `.darkf/workflows/` (the older convention)
made a clean `.gitignore .darkf/` impossible without also losing the
workflow source; the two are split apart for exactly that reason.

`DispatchInfo.rootDir` mirrors this. Older revisions resolved it to the
workflow dir; workflows written against that behavior must be re-run from the
target repo instead of resolving paths themselves.

## Use the built-in runners

`src/agents/claude-code.ts` and `src/agents/opencode.ts` implement the
handoff-file contract (the agent writes its result JSON to
`.darkf/run/<runId>/handoff/<step>-<nodeId>.json`), session resume, per-node
`agent: { model, permissionMode }` config, and `def.timeoutMs`. Wire one in:

```ts
import { claudeCodeRunner } from "../../src/agents/claude-code.ts";
export const agentRunner: AgentRunner = claudeCodeRunner;
```

Do not hand-roll stdout event parsing. A finished-but-unparseable agent answer
becomes a terminal crash; the handoff file contract exists precisely so the
result is structured. Prompts must NOT ask the agent to echo `event: x` in
prose — describe the semantics of each event and let the appended contract
text handle the mechanics.

Spawn gotchas baked into the runners (reproduce them in any custom runner):
- Resolve the binary with `Bun.which(...)` — PATH lookup can fail in the
  daemonized worker.
- A nonexistent `cwd` surfaces as spawn `ENOENT` — it reads like a missing
  binary but is a bad directory. When your runner throws ENOENT, print the cwd
  it used.

## Scripts get the handoff + DispatchInfo

A `script` node's default export receives `(handoff, info)` and returns a
`NodeResult`. `info.rootDir` is the invocation cwd — the target repo — so a
script that must act on it (run `./gradlew check`, read files) uses
`info.rootDir` and the workflow stays location-independent. Relay any fields a
later node needs: nothing carries forward unless each node re-emits it.

## Wrap review loops in a composite with maxCycles

Implement → verify → review loops can cycle. The engine counts cycles per
composite (`maxCycles`, crash kind `cycle-limit`) — a flat chain of siblings
has no cap. Put the loop states inside a composite:

```ts
Fix: { initial: "Implement", maxCycles: 8, states: { Implement: …, Verify: … } },
Review: { type: "agent", prompt: REVIEW_PROMPT, on: { done: EXIT, changes_requested: "Implement" } },
```

`status` flags a visit count ≥ 4 as a possible cycle. Real runs: 6 review
rounds happened before `done`; every round was a legitimate finding, but
nothing would have stopped round 30.

## Reviews must see untracked files

Agents drafting "helpful" extra files (specs for the next feature, scratch
notes) are invisible to `git diff`. Review prompts must say:

> Inspect `git status --porcelain` in addition to `git diff` — nothing beyond
> the named files may exist as part of this change.

## Preflight, report, and usage telemetry

- `darkf doctor <ref>` — preflight before a run: workflow resolves + loads,
  exports `agentRunner`, agent binaries resolvable, cwd sane (it FAILS when
  run from inside the darkf checkout — the classic wrong-target mistake; the
  agent cwd follows rootDir = invocation cwd).
- `darkf report [--run <id>]` — per-dispatch efficacy/efficiency view from the
  journal: span, dispatch table (state / duration / outcome), visit histogram,
  crash reasons.
- **Live runtime**: open dispatches heartbeat the journal every 30s;
  `status` shows advancing `elapsed`, warns on stalls (warn-only — the
  supervisor reacts), and `monitor` prints compact `still running` pulses
  instead of nothing between transitions.
- **Usage sidecars**: each agent dispatch writes cost + tokens to
  `.darkf/run/<runId>/usage/<step>-<nodeId>.json`; `report` summarizes them.
  Usage is telemetry about a dispatch, deliberately not part of the NodeResult
  data flow.

## Set `retries` on agent states

`maxAttempts = (def.retries ?? 0) + 1` — default 1, so one transient failure
(spawn hiccup, unparsable handoff, timeout) terminates the whole run. Give
long-running agent states `retries: 1`.

## Event design

`validEvents` is injected into the prompt; keep the set small and semantic
(`implemented` / `blocked`, `green` / `red`, `done` / `changes_requested`).
Use `EXIT` for terminal human gates (`blocked`) — a crash is not a verdict,
and neither is a blocked agent: exit cleanly and let a human re-enter.

### The `disputed` event — anti-appeasement gate

A reviewer agent can demand something subtly wrong, and an implementer agent
will comply if compliance is the only surviving path. Two agents agreeing on
a wrong idea is the failure mode tests cannot catch. Give the implementer a
reserved `disputed` event: when a review demand contradicts the spec, it
objects — demand + spec-grounded rationale in `output` — and the workflow
routes `disputed` to `EXIT`. The run ends with the disagreement recorded for
a human, never papered over. Compliance must never be the only path.
