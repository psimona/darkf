---
status: approved
feature: dedupe-lint-findings
title: "De-duplicate the confirmed real duplicates from the groma lint review"
priority: low
related: none
---

# De-duplicate lint findings — Design

## Need

`groma lint` (run during architecture curation) flagged 10 possible
duplicate-logic findings. Reviewing each against the actual code, three are
genuine, unexplained duplicates with no stated reason to stay separate; one
more is a lower-value but still real duplicate. The rest (`clampIndex`,
`ensureWatcher`/`ensureTaskWatcher`, the example scripts, `sleep()`,
`isObject`/`isRecord`, `sh()`, `test.ts`/`verify.ts`) were judged intentional
(explicitly commented as deliberate, e.g. `clampIndex`) or too trivial to be
worth a cross-module import, and are explicitly out of scope here.

This is a pure mechanical refactor: extract each duplicated block into one
shared definition, update both call sites to use it, and change nothing
about observable behavior. No new features, no API shape changes.

## Success Criteria

- `toggleOpen` exists once, shared by `run-detail.tsx` and
  `workflows-tab.tsx`, with identical behavior at both call sites.
- The ok/FAIL logging closure used by `validateCmd` and `doctorCmd` in
  `darkf/src/cli/index.ts` exists once.
- `buildPrompt` exists once, in `darkf/src/kit/agents/handoff.ts` (the
  module already documented as "the harness-agnostic half of the
  agent-handoff contract"), and both `claude-code.ts` and `opencode.ts`
  import it instead of defining their own copy.
- (Should-have) `writeProbeState` (`setup.ts`) and `writeState`
  (`update.ts`) share one generic `writeJsonState(file, state)` helper.
- `bun run check` (typecheck, lint, arch-check, tests) passes after each
  extraction, and `darkf/src/*.test.ts` coverage for the touched files is
  unchanged in behavior (same assertions, still green).
- No other lint finding is touched.

## Non-Goals

- Fixing or even re-judging the other 7 lint findings (already reviewed and
  dismissed as intentional or trivial).
- Any change to runtime behavior, CLI output, or the agent-handoff file
  format.
- Introducing a new shared-utils module outside the two components that
  already own the relevant responsibility (`darkf/src/cli/index.ts` for the
  `check` closure; `darkf/src/kit/agents/handoff.ts` for `buildPrompt`; a
  local SolidJS module for `toggleOpen`).

## Architecture

Four independent, unrelated extractions. Each stays inside its current
architectural home (per the groma curation already done):

1. **`toggleOpen`** — darkf-opencode-plugin container, "Overlay" group.
   `run-detail.tsx` and `workflows-tab.tsx` each hold their own
   `[manualOpen, setManualOpen]` signal and their own `isOpen`/`toggleOpen`
   wrappers (not shared state — `workflows-tab.tsx` also has a third,
   `openAll`, that `run-detail.tsx` has no equivalent of). The actual
   duplicate is narrower than the whole ensemble: the 7-line
   Set-copy-and-flip body inside `toggleOpen`. Extract that one pure
   function, `flipInSet<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T>`,
   into a new file `darkf-opencode-plugin/src/path-toggle.ts`. Each file
   keeps its own signal, `isOpen`, and `toggleOpen`/`openAll` wrappers —
   `toggleOpen` becomes `setManualOpen((prev) => flipInSet(prev, path))`;
   `openAll` is untouched (it already adds, never flips).

2. **`check` closure** — darkf-cli container, "CLI commands" group, single
   file. Extract a top-level `makeChecker()` function in
   `darkf/src/cli/index.ts` returning `{ check, failed }` (or similar),
   used by both `validateCmd` and `doctorCmd`. No file move — this is a
   same-file, same-component simplification.

3. **`buildPrompt`** — darkf-cli container, "Agent adapters" group. Move
   the function body into `darkf/src/kit/agents/handoff.ts`, export it,
   and import it from both `claude-code.ts` and `opencode.ts`, deleting the
   two local copies. Its signature
   (`def, handoff, info: { validEvents, hasFallback }, path`) is already
   harness-agnostic — nothing to change about the function itself.

4. **(Should-have) `writeProbeState`/`writeState`** — darkf-cli container,
   "CLI commands" group. Both are `mkdir -p` + `JSON.stringify` + swallow
   errors, over a generic `Record`-shaped state. Extract a module-level
   `writeJsonState<T>(file: string, state: T): void` into a new file
   `darkf/src/cli/state-file.ts`, imported by both `setup.ts` and
   `update.ts`. A new file (not folding one into the other) keeps both
   modules' stated "zero shared mutable state, every dependency injected"
   testability property intact — neither module becomes dependent on the
   other's internals.

## Components and Interfaces

### `darkf-opencode-plugin/src/path-toggle.ts` (new file)

```ts
export function flipInSet<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T>;
```

A pure function, not a signal or a factory: copies `set`, flips `item`'s
membership, returns the copy. `run-detail.tsx` and `workflows-tab.tsx`
each keep their own `createSignal`, `isOpen`, and `toggleOpen`/`openAll`
wrappers exactly as today; only the flip body moves.

### `darkf/src/cli/index.ts` — `makeChecker()` (same file, no export)

```ts
function makeChecker(): {
  check: (label: string, ok: boolean, detail?: string) => void;
  failed: () => boolean;
};
```

Replaces the two local `let fail = false; const check = ...` blocks in
`validateCmd` and `doctorCmd` with one call each. Not exported — both
call sites already live in this file.

### `darkf/src/kit/agents/handoff.ts` — `buildPrompt` (moved, exported)

```ts
export function buildPrompt(
  def: AgentStateDef,
  handoff: NodeResult,
  info: { validEvents: string[]; hasFallback: boolean },
  path: string,
): string;
```

Identical signature and body to the two copies being removed. `claude-code.ts`
and `opencode.ts` import it instead of defining it locally.

### `darkf/src/cli/state-file.ts` (new file) — `writeJsonState`

```ts
export function writeJsonState<T>(file: string, state: T): void;
```

Same `mkdir -p` + `writeFileSync(file, JSON.stringify(state))` wrapped in
try/catch-swallow as both existing copies. `setup.ts`'s `writeProbeState`
and `update.ts`'s `writeState` become thin callers (or are removed
entirely if every call site can call `writeJsonState` directly — decide
per call site during implementation, not a design-level choice).

