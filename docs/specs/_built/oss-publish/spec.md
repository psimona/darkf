# OSS publish: darkf goes public as github.com/psimona/darkf

**Shipped 2026-10-29.** Two deviations from the plan as written, both
discovered mid-migration:

- **Scoped npm name.** npm's typosquat filter rejects the unscoped `darkf`
  name (too similar to `dargs` — staging and direct publish both refused).
  The package publishes as **`@psimona/darkf`**; the installed binary is
  still `darkf`. All import specifiers and docs use the scoped name.
- **Staged publish, not stubs.** npm's bypass-2FA publish tokens were
  deprecated mid-flight; the release workflow (`release.yml`, triggered by
  `v*` tags) stages the package with a stage-only token and a maintainer
  approves on npmjs.com. The three-stub squat became one real publish.

Also superseded: the Forgejo CI workflow was removed entirely once GitHub
became canonical (this spec's "keep it in-tree" fold), and the public repo
was re-squashed to a single initial-release commit after the npm-name
discovery.

Decisions resolved in a grill session, 2026-10-29. `LICENSE` and the docs
site already exist. `ROADMAP.md`'s "Distribution outside this monorepo"
item stays open, narrowed by this spec. Sequencing is decided: the
`package-boundaries` merge (Option D, one package named `darkf`) lands
**before** this spec's migration, so the public repo ships its final
package shape and npm is published once, ever. What remains open here is
listed under Open decisions.

## Problem

darkf is a private Forgejo repo. Everything needed for a public release
exists — MIT license, public docs site, clean `bun run check`, no secrets —
but no decision has been made about where the public repo lives, what
history it carries, how much of the repo ships, and what happens on npm.
Each delay leaves personal details (LAN hostnames, a home path, a private
model endpoint baked into shipped code) one careless `git push` away from
exposure.

## Decisions

1. **GitHub is the canonical home: `github.com/psimona/darkf`.**
   Forgejo freezes as the private archive of record. All future development
   happens on GitHub, in public, including work-in-progress specs.
2. **The entire repo ships.** Internal process docs (`docs/council/`,
   `docs/roadmap/`, `docs/adr/`, `docs/specs/`) stay in the public repo.
   They show how darkf's decisions get made, which is part of the pitch.
   The public docs site never links them (per the docs-site spec).
3. **Fresh history.** The public repo starts as one commit of the
   post-scrub, post-merge working tree: "darkf 0.3.0 — initial public
   release" (0.3.0 marks the package-boundaries layout break), authored
   `Patrizio Simona <patriziosimona@gmail.com>`. The Forgejo history
   stays private. No tags exist, so nothing else is lost.
4. **npm: squat now, publish once after the merge.** Publish 0.0.1 stub
   packages for `darkf` (the merged package's name per
   `package-boundaries`) and `darkf-opencode-plugin` to claim the names,
   then `npm deprecate` each stub so accidental installs point at GitHub.
   The real publish — the merged `darkf` package plus the plugin, in
   their post-merge shape — follows the `package-boundaries` build. No
   three-package squat: the cli/core/engine names die with the merge.
5. **No default model.** `opencodeRunner`'s private fallback
   model is removed. An unpinned agent state is
   a config crash with a message telling the author to pin
   `agent: { model }`. This finishes the silent → warn → error arc that
   the `silent-model-fallback` fog ticket started. No committed workflow
   in this repo uses `opencodeRunner`, so nothing in-repo breaks.

## Scrub list

Working-tree edits before the squash commit. Paths below are pre-merge
paths; translate them through the package-boundaries layout
(`darkf-cli/src/...` → merged package's `src/cli/...`, and so on):

- `darkf-cli/src/agents/opencode.ts` — delete `DEFAULT_MODEL` and
  `warnUnpinnedModel`; unpinned state crashes with a pin instruction. Drop
  the production-incident text from the warning.
- `ROADMAP.md:25` — the private model string with "a
  self-hosted model".
- `docs/specs/_built/agent-liveness/spec.md:28` — replace the
  the private hostname mention with "the self-hosted model backend".
- `docs/specs/_built/quality-scaffold/spec.md:520` — replace the
  the internal registry hostname with "an internal registry".
- `docs/specs/_built/opencode-visualizer/spec.md:525` — shorten the
  `/home/psimona/...` path.

Accepted as-is: the consumer repo references (narrative context, not a
leak), the Forgejo workflow file (dead weight on GitHub, zero cost),
commit-author identity going forward (the gmail address is the GitHub
login identity). Gitleaks is clean across the full history.

## Migration

In order — the `package-boundaries` merge build precedes step 1 and is
this spec's only prerequisite:

1. Apply the scrub list. Run `bun run check`.
2. Add `.github/workflows/ci.yml` (the Forgejo CI workflow was retired
   with the Forgejo freeze)
   (`bun install --frozen-lockfile` plus the `check` suite).
3. Write the root README: what darkf is, pointer to the docs site, MIT
   license. `start-here/` stays the long-form source.
4. Set the site config: deployed URL is the project page
   `https://psimona.github.io/darkf`; `base: '/darkf'` is already set, set
   `site` per Astro's project-page convention so sitemap and canonical
   URLs resolve under `/darkf/`. Commit the pending `astro.config.mjs`
   change as-is.
5. Create an orphan branch, commit the whole tree as the single initial
   commit, push to the new GitHub repo.
6. Enable GitHub Pages (deploy from Actions). `docs.yml` fires on the
   push; verify the site at `https://psimona.github.io/darkf`.
7. Publish the two npm stubs (`darkf`, `darkf-opencode-plugin`) from a
   scratch directory — stubs are name-and-README packages, not builds of
   the monorepo — and deprecate each with a message pointing at GitHub.
8. Freeze Forgejo: flip it read-only with an archive note pointing at
   GitHub.

## Non-goals

- **The real npm publish.** Chained to `package-boundaries`; this spec
  only reserves the names.
- **darkf-web's purpose.** Stays private at 0.0.0, per the ROADMAP open
  question. Its `private: true` flag keeps it out of any publish.
- **CONTRIBUTING.md, issue templates, governance.** Deferred until a
  second contributor exists.
- **Forgejo Pages or any Pages alternative.** GitHub Pages is decided.

## Cross-component contracts

- `package-boundaries` is decided (Option D, package named `darkf`); its
  build precedes this migration. The real npm publish of the merged
  package follows the merge build. `site/.../install.md` says
  "darkf isn't published to npm yet" and stays accurate until that day;
  update it then — done at publish time, now documenting
  `bun install -g @psimona/darkf`.
- the consumer repo consumes `pack:local` tarballs from a local path and is
  unaffected. Heads-up: if the consumer repo's workflows rely on the opencode
  fallback model, its own pinning becomes its work after it upgrades.
- `docs.yml` keeps requiring GitHub hosting for Pages regardless of where
  day-to-day CI runs; with GitHub canonical, both workflows now run there.

## Open decisions

- **Commit author email** — gmail decided for the initial commit; switch
  to GitHub noreply later if preferred.
- **Merged package version** — 0.3.0 assumed (0.2.0 lineage plus the
  layout break); confirm at merge-build time.
- **Release/tag conventions post-publish** — no tags exist yet; pick a
  convention (plain `vX.Y.Z` tags) at the first post-publish release.
