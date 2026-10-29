# Quality scaffold

A spec for giving darkf the category of tooling the consumer repo already has —
lint, architecture-boundary enforcement, a coverage gate, secret scanning, CI,
whitespace normalization, and a decision-record template — sized for what
darkf actually is today: a four-package Bun/TypeScript workspace with no
linter, no CI, no `.editorconfig`, and two hand-written test files with no
coverage measurement. This is a
repo-root concern, not a subproject one — it spans `darkf-core`,
`darkf-engine`, `darkf-cli`, and `darkf-web` — so it lives at
`docs/specs/quality-scaffold/` rather than under any one subproject's own
`docs/specs/`.

Every tool choice below is a deliberate, smaller substitute for a JVM-specific
mechanism the consumer repo uses (Detekt, ArchUnit, Kover), not a port of it. Where
the consumer repo's version encodes years of an actively-growing hex-module system
(per-layer coverage strategy, whitelisted math libraries, sabotage-exemplar
firing tests), darkf's version is intentionally the smallest thing that
actually enforces the same *category* of rule against a 3-package straight-line
dependency graph. Growing it to match the consumer repo's sophistication is future
work, triggered by darkf actually needing it — not by symmetry with a
reference project.

## The problem

Nothing currently stops a regression that any of the following would have
caught before merge:
- `darkf-core` importing something from `darkf-engine` or `darkf-cli`,
  silently turning today's clean one-directional dependency graph
  (`core → engine → cli`) into a cycle.
- A committed secret (API key, token) in a workflow example or a stray
  `.env`.
- A change that breaks either of the two existing test files
  (`darkf-engine/src/run.test.ts`, `darkf-cli/src/agents/handoff.test.ts`)
  reaching `master` unnoticed, because nothing runs them automatically.
- Inconsistent whitespace/formatting drifting across four independently-owned
  packages with no shared style enforcement.

None of this requires the consumer repo's scale of machinery, but leaving it fully
unenforced stops being tenable already — the two existing test files, the
`step`/`rootDir` threading contracts documented in the agent-handoff spec, and
`PHILOSOPHY.md`'s "no global, accumulating context" boundary are all things a
future change could quietly violate with nothing to say no.

## Success criteria

- `bun run check` (the combined gate script, defined below) exits 0 when run
  against this repo's tree as it stands right after this spec's scaffolding
  lands, with no source changes required to make it pass.
- A deliberate, temporary import from `darkf-core` into `darkf-engine` (or
  any other rule violation listed under **dependency-cruiser rules**) makes
  `bun run arch-check` fail, naming the specific rule that fired.
- A deliberately introduced formatting violation (e.g. inconsistent
  indentation) or a deliberately committed fake-secret-shaped string makes
  `bun run lint` / `bun run secret-scan` fail respectively.
- `.github/workflows/ci.yml` runs the same sequence of scripts a local
  contributor would run via `bun run check`, so a green local run is a
  reliable predictor of a green CI run (modulo the registry-access risk
  noted under **Implementation risks to verify early**).

## Design overview

Six additions, each independent and separately adoptable:

1. **Biome** — lint + format, one tool, one config file (`biome.json`).
2. **dependency-cruiser** — enforces the `core → engine → cli` dependency
   direction and bans import cycles, the direct equivalent of ArchUnit's job
   scaled to this repo's actual (flat, 3-package) shape.
3. **`bun test --coverage`** with per-package thresholds via `bunfig.toml` —
   the equivalent of Kover, without porting the consumer repo's per-hex-layer
   strategy engine, which has nothing to attach to here yet.
4. **gitleaks** — secret scanning, wired as a `check`-gating script exactly
   like the consumer repo's `secretScan` Gradle task.
5. **`.github/workflows/ci.yml`** — one job running every gate above in
   sequence, matching this environment's existing Forgejo-based CI pattern
   (this repo has no remote configured yet, so the workflow is inert until
   one exists — see **Non-goals**).
6. **`.editorconfig`** + **`docs/adr/_template.md`** — direct, unmodified-in-spirit
   ports; no design decision needed for either.

### Why Biome over ESLint(+Prettier)