## Cross-Component Contracts

### Contract 1 — Prompt construction: handoff to agent adapters

- **Owner**: `darkf/src/kit/agents/handoff.ts` (KIT). **Consumers**:
  `claude-code.ts` and `opencode.ts` (KIT).
- **Propagation**: a plain exported function call, `buildPrompt(def,
  handoff, info, path)` → `string`. No change to the function's inputs,
  outputs, or behavior — only its module of residence moves.
- **Wiring point**: both adapters' existing `import { ... } from
  "./handoff.ts"` statement gains `buildPrompt`; the local function
  declaration in each adapter file is deleted.

No cross-component contracts for the other three extractions: `toggleOpen`
(each caller keeps independent local state — no data crosses a component
boundary), the CLI `check` closure (single file, single component), and
`writeJsonState` (a stateless, side-effect-only utility call — the caller
passes its own data in and reads nothing back beyond the call completing).

## Error Handling

No change to error handling in any of the four extractions. Each function
keeps its existing try/catch-swallow (`writeJsonState`, both toggle call
sites have none to begin with) or non-throwing closure behavior
(`makeChecker`) exactly as today — this is a structural move, not a
behavior change.

## Security Considerations

No security-sensitive surface. None of the four extractions touch auth,
secrets, or externally-sourced input; `writeJsonState` writes only
locally-computed, non-sensitive state (a probe timestamp, an update-check
timestamp) to the same on-disk locations its two source functions already
write to today.

## Testing Strategy

- Existing unit tests for the touched files
  (`darkf/src/cli/*.test.ts`, `darkf/src/kit/agents/*.test.ts`,
  `darkf-opencode-plugin/src/*.test.ts`) must still pass unchanged — this
  confirms behavior didn't move. No new test *behavior* is needed since
  nothing new is being specified; add thin coverage only if an extraction
  leaves a function untested that was previously tested only via its call
  site (unlikely, since these are pure refactors of already-tested paths).
- Run `bun run check` after each of the four extractions (not just once at
  the end), so a failure localizes to the one most recent change.

## Risk

Minimal. All four are small, pure, side-effect-light functions already
under test via their call sites. The only way to introduce a behavior
change is importing from the wrong module and creating a circular import
(`handoff.ts` is already a dependency of both `claude-code.ts` and
`opencode.ts`, so adding the export there is the natural direction — no new
edge).
