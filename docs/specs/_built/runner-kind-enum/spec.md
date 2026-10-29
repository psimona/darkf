# Type `AgentRunner.kind` as an open enum, not a bare string

A spec for a small, type-only fix in `darkf-core`: `AgentRunner.kind` is
declared `string` today, with exactly two real producers in the whole
repo, sitting one field away from properly tagged unions elsewhere in
the same file. This spec gives it autocomplete and typo-catching for
the known values, without closing off the third-party runners the docs
already promise support for.

## Problem

`darkf-core/src/types.ts`:

```ts
export interface AgentRunner {
  kind?: string;
  run(id: string, def: AgentStateDef, handoff: NodeResult, info: DispatchInfo): Promise<NodeResult>;
}
```

Two call sites set it, both with a fixed literal:

```ts
// darkf-cli/src/agents/claude-code.ts:85
kind: "claude-code",

// darkf-cli/src/agents/opencode.ts:77
kind: "opencode",
```

Nothing else in the repo sets it, and nothing branches on its value —
confirmed by grep across `darkf-cli` and `darkf-opencode-plugin`. It's
purely stored (`RegistryEntry.agentRunnerKind`, `darkf-cli/src/index.ts`)
and displayed; never matched in a `switch` or an `===` check.

Despite having exactly two real values today, the type gives no
compile-time help: `kind: "calude-code"` typechecks as happily as
`kind: "claude-code"`. That's a visible inconsistency sitting right
next to `CrashReason`'s nine properly tagged variants in the same file,
and in both `reference/core-types.md` and `guides/pick-an-agent-runner.md`
on the docs site.

## Goals

- `AgentRunner.kind` autocompletes and typo-catches the two known
  built-in values in an editor.
- Third-party runners keep working. `guides/pick-an-agent-runner.md`'s
  "Writing your own" section explicitly documents a third harness (pi,
  codex, "anything else with a headless CLI or API") implementing
  `AgentRunner` — that runner's own `kind` string must still typecheck.
- Zero runtime behavior change. This is a type-only fix.

## Non-goals

- **No runtime validation.** Nothing rejects an unrecognized `kind` at
  runtime today, and this spec doesn't add any — the field stays purely
  advisory, read only for display (`darkf report`, the OpenCode
  plugin's sidebar).
- **Not touching `RegistryEntry.agentRunnerKind`** (`darkf-cli/src/registry.ts`),
  even though it mirrors `AgentRunner.kind` via a direct copy
  (`agentRunnerKind: agentRunner?.kind` in `index.ts`). It lives in a
  different package; see "Open decisions."
- **Not touching `SupervisorSignal.supervisorHarness`** or
  `SUPERVISOR_ENV_SIGNALS[].harness` (also `darkf-cli/src/registry.ts`).
  These describe a different thing — which harness *invoked* `darkf
  start`/`run` from outside, detected via an env var — not which
  runner executes `agent` leaves inside the workflow. The two happen to
  share a value space today (`"claude-code"`) but aren't the same
  concept, and conflating their types isn't this spec's call to make.

## Design overview

```ts
// darkf-core/src/types.ts
export type AgentRunnerKind = "claude-code" | "opencode" | (string & {});

export interface AgentRunner {
  kind?: AgentRunnerKind;
  run(id: string, def: AgentStateDef, handoff: NodeResult, info: DispatchInfo): Promise<NodeResult>;
}
```

`(string & {})` is the standard "open literal union" idiom (sometimes
called a `LiteralUnion`): the empty intersection stops TypeScript from
collapsing the whole union back down to plain `string`, the way
`"claude-code" | "opencode" | string` would on its own. The practical
effect: an editor suggests `"claude-code"`/`"opencode"` and flags a
near-miss typo of either, but `kind: "pi"` or any other string still
typechecks cleanly.

Neither production call site changes. `claude-code.ts:85`'s
`kind: "claude-code"` and `opencode.ts:77`'s `kind: "opencode"` already
satisfy `AgentRunnerKind` as written — they're the literal branch of
the union.

## Alternatives considered

- **Fully closed union** (`kind?: "claude-code" | "opencode"`) —
  rejected. Breaks the documented "write your own runner" story: a
  third-party runner self-identifying with any other string would stop
  typechecking, contradicting `pick-an-agent-runner.md`'s own text.
- **Runtime-validated enum** (reject an unknown `kind` at the registry
  boundary, or warn) — rejected. Nothing validates this field today,
  nothing branches on it, and adding a validation layer for a field
  that's purely advisory cuts against `PHILOSOPHY.md`'s bias toward few
  configuration knobs, for a problem that isn't actually occurring (no
  real runner has ever set a wrong value — the risk is hypothetical).
- **Leave it as `string`** — the status quo being nitpicked. Rejected:
  this is a free compile-time improvement, confirmed zero-migration
  (two production sites, both already literal-compatible) and
  zero-runtime-change.

## Cross-component contracts

- `darkf-core`: `types.ts` gains one new exported type (`AgentRunnerKind`)
  and a one-line signature change on `AgentRunner.kind`. Purely
  additive — any existing `AgentRunner` object literal with a string
  `kind` still satisfies the new type.
- `darkf-cli`: no changes required. `claude-code.ts` and `opencode.ts`
  compile unchanged; `registry.ts`'s `agentRunnerKind?: string` keeps
  accepting whatever `AgentRunner.kind` produces, now typed more
  precisely at the source.
- `darkf-opencode-plugin`: no changes required — confirmed via grep,
  nothing there reads `AgentRunner.kind` or `agentRunnerKind` at all.

## Verification strategy

- `bun run check` at the repo root (typecheck across every package) —
  zero new diagnostics expected anywhere, since nothing does exhaustive
  narrowing on `.kind` today (confirmed by grep: no `agentRunner.kind
  ===` or `switch` on it exists in the codebase).
- Spot-check in an editor: `kind: "claude-cod` after the fix should
  offer `"claude-code"` as a completion; `kind: "claude-cod"` typed in
  full should show a hover/typo signal against the two known literals
  while still compiling.

## Open decisions

- **Whether to extend the same treatment to `RegistryEntry.agentRunnerKind`**
  in a follow-up, now that `darkf-core` exports `AgentRunnerKind` for
  `darkf-cli` to reuse instead of re-declaring `string`. Flagged, not
  decided — `darkf-cli` may prefer to keep its registry schema's field
  types deliberately loose, since `RegistryEntry` is also the shape
  written to and read back from disk as JSON, not just an in-memory
  type.
- **Naming**: `AgentRunnerKind` is a first draft, not final. Could also
  stay unnamed/inlined on `AgentRunner.kind` directly if a reusable
  exported type isn't wanted.
