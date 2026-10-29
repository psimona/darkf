# Package boundaries: how many workspace packages should darkf be?

Decided 2026-10-29 in a grill session: **Option D**, merged package named
**`darkf`** (bin `darkf`; the npm name is free, verified 2026-10-29), with
the migration landing **before** the OSS publish
(`docs/specs/oss-publish/spec.md`). Build pending — the investigation
below is left as written.

## Problem

`darkf-cli`'s `package.json` declares two roles at once: a CLI binary
(`bin: darkf`) and a library (`main: src/exports.ts`). Both roles are real
today, not hypothetical:

- `darkf-opencode-plugin` imports `foldJournal`, `stallWarning`, and
  registry helpers `from "darkf-cli"` (`locate.ts`, `store.ts`,
  `digest.ts`). It never touches the CLI binary.
- Workflow authors import `claudeCodeRunner`/`opencodeRunner` from
  `darkf-cli/src/agents/` by relative path, directly into their own
  `workflow.ts` — again, never the binary.
- `item-loop-convention`'s new `item-loop.ts` (`docs/specs/item-loop-convention/spec.md`)
  is the fourth module of this kind: workflow-authoring code that lives in
  a package named `-cli` for historical reasons, not a CLI concern.

A package named `-cli` that most of its real consumers import as a plain
library is confusing. This spec asks whether to fix that, and how far to
go — up to and including one single package for the whole repo.

## Goals

- Decide how many workspace packages darkf should have: one, two, or the
  current five.
- Keep today's enforced layering no matter which option wins: `darkf-core`
  must not import its own consumers; `darkf-engine` must not import
  `darkf-cli`.
- Name the exact migration cost for the consumer repo (the one real external
  consumer today) and for every in-repo import site.
- Decide `darkf-web`'s fate as part of this choice, not as a separate one.

## Non-goals

- **Publishing to npm.** Every package is `"private": true` today. This
  spec does not decide whether, or when, to publish any of them.
- **`darkf-opencode-plugin`'s own internal structure.** Only its placement
  as a workspace member is in scope here.
- **Picking the final package name(s).** Example names below are
  placeholders for the investigation, not a naming decision.

## The current layout, as it actually is

Five workspace packages:

- **`darkf-core`** — `types.ts`, `graph.ts`, `journal.ts`, `mermaid.ts`.
  283 lines across those four files plus `index.ts`. Zero runtime
  dependencies. The shared vocabulary every other package builds on.
- **`darkf-engine`** — `run.ts`, `eventLog.ts`. About 1,100 lines. Depends
  only on `darkf-core`. The interpreter that walks a `WorkflowDef`.