`PHILOSOPHY.md`'s recurring theme is "few configuration knobs... where
behavior needs to vary, write code, not a new flag/DSL." ESLint+Prettier is
two tools, two config files, and a plugin ecosystem that invites exactly the
kind of accreting-options surface the rest of this repo avoids. Biome is one
binary, one config, lint+format unified, and fast enough to run on every
`check` with no caching layer needed. It cannot do project-aware,
multi-file import-boundary analysis (no ESLint-plugin-boundaries equivalent)
— that gap is exactly what dependency-cruiser is for, kept as a separate tool
on purpose, mirroring the consumer repo's own Detekt/ArchUnit split rather than
collapsing the two concerns into one.

### Why dependency-cruiser over an ESLint import-boundary plugin

Considered `eslint-plugin-boundaries` to fold this into the lint pass. Rejected: it would have forced ESLint back in (Biome doesn't support it), reintroducing the two-tool lint surface Biome was chosen to avoid, just to gain one feature dependency-cruiser already provides standalone with less configuration. dependency-cruiser also produces a dependency graph as a byproduct (`--output-type dot`), which is worth having independent of the lint question — a small, free bonus, not a driver of the decision.

### Why per-package coverage thresholds, not one global number

The consumer repo's `LayerCoverageReportTask` exists because a single global coverage
number can't tell a well-tested domain layer from an untested adapter layer
hiding behind it. darkf doesn't have hex layers, but it does have a real
asymmetry worth preserving, confirmed by actually running `bun test
--coverage` in each package rather than assumed: `darkf-core` has **no test
file of its own** at all (`bun test --coverage` run from inside
`darkf-core/` errors with `0 test files matching...` — it cannot even start);
whatever coverage it shows up with today is incidental, pulled in only
because `darkf-engine`'s test run imports it (`graph.ts`/`index.ts`/`types.ts`
happen to hit 100%, `journal.ts` and `mermaid.ts` sit at 0%, purely as a side
effect of what `run.test.ts` happens to touch). `darkf-engine`'s own files
(`run.ts`, `eventLog.ts`) are the one place with real, intentional test
coverage today: 90.91% lines / 83.33% functions on `run.ts`, 100%/100% on
`eventLog.ts`. `darkf-cli` has exactly one of its three source files under
test (`agents/handoff.ts`, 100%/100%); `index.ts` (71 lines) and
`agents/claude-code.ts` (77 lines) — roughly two-thirds of the package's real
code — have zero coverage. A single repo-wide threshold would either be
meaningless for the two untested packages or block on `darkf-core` before
`darkf-core` even has a test suite to measure. Per-package thresholds in
`bunfig.toml` are the smallest mechanism that preserves this distinction
without porting the consumer repo's layer-classification engine — but see the
concrete baseline numbers and the reporting-scope limitation below, both
taken from the measurement above rather than assumed.

### Why gitleaks only, not gitleaks + trufflehog

The consumer repo runs both because it has years of commit history and a large
enough contributor surface that a second, differently-tuned scanner catches
what the first misses — and it explicitly needs an allowlist for deliberate
sabotage-exemplar test fixtures gitleaks would otherwise flag. darkf has
neither: a short, single-operator history and no sabotage-exemplar test
suite. One scanner is the right-sized start; adding trufflehog as a CI-only
complement is cheap to do later if the contributor surface or history ever
grows enough to justify it, and isn't a "revisit" that requires undoing
anything added now.

## dependency-cruiser rules

Configuration: `.dependency-cruiser.mjs` at repo root, run against `darkf-core/src`, `darkf-engine/src`, `darkf-cli/src`.

Rules, mirroring the consumer repo's `PUBLIC_API_SURFACE`/`ADAPTER_DIRECTION`-style
directional checks but against darkf's actual package graph instead of a hex
module:

- **`no-circular`** — dependency-cruiser's built-in cycle detector, applied
  repo-wide. No package graph in this repo should ever have a cycle; this
  rule is the generic safety net under the two more specific rules below.
