# Durable run/session schema

## Question

Give a darkf run a durable, cross-process record of (a) which `AgentRunner`
executed it and (b) which external session/harness supervised it — both
currently either missing entirely or only ever known in-memory, live-only
(`locate.ts`'s `RunBinding`, forgotten the instant a run stops being live).
Design fully resolved via grilling on `search-picker-empty`'s draft spec;
this ticket is the `darkf-core`/`darkf-cli` half of that spec, split out
because it has **zero** `darkf-opencode-plugin` dependency and is
independently buildable/testable.

## Type

task

## Blocked by

none. (Its opencode row in the env-var table specifically is gated on
**verify-opencode-session-env** confirming a version floor — that's a
sub-detail of this ticket's own scope, not a blocking dependency on a
separate ticket landing first. Ship with the Claude Code row only; add
opencode's row as a small follow-up once that ticket resolves.)

## Status

done — built, typechecked, and tested clean (`darkf-core`/`darkf-cli`
only, no plugin change, per this ticket's own scope).

## Design (resolved — see `docs/specs/opencode-search-candidates/spec.md`
## for full detail; summarized here for this ticket's own scope)

- **`darkf-core/src/types.ts`**: `AgentRunner` gains an optional
  `kind?: string`. Purely additive.
- **`darkf-cli/src/agents/opencode.ts`** / **`claude-code.ts`**:
  `opencodeRunner`/`claudeCodeRunner` set `kind: "opencode"` /
  `kind: "claude-code"` respectively.
- **`darkf-cli/src/registry.ts`**: `RegistryEntry` gains
  `agentRunnerKind?: string` (copied from `opts.agentRunner.kind` at
  `startCmd`/`runCmd` time) and `supervisorSessionID?: string` /
  `supervisorHarness?: string`, written by a new, small, extensible
  env-var table checked at the same point:
  ```ts
  const SUPERVISOR_ENV_SIGNALS: Array<{ env: string; harness: string }> = [
    { env: "CLAUDE_CODE_SESSION_ID", harness: "claude-code" },
    // opencode's row added once verify-opencode-session-env confirms a
    // version floor — not added speculatively.
  ];
  ```
  First matching env var in `process.env` wins; none found leaves both
  fields unset (degrade to "nothing shown," same as everywhere else in
  this plugin).
- **`darkf-cli/src/status.ts`**: `foldJournal`'s `JournalDigest.current`
  gains `sessionId?: string`, copied from `lastStatus.sessionId` when
  `phase === "running"` — already present on `NodeStatus`
  (`darkf-core/src/types.ts:151`), just silently dropped today
  (`status.ts:48-53`).

## Verification strategy

- Unit tests on `foldJournal` confirming `sessionId` round-trips through
  a fixture journal with a `"running"` status carrying one.
- Unit tests on the new `RegistryEntry` fields: a fixture env (with/
  without `CLAUDE_CODE_SESSION_ID` set) produces the expected
  `supervisorSessionID`/`supervisorHarness`, or leaves both `undefined`.
- Confirm `bun run check` (typecheck/lint/arch-check/test:coverage) stays
  green across `darkf-core`/`darkf-cli` with these additions — all are
  additive, so no existing test should need updating.

## Done

Built as designed above, one deliberate sequencing refinement found while
implementing:

- `AgentRunner.kind` added to `darkf-core/src/types.ts`; `opencodeRunner`/
  `claudeCodeRunner` set it in `darkf-cli/src/agents/{opencode,claude-code}.ts`.
- `RegistryEntry` gained `agentRunnerKind?`, `supervisorSessionID?`,
  `supervisorHarness?` in `darkf-cli/src/registry.ts`, plus the exported
  `SUPERVISOR_ENV_SIGNALS` table (Claude Code row only, as scoped) and a
  `detectSupervisorSignal()` helper.
- **Sequencing note, not predicted by the ticket**: `startCmd` never loads
  the workflow module itself (only the detached worker it spawns does), so
  it can't know `agentRunner.kind` at the point it writes the initial
  registry entry. `supervisorSessionID`/`supervisorHarness` *are* written
  there (env-detected, no workflow load needed); `agentRunnerKind` is
  merged in by `workerCmd` immediately after it loads the workflow,
  best-effort, the same pattern already used for the final status update.
  `runCmd` (the non-detached path) has both at hand at once and sets them
  together, no split needed.
- `foldJournal`'s `JournalDigest.current` gains `sessionId?`, copied from
  `NodeStatus.sessionId` while `phase === "running"`.
- Verification: unit tests added in `status.test.ts` (sessionId round-trip,
  present/absent) and `registry.test.ts` (`detectSupervisorSignal` matrix:
  match, no match, empty-string env value, unrelated var). `bun run
  typecheck`/`arch-check` clean; `darkf-core` (no tests), `darkf-engine`
  (25 pass), `darkf-cli` (51 pass, 100% line coverage on the two touched
  files) all green. `bun run lint`'s 4 remaining findings are pre-existing,
  in files this ticket didn't touch (`index.ts`'s `dwellHint`, two
  `darkf-opencode-plugin` `.tsx` files) — confirmed via `git diff --stat`
  before and after.
- Not done (deliberately, per scope): opencode's `SUPERVISOR_ENV_SIGNALS`
  row — waits on **verify-opencode-session-env**, as the ticket specifies.