- **`darkf-cli`** — the `darkf` binary (`index.ts`) plus `status.ts`,
  `registry.ts`, `agents/`, and (after this spec's sibling ships)
  `item-loop.ts`. Depends on `darkf-core` and `darkf-engine`.
  `registry.ts` depends only on `darkf-core`, not `darkf-engine` directly
  — worth noting, since it means the "library" half of `darkf-cli` is
  actually one layer thinner than the package it sits in.
- **`darkf-opencode-plugin`** — the opencode TUI integration. Depends on
  `darkf-core` and `darkf-cli`, plus real peer dependencies
  (`@opencode-ai/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js`)
  that exist only for this one integration.
- **`darkf-web`** — a stub. One `package.json`, no source files, no
  consumer.

the consumer repo is the one real external consumer. Its own `package.json`
lists `darkf-core`, `darkf-engine`, and `darkf-cli` as workspace
dependencies, resolved to real symlinks in its `node_modules`. It does not
depend on `darkf-opencode-plugin` or `darkf-web`.

**The one fact that makes every option below safe to compare on equal
footing**: `.dependency-cruiser.mjs`'s two layering rules
(`core-is-a-leaf`, `engine-does-not-import-cli`) match on file **paths**
(`^darkf-core/src`, `^darkf-engine/src`, `^darkf-cli/src`), not on package
boundaries. The same two rules, same severity, same enforcement, work
identically whether `darkf-core`/`darkf-engine`/`darkf-cli` are three
packages or three folders inside one package. Consolidating packages does
not weaken this safety net at all — it only changes `package.json` count,
not what the linter checks.

## Options considered

### Option A — keep five packages

Change nothing. `item-loop.ts` lands in `darkf-cli` as already spec'd.

- **Cost**: zero migration.
- **What stays broken**: the naming mismatch persists, and grows by one
  module every time a new workflow-authoring helper is added to
  `darkf-cli`.

### Option B — extract a thin porcelain package

Split `darkf-cli` in two: a thin `darkf-cli` holding only `index.ts` and
the `bin` entry, and a new package — call it `darkf-kit` for this
investigation — holding `status.ts`, `registry.ts`, `agents/`, and
`item-loop.ts`. `darkf-cli` depends on `darkf-kit`; so does
`darkf-opencode-plugin`; so does every workflow that today reaches into
`agents/` by relative path.

- **Cost**: real but bounded. Three in-repo import sites change
  (`digest.ts`, `locate.ts`, `store.ts` in the opencode plugin); every
  workflow's `agents/` relative import changes; the consumer repo's
  `package.json` gains a fourth workspace entry.
- **Gain**: the name now matches the content on both sides. `darkf-cli`
  really is just the binary; `darkf-kit` really is just the library. No
  change to the proven `core`/`engine` boundary.

### Option C — consolidate everything into one package

One package — call it `darkf` for this investigation — holding
`core/`, `engine/`, `cli/`, `kit/`, and `opencode-plugin/` as subfolders,
with the same file-path-based dependency-cruiser rules enforcing the same
layering. One `package.json`, one version, one `node_modules` tree.

- **Cost**: the largest of the three. the consumer repo's `package.json`
  drops three workspace entries for one. Every workspace-internal import
  that currently crosses a package boundary (`from "darkf-core"`, `from
  "darkf-cli"`) either changes to a subpath import or stays a plain
  relative path, depending on the final internal layout — a real, if
  mechanical, rewrite across both repos.
- **Gain**: removes the naming question entirely, for every current and
  future module, in one move. One `bun install` surface. One license file
  covering one package instead of five (already true in substance, since
  this repo ships one `LICENSE` for all of them — this would make the
  `package.json` layout match that reality). Forces an answer on
  `darkf-web` as a side effect, instead of leaving it to rot.
- **Real downside**: `darkf-opencode-plugin`'s peer dependencies
  (`@opentui/*`, `solid-js`, `@opencode-ai/plugin`) are genuinely optional
  — the consumer repo never needs them. Folding them into one package's
  `package.json` puts TUI-specific dependency entries in front of every
  consumer, including ones that will never import that folder. This is
  the one real argument against going all the way to Option C.

### Option D — consolidate the interpreter and its tooling; keep the TUI plugin separate

The middle option: merge `darkf-core`, `darkf-engine`, `darkf-cli`, and
the `darkf-kit` split from Option B into one package (same name
placeholder, `darkf`). Keep `darkf-opencode-plugin` as its own package,
exactly because its peer dependencies are real and genuinely optional —
the one case in this repo where a separate package buys real isolation,
not just an organizational preference. Delete `darkf-web`: it has no
source and no consumer, and this decision is the natural place to make
that call instead of carrying the stub indefinitely.

- **Cost**: same core/engine/cli/kit migration as Option C, minus the
  opencode-plugin folding (so strictly less migration than Option C).
  the consumer repo's `package.json` drops to one workspace entry, same as
  Option C, since it never depended on `darkf-opencode-plugin` anyway.
- **Gain**: everything Option C gains, minus the one real downside Option
  C has. The opencode plugin's heavier dependencies stay isolated from
  every consumer that doesn't need them — which today is every consumer
  except opencode itself.

## Recommendation

**Option D.** The case for going further than Option B rests entirely on
one fact established above: the dependency-cruiser rules are already
path-based, so merging `core`/`engine`/`cli`/`kit` loses none of today's
enforced safety. The case for stopping short of full Option C rests on one
fact too: `darkf-opencode-plugin` is the only package in this repo with
real, consumer-specific peer dependencies nobody else needs — that is a
genuine reason to keep a package boundary, not an inherited one nobody
re-examined.

This is a recommendation, not a decision this spec makes on its own —
see Open decisions.

## Migration, if Option D is chosen

- Move `darkf-core/src/`, `darkf-engine/src/`, and a thinned
  `darkf-cli/src/` (binary only) plus a new `kit/` folder (`status.ts`,
  `registry.ts`, `agents/`, `item-loop.ts`) under one package's `src/`
  tree, in those four subfolders.
- Update `.dependency-cruiser.mjs`'s three path patterns from
  `^darkf-(core|engine|cli)/src` to the new in-package subfolder paths.
  Same two rules, same severity, new paths only.
- Update the consumer repo/package.json`: three workspace entries
  (`darkf-core`, `darkf-engine`, `darkf-cli`) collapse to one. Update its
  three `node_modules` symlinks accordingly (a `bun install` away, not a
  hand edit).
- Update every in-repo import crossing the old package boundaries
  (`darkf-opencode-plugin`'s `digest.ts`/`locate.ts`/`store.ts`; every
  workflow's `agents/` relative import) to the new subpath or relative
  path.
- Delete `darkf-web`.
- Keep `darkf-opencode-plugin` as its own package, untouched by this
  migration beyond its updated import paths into the merged package.

## Cross-component contracts

- Whatever is decided here, `item-loop.ts` (`docs/specs/item-loop-convention/spec.md`)
  does not block on it — that spec already places `item-loop.ts` in
  `darkf-cli`, matching today's real layout, and moves with the rest of
  the `kit` folder if Option D (or B) is later chosen.
- `darkf-opencode-plugin`'s import surface (`from "darkf-cli"` today)
  changes to whatever package hosts `kit/` once this is decided, by a
  single import-path update per file.

## Open decisions

All resolved 2026-10-29:

- **Option: D.** Merge `core`/`engine`/`cli`/`kit` into one package; keep
  `darkf-opencode-plugin` separate; delete `darkf-web`.
- **Name: `darkf`.** Package, binary, repo, and docs-site URL all carry
  the same string. `darkf-kit` rejected: two names for one thing.
- **Timing: before the OSS publish.** The public repo, the npm squat, and
  the docs-site package map all ship the final shape; npm is published
  once, ever.