- **`core-is-a-leaf`** — nothing under `darkf-core/src` may import from
  `darkf-engine` or `darkf-cli` (by package name, not relative path, so a
  future rename can't silently defeat the rule). `darkf-core` is the shared
  vocabulary (per `ROADMAP.md`); it depending on either consumer would
  invert the graph the consumer repo's `DOMAIN_MODEL_PURITY` rule protects against
  in spirit — the innermost package must not know its own consumers exist.
- **`engine-does-not-import-cli`** — nothing under `darkf-engine/src` may
  import from `darkf-cli`. `darkf-engine` may import `darkf-core` freely
  (already true today, via `workspace:*`).
**Dropped during implementation, not shipped**: a fourth rule,
`no-reaching-into-src`, was drafted to ban importing a sibling workspace
package via a deep relative path (`../../darkf-core/src/types.ts`) instead
of its package name — the one candidate for a `PUBLIC_API_SURFACE`-style
check, since darkf has no private/public package-internal split yet.
Checked directly against the real module graph
(`depcruise ... -T json`) before writing it: dependency-cruiser's rule
engine matches `from`/`to` against each import's *resolved* module path, and
both a relative reach-through and a bare `darkf-core` package import resolve
to the identical absolute file (confirmed: `darkf-cli/src/index.ts` →
`darkf-core/src/index.ts` in the actual cruised graph) — the raw specifier
string as written in source isn't part of what a `from`/`to` path matcher
can see. There's nothing in this rule engine to hang that check on without
a custom reporter, which is more machinery than a repo where every package
today only imports its declared dependency's root export justifies. Revisit
if a package ever needs its `src/` internals genuinely protected from
sibling reach-through.

`darkf-web` is intentionally excluded from every rule above — it has no
source yet (per `ROADMAP.md`, "no decisions made yet on what it's for"), and
writing a rule against an empty package is nothing to enforce. Add it to the
same three checks the moment it gains a `src/` directory; no other change to
this ruleset should be needed.

## Coverage thresholds

Measured baseline (this repo's tree as of this spec, via `bun test
--coverage` run from inside each package):

| Package | Own-file coverage today | Notes |
|---|---|---|
| `darkf-core` | no test suite — `bun test --coverage` errors with `0 test files` | only incidental coverage exists, as a side effect of `darkf-engine`'s test run importing it |
| `darkf-engine` | `run.ts` 90.91% lines / 83.33% funcs; `eventLog.ts` 100%/100% | the one package with a real, intentional test suite today |
| `darkf-cli` | `agents/handoff.ts` 100%/100%; `index.ts` and `agents/claude-code.ts` (148 of the package's 183 real lines) — untested, and **absent from the report entirely** (see limitation below) | one of three source files under test |

Given this, a threshold that starts at the consumer repo-style aspirational numbers
(near-100% for the pure package, a held bar for the tested one) would fail on
`darkf-core` immediately — not a gap the gate should paper over, but not
something this spec can silently assume away either.

**Mechanism, confirmed by running it, not assumed from the docs.**
`bunfig.toml`'s `test.coverageThreshold` is a **flat key** (`0.9` or `{
lines, functions }`), not path-glob-scoped the way an earlier draft of this
spec guessed — Bun's docs (`bun-types/docs/runtime/bunfig.mdx`) confirm this,
and it was verified directly: a single root `bunfig.toml` cannot express
"0.95 for `darkf-core`, 0.85 for `darkf-engine`." The working mechanism is
**one `bunfig.toml` per package**, each run via `bun test --coverage` from
inside that package's own directory — exactly the fallback this spec's first
draft flagged as unverified, now confirmed as the actual (only) path. A
second thing the same verification pass surfaced, not in Bun's docs at all:
threshold enforcement is evaluated **per file**, not against the aggregate
"All files" row — and Bun's default coverage run pulls in every file a
package's tests transitively import, including sibling workspace packages
(`darkf-engine`'s own coverage run reports `../darkf-core/src/*.ts` rows
too). Left alone, this means `darkf-core`'s currently-0%-covered
`journal.ts`/`mermaid.ts` would drag down `darkf-engine`'s own gate on files
`darkf-engine` doesn't own. Each package's `bunfig.toml` therefore sets
`coveragePathIgnorePatterns` to exclude sibling workspace source, so a
package's gate only ever judges its own files:

`darkf-engine/bunfig.toml`:

```toml
[test]
coverage = true
coveragePathIgnorePatterns = ["../darkf-core/**"]
coverageThreshold = { lines = 0.85, functions = 0.80 }
```

`darkf-cli/bunfig.toml`:

```toml
[test]
coverage = true
coveragePathIgnorePatterns = ["../darkf-core/**", "../darkf-engine/**"]
coverageThreshold = { lines = 0.30, functions = 0.30 }
```

`darkf-core` has no `bunfig.toml` yet — it has no test suite, so `bun test
--coverage` run from inside it errors before reaching any threshold check at
all (`0 test files matching...`). Writing darkf-core's first test file is a
prerequisite to gating it, tracked as follow-up work, not scaffolding; the
root `test:coverage` script (see **Cross-component contracts**) runs the
loop over `darkf-engine` and `darkf-cli` only, skipping `darkf-core`
explicitly rather than silently.

Both thresholds above are set at (`darkf-engine`) or below (`darkf-cli`,
rounded down from 100% to the stated floor) today's own-file measured
numbers — confirmed green by actually running `bun test --coverage` in each
package directory after adding its `bunfig.toml`, not calibrated blind.

**Known limitation, confirmed by measurement, not assumed**: Bun's coverage
report only lists files actually imported during the test run — running
`bun test --coverage` in `darkf-cli` today reports 100% because
`agents/handoff.ts` is the only file the one test file touches;
`index.ts` and `agents/claude-code.ts` don't appear in the report at all,
covered or not. A threshold gate built on this report catches regressions in
code that's already exercised — it does **not** catch a wholly-untested file
sitting next to a well-tested one, and doesn't need porting from the consumer repo's
Kover setup to know this: Kover's JaCoCo-based instrumentation reports every
compiled class whether a test touches it or not, which is precisely the
guarantee Bun's default reporting doesn't give here. Accepted for this spec
as a known gap rather than solved: closing it would mean confirming whether
Bun supports an explicit "instrument this whole source glob regardless of
what's imported" mode, which is separate implementation work, not scaffold
wiring.

The `darkf-cli` floor starts low on purpose, not as an oversight — gating
untested code at a high bar the day the gate is introduced would force
either a wave of low-value tests written just to pass CI, or the gate being
disabled entirely the first time it blocks something. Raising it is future
work tracked by whoever adds real `darkf-cli` test coverage, not by this
spec.

## Secret scanning

`.gitleaks.toml` at repo root:

```toml
title = "gitleaks config for darkf"

[extend]
useDefault = true

[allowlist]
paths = [
    '''reference/''',
]
```

No repo-specific *rules* — unlike the consumer repo, darkf's own code has no
sabotage-exemplar fixtures that would otherwise false-positive. One
allowlist entry was needed after all, found by actually running the scan
rather than assumed away: `reference/` vendors external projects (e.g.
the earlier reference project) verbatim for design comparison, and the earlier reference project's own redaction-library
test suite contains 20 deliberate secret-shaped exemplars (fake AWS/GitHub
PAT/Stripe keys, a throwaway RSA private key) — real fixtures in someone
else's already-committed code, not something to fix, and not darkf's own
code either. Add further entries only if a real false positive shows up in
darkf's own packages, not preemptively.

Wired as a root `package.json` script (`secret-scan`), gated in CI. Requires
the `gitleaks` binary to be present — same as the consumer repo, this is a separate
binary install (curl release / system package manager), not an npm
dependency, since gitleaks is a standalone Go tool with no meaningful JS
wrapper.

## CI

`.github/workflows/ci.yml`, one job, matching the consumer repo's step-sequencing
approach (fail fast on cheap checks before expensive ones) but with no JDK
setup and no per-stage split (darkf has no integration-vs-unit distinction
yet — see **Non-goals**):

```yaml
name: CI

on:
  push:
    branches: [master, feature/*]
  pull_request:
    branches: [master]
  workflow_dispatch:

jobs:
  build:
    runs-on: docker
    container:
      image: oven/bun:1

    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Install gitleaks
        run: |
          curl -fsSL -o /tmp/gitleaks.tgz https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz
          tar xzf /tmp/gitleaks.tgz -C /usr/local/bin gitleaks && chmod +x /usr/local/bin/gitleaks

      - name: Secret scan
        run: bun run secret-scan

      - name: Typecheck
        run: bun run typecheck

      - name: Lint + format check
        run: bun run lint

      - name: Architecture boundaries
        run: bun run arch-check

      - name: Test + coverage
        run: bun run test:coverage
```

Root `package.json` gains a `check` script (`bun run secret-scan && bun run
typecheck && bun run lint && bun run arch-check && bun run test:coverage`) —
the local equivalent of the consumer repo's `./gradlew check`, so a contributor can
run the exact CI gate sequence before pushing, and CI's own job body could
collapse to that single script once it's proven out (kept as separate steps
above for now, so a failure's log location is obvious without extra
`-v`/verbosity flags).

`master`, matching this repo's actual current branch (confirmed via `git
branch`) — not to be assumed as `main` by copying a generic default.

## `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
tab_width = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

2-space indent (TS/JS/JSON convention) instead of the consumer repo's 4 (Kotlin
convention) — the one value in the whole file that should differ, everything
else copied as-is since it's language-agnostic (LF endings, final newline,
UTF-8, markdown's trailing-whitespace exception for hard line breaks).

## `docs/adr/_template.md`

Adopted verbatim from the consumer repo — the MADR template is generic, not
JVM-specific, and there's no darkf-specific reason to change its shape. No
ADRs exist yet in darkf; this just makes the template available the first
time one is needed.

## Cross-component contracts

- **Root `package.json`** gains `devDependencies` (`@biomejs/biome`,
  `dependency-cruiser`, `typescript@^5` — the last pinned below `<7.0.0` for
  dependency-cruiser compatibility, see **Implementation risks — resolved
  during implementation**) and `scripts` (`lint`, `lint:fix`, `typecheck`,
  `arch-check`, `test:coverage`, `secret-scan`, `check`).
- **New root-level config files**: `biome.json`, `.dependency-cruiser.mjs`,
  `.gitleaks.toml`, `.editorconfig`, `docs/adr/_template.md`,
  `.github/workflows/ci.yml`.
- **New per-package config files**: `darkf-engine/bunfig.toml`,
  `darkf-cli/bunfig.toml` (see **Coverage thresholds**). `darkf-core` gets
  one only once it has its own test suite.
- **`darkf-core`, `darkf-engine`, `darkf-cli`** — no *behavioral* source
  changes, but each package's existing source did change once, mechanically:
  a one-time `biome check --write .` reformatting pass (whitespace/line-break
  only, applied repo-wide to establish the formatting baseline this gate
  enforces going forward) plus one real fix it surfaced,
  an actually-unused `readFile` import removed from
  `darkf-cli/src/agents/handoff.test.ts`. Nothing else in any package's logic
  changed. `darkf-web` is excluded from the arch-check and coverage rules
  until it has a `src/` directory (see above).
- **No change to `darkf-core/types.ts`'s exported shapes, `darkf-engine/run.ts`'s
  logic, or any runtime behavior** — everything in this spec is dev-time/CI
  tooling; it cannot affect what a workflow run actually does.

## Non-goals

- **No per-layer coverage strategy engine.** darkf's package graph is a
  3-node line, not a hex-per-module structure; a flat per-package floor is
  the honest equivalent, not a placeholder for something more elaborate to
  be built later. Revisit only if darkf's module shape actually grows
  hex-like structure worth classifying.
- **No `quality/manifest.json` requirement-traceability file.** That
  artifact exists in the consumer repo because of its `build-backend-deterministic-quality-rules`
  reference pack and REQ-numbered requirement tracking; darkf isn't running
  that workflow, so the file would map requirement IDs to nothing.
- **No `AGENTS.md`.** `PHILOSOPHY.md` already does this repo's version of
  that job (recorded design principles); the one piece of the consumer repo's
  `AGENTS.md` with no existing darkf equivalent — the temp-file-location
  convention — is small enough to fold into `PHILOSOPHY.md` or a `CLAUDE.md`
  later if it ever becomes a live problem, not worth a new file today.
- **No `.gitattributes`.** The consumer repo's exists solely for Git LFS on CSV
  fixtures; darkf has no large binary fixtures of any kind.
- **No trufflehog.** See rationale above — cheap to add later, not a gap
  that blocks this spec from being complete on its own.
- **No integration-vs-unit test split, no `--includeIntegration`-style
  flag.** darkf has exactly one test file today
  (`darkf-engine/src/run.test.ts`); inventing a two-tier test-tagging scheme
  ahead of there being a second tier to tag is exactly the kind of
  speculative machinery `PHILOSOPHY.md` argues against.
- **No enabling/registering the Forgejo remote itself.** This spec adds the
  workflow file; it does not create, configure, or push to any remote — the
  workflow simply won't run until this repo has one, same as it would sit
  inert in any repo with Actions/CI disabled.

## Verification strategy

- **dependency-cruiser rules**: add one deliberate, temporary violation of
  each rule (e.g. a throwaway `import` from `darkf-core` into
  `darkf-engine`) locally, confirm `bun run arch-check` fails with a message
  naming the correct rule, then revert the violation — the same
  "prove the rule fires" discipline the consumer repo's ArchUnit sabotage tests use,
  scaled down to a manual one-time check rather than a permanent test suite
  (no `arch/sabotage` package needed at this size).
- **Coverage thresholds**: run `bun run test:coverage` once as-is to confirm
  the initial numbers above are at or below whichever package's current
  actual coverage, so the gate starts green — not calibrated blind.
- **gitleaks**: run `bun run secret-scan` once against the current tree
  (expected clean) before wiring it into CI, so a false positive is caught
  locally first, not as a surprise CI failure blocking an unrelated PR.
- **CI workflow**: cannot be verified by running it (no Forgejo remote
  configured — see Non-goals); verify by running every underlying script
  (`secret-scan`, `typecheck`, `lint`, `arch-check`, `test:coverage`)
  locally in the same sequence the workflow specifies, confirming each
  exits 0 on the current tree before the workflow file is trusted.

## Security considerations

No new runtime trust boundary — every addition here is a dev-time or CI-time
check, none of it ships in any built artifact or runs as part of a darkf
workflow execution. The one thing worth naming: `.github/workflows/ci.yml`
runs `bun install` inside CI, which executes arbitrary package `postinstall`
scripts from the dependency tree exactly as any `bun install`/`npm install`
already does in any environment — this spec doesn't add that risk, it's
pre-existing to using a package manager at all, and out of scope here.

## Implementation risks — resolved during implementation

Both items this spec originally flagged as needing verification were checked
by actually running the tools against this repo, not assumed:

- **`bunfig.toml` coverage-threshold scoping**: resolved — see **Coverage
  thresholds** above. Not glob-scoped from a root file; one `bunfig.toml` per
  package, with `coveragePathIgnorePatterns` to keep each package's gate
  from being dragged down (or padded) by sibling workspace files.
- **Biome's TypeScript support surface**: resolved — Biome 2.5.12 handles
  `tsconfig.base.json`'s `moduleResolution: "Bundler"` and
  `allowImportingTsExtensions` with no false positives. `biome check .`
  needed one repo-wide `--write` pass to establish a formatting baseline
  (11 files reformatted, 0 semantic changes) plus two small source fixes
  unrelated to formatting: an actually-unused `readFile` import in
  `darkf-cli/src/agents/handoff.test.ts`, and `style/noNonNullAssertion`
  turned off repo-wide in `biome.json` — this repo's existing code uses `!`
  deliberately in three provably-safe spots (`run.ts:120`, `run.ts:179`,
  `examples/article-classifier/scripts/queue.ts:22`), all reached only after
  a bounds check; rewriting working code to dodge a style rule the day a
  linter is introduced isn't a fix, it's busywork.

One new, unflagged compatibility issue surfaced only by actually running
dependency-cruiser: it requires `typescript: >=2.0.0 <7.0.0` to parse `.ts`
files at all (confirmed via `depcruise --info`); this repo initially picked
up `typescript@7.0.2` (today's default `bun add` resolution), under which
dependency-cruiser silently found zero modules to analyze — no error, just
an empty graph, which would have made `arch-check` a no-op that always
"passes." Pinned to `typescript@^5` instead, confirmed by re-running
`arch-check` and seeing the real 19-module, 35-dependency graph. Revisit the
pin once dependency-cruiser publishes support for TypeScript 7's API.

## Implementation risks to verify early

Still open — this repo has no Forgejo remote configured, so it cannot be
checked from here (see **Non-goals**):

- **Whether the Forgejo runner can pull `oven/bun:1` from Docker Hub at
  all.** The consumer repo's own CI workflow pulls its base image from an internal
  mirror, not a public registry —
  that choice implies this environment's runners may sit behind a network
  boundary without unrestricted public-registry access. This spec assumes
  `oven/bun:1` is reachable; if it isn't, the fallback is either an internal
  mirror of the same image or installing Bun manually inside the consumer repo's own
  base image, same pattern it already uses for the JDK.
