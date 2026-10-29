# A public docs site for darkf: stack, outline, and guidelines

An investigation, not yet a decision. darkf is heading toward an OSS publish
(a `LICENSE` has already landed; `ROADMAP.md`'s "Distribution outside this
monorepo" item is the other half of that effort). Today's `docs/` folder —
`specs/`, `adr/`, `roadmap/`, `council/` — is internal process documentation:
it explains how darkf's own development decisions got made, not how to use
darkf. This spec proposes a separate, public-facing docs site, hosted on
GitHub Pages, in the vein of docs.strapi.io and ui.shadcn.com: a quickstart,
a concepts section, task guides, and a reference — built from a small static
stack this repo can maintain with the same `bun run check` discipline it
already uses everywhere else. It does not implement anything.

## Problem

Right now, the only way to learn darkf is to read `PHILOSOPHY.md`,
`ROADMAP.md`, and source. That's fine for the one person building it. It
stops being fine the moment anyone outside this repo is expected to install
darkf, write a `workflow.ts`, or pick an agent runner without asking the
author directly. An OSS publish without a docs site just moves the "ask the
author" bottleneck to GitHub issues.

## Goals

- Pick one static-site stack, justified against darkf's actual constraints
  (Bun-first tooling, a Solid.js dependency already in the repo via
  `darkf-opencode-plugin`, no backend, project page on GitHub Pages — not a
  custom domain), not against Strapi's or shadcn's constraints.
- Produce a concrete information-architecture outline for the site — the
  thing a reader opens first — so writing content has a shape to fill
  instead of starting from a blank page.
- State a small set of writing/structure guidelines so pages stay
  consistent as more of them get written later, by the author or by an
  agent.
- Decide where the site's source lives relative to today's `docs/`, and
  name the GitHub Pages deploy mechanics (base path, workflow trigger).

## Non-goals

- **Writing the content.** This spec outlines sections; it does not draft
  the quickstart, concept pages, or reference text.
- **API reference generation tooling** (TypeDoc or similar, to turn
  `darkf-core`'s `types.ts` into reference pages automatically). Named as
  an open decision below, not resolved here.
- **A custom domain.** GitHub Pages' default project-page URL
  (`<org>.github.io/darkf`) is assumed; a custom domain is a DNS decision
  independent of the stack choice.
- **Replacing `docs/specs`/`docs/adr`/`docs/roadmap`/`docs/council`.** Those
  stay exactly as they are — internal, markdown, no site. See Cross-component
  contracts.

## What Strapi and shadcn are actually examples of

Neither reference matters for its specific framework — it matters for the
reading experience it produces, which is what's worth copying:

- **docs.strapi.io** reads as a textbook: quickstart → guides → concepts →
  full reference, with versioned docs and a prominent search box. That shape
  fits a product with a stable public API and multiple versions in the wild.
- **ui.shadcn.com** reads as a cookbook: almost no prose, big copy-pasteable
  code blocks, one page per component/command, a command palette for search.
  That shape fits a tool whose entire value is "here's the snippet, copy it."

darkf is closer to shadcn's shape today — a CLI plus a handful of concepts
(`agent`/`script` nodes, the dispatch contract, the journal) a reader needs
once, then a reference they return to — than to Strapi's versioned-API
shape. That steers both the stack choice and the outline below.

## Candidates considered

All five produce a static site deployable to GitHub Pages; they differ in
weight and fit.

### Docusaurus (React)

Strapi's own apparent choice. Strongest at versioned docs, i18n, and a blog
— none of which darkf needs yet (one version, one language, no blog).
Heaviest build and config surface of the five. Official GitHub Pages deploy
command exists (`docusaurus deploy`) but assumes a GitHub-specific git
remote model. (Written when this repo had no GitHub remote; CI now runs
there.)

### Fumadocs (Next.js)

The framework shadcn's own author has publicly credited as inspiration for
Fumadocs's CLI, and the closest visual match to shadcn's docs aesthetic.
Costs the most to run as a static GitHub Pages site: Next.js needs
`output: "export"`, manual `basePath`/`assetPrefix` wiring for a project-page
subpath, and gives up the App Router features (image optimization, server
actions) that are Next.js's actual reason to exist. Paying for a full React
framework's config surface to get a static folder out the other end is the
wrong trade for a project this size.

### VitePress (Vue)

Zero-config, fast, and the lightest of the four frameworks. Good fit for a
single-version reference site. Pulls in Vue as a dependency for a repo that
has none today (`darkf-opencode-plugin` uses Solid, not Vue) — a new UI
framework with no other use in this codebase, purely for docs.

### mkdocs-material (Python/MkDocs)

Excellent nav/search ergonomics and widely used for OSS tool docs, but a
Python toolchain in a Bun-only monorepo is a second language and a second
package manager for one folder. Rejected on that basis alone.

### Starlight (Astro) — recommended

Content-first: pages are plain Markdown/MDX, sidebar nav auto-generates from
the file tree (or is declared explicitly in `astro.config.mjs`), dark mode
and accessible defaults ship out of the box, and search (Pagefind) is
built in with no third-party service (no Algolia account, no API key to
manage). Astro's component islands support React, Vue, Svelte, **and
Solid** — the one framework darkf already depends on
(`darkf-opencode-plugin`'s `@opentui/solid`) — so an interactive demo
embed, if one is ever wanted, reuses a skill this repo already has instead
of adding a new one. Astro runs fine under Bun (`bun create astro`, `bun x
astro build`). Official first-party GitHub Pages deploy action
(`withastro/action`) exists and documents the project-page `base` setting
directly.

## Recommendation

**Starlight.** It matches `PHILOSOPHY.md`'s own stated bias — "few
configuration knobs," prefer plain structure over DSL/framework
machinery — better than any alternative here: Markdown files plus one
config file, no plugin ecosystem to learn, no second UI framework adopted
solely for docs. If versioning or i18n become real needs later (multiple
published darkf versions in the wild, which "Distribution outside this
monorepo" in `ROADMAP.md` suggests is still open), Starlight has an
official versioning community plugin and built-in i18n — an upgrade path,
not a rewrite. Docusaurus remains the fallback if that future need arrives
sooner than expected and Starlight's versioning story proves too thin.

## Outline

A first information architecture, cookbook-leaning per the comparison
above, four top-level sections:

1. **Start here**
   - What darkf is (one paragraph, the elevator pitch `README`-equivalent
     doesn't exist yet at repo root — this becomes its de facto source)
   - Install (Bun workspace dependency today — see `ROADMAP.md`'s
     distribution note; update this page the day npm publish lands)
   - Quickstart: run the `haiku-readme` example end to end, see a rendered
     mermaid graph and a finished run
2. **Concepts** (one short page each, pulled from `PHILOSOPHY.md`, rewritten
   for a reader who hasn't seen the internal doc)
   - Two node types, one dispatch contract (`agent` vs `script`)
   - Crash vs. verdict (`NodeStatus`, `CrashReason`, why a crash never
     reaches routing)
   - No global context — handoff is one hop, artifacts are explicit
   - The journal (`.darkf/run/<runId>/journal.jsonl`) as the one source of
     truth for "did it finish, and how"
3. **Guides** (task-shaped, shadcn-style: code block first, prose second)
   - Write your first `workflow.ts`
   - Write a script node / custom `scriptRunner`
   - Pick an agent runner (`claudeCodeRunner` vs `opencodeRunner`)
   - Run detached and monitor it (`darkf start`, `darkf status`, `darkf
     monitor`)
   - Render a workflow to mermaid
4. **Reference**
   - CLI commands (`render`, `run`, `start`, `status`, `monitor`) — flags,
     exit codes, what each prints
   - Core types (`WorkflowDef`, `StateDef`, `NodeResult`, `DispatchInfo`) —
     see Open decisions on whether this is hand-written or generated
   - Package map (`darkf-core`/`darkf-engine`/`darkf-cli`/
     `darkf-opencode-plugin`) — one paragraph each, linking to
     `docs/specs/package-boundaries/spec.md`'s outcome once that's decided

A fifth, lower-priority section — **Why** — can host a trimmed,
public-facing cut of `PHILOSOPHY.md` once the above four exist. Not blocking.

## Guidelines

- **Cookbook over textbook, by default.** Lead every guide page with the
  working code block; prose explains it after, not before. Reserve prose-
  first treatment for the Concepts section only.
- **One page, one job.** A guide page answers one task. If a page needs an
  "and also" heading partway through, it's two pages.
- **No invented audience.** Don't write "as a backend developer, you'll
  want to..." — darkf has one real audience so far (someone wiring a
  workflow into their own repo, the way the consumer repo does today).
- **Every code block must run.** Pull examples from `examples/` in
  `darkf-cli` rather than hand-writing snippets that drift from the real
  API.
- **Draft prose with the `ste-writing` skill** before publishing a page —
  it's already in this environment's skill set, built exactly for cutting
  AI-slop tone out of docs/READMEs, and costs nothing extra to invoke.
- **Internal docs stay internal.** A Concepts page may summarize a
  `PHILOSOPHY.md` section; it never links a reader to `docs/adr`,
  `docs/council`, or `docs/roadmap` — those describe how decisions got
  made, not how to use the tool.

## Migration, if Starlight is chosen

- Scaffold a new top-level folder (name an open decision below — `site/`
  avoids colliding with the existing `docs/` meaning) via `bun create astro
  -- --template starlight`.
- Add it to the root `workspaces` array and `package.json` so `bun install`
  covers it from the repo root, same as the other five members — or keep
  it standalone with its own lockfile; see Open decisions.
- Exclude it from `biome.json`'s lint scope and `.dependency-cruiser.mjs`'s
  `arch-check` — it has no runtime code sharing darkf's layering rules, and
  Astro's generated `.astro`/config files aren't meant to pass this repo's
  TS-focused lint config as-is.
- Set `base: "/darkf"` (or the chosen repo name) in `astro.config.mjs` for
  the GitHub Pages project-page subpath.
- Add a `.github/workflows/docs.yml` using `withastro/action` (GitHub
  Actions, not Forgejo — GitHub Pages hosting requires the GitHub-hosted
  Pages deploy action regardless of where CI otherwise runs) triggered on
  pushes to the folder, publishing to the `gh-pages` environment.
- Write `start-here/`'s three pages first — they're the only section
  blocking a reader from bouncing off immediately.

## Cross-component contracts

- The new site folder has no import relationship with `darkf-core`/
  `darkf-engine`/`darkf-cli`/`darkf-opencode-plugin` — it only reads from
  `examples/` as copy-paste source, never as a dependency. Nothing in
  `.dependency-cruiser.mjs`'s existing two rules needs to change.
- `docs/specs/package-boundaries/spec.md`'s outcome changes the Reference
  section's package-map page (names, not structure) whenever that spec is
  decided — not a blocker for starting this one.

## Open decisions

- **Site folder name and location** — `site/`, `docs-site/`, or a
  `darkf-docs` workspace package. Affects the `workspaces` array entry and
  whether it shares the root `bun.lock` or keeps its own.
- **Full workspace member vs. standalone folder with its own lockfile** —
  one `bun install` surface vs. isolating Astro's dependency tree (and its
  own lint/type-check expectations) from the rest of the repo's checks.
- **API reference: hand-written vs. generated.** TypeDoc (or similar) could
  turn `darkf-core/src/types.ts` into reference pages automatically;
  hand-written stays simpler but drifts. Worth revisiting once the Concepts
  and Guides sections exist and the reference is the last gap.
- **Timing relative to the OSS publish and the `package-boundaries` spec.**
  Writing the Reference section's package map before `package-boundaries`
  is decided risks rewriting it once that spec lands — doing docs-site
  scaffolding and Start-here/Concepts/Guides first, Reference last, avoids
  most of that rework.
- **Versioning now or later.** Starlight's versioning story is a community
  plugin, not core — fine to defer until `ROADMAP.md`'s distribution
  question actually produces a second published version in the wild.
