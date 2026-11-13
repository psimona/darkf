---
status: implemented
feature: skill-setup
title: "Skill setup: ship the darkf skills and install them with `darkf setup`"
---

# Skill setup: ship the darkf skills and install them with `darkf setup`

A spec for a new `darkf setup` command, two skills shipped inside the npm
package (`darkf/skills/`), and a command split it forces: `doctor`
becomes environment-only, and its workflow checks move to a new
`darkf validate <ref>`. darkf's landing
page promises "describe the steps in plain words, and a skill writes the
workflow for you". Today that skill ships nowhere: it lives in the
author's private agents repo, symlinked into `~/.opencode/skills/` and
`~/.claude/skills/` by dotfiles. A fresh `bun install -g @psimona/darkf`
user gets no skill at all.

## Problem

- The two skills (`using-darkf`, `writing-darkf-workflows`) are not in
  the repo and not in the published package. Every user except the
  author must find them by hand.
- There is no way to tell whether a host has the skills, or whether an
  installed copy matches what the installed darkf ships.
- The author's dotfiles symlink is now the only installer. Once darkf
  installs skills itself, that symlink is a conflict source: two
  managers owning one path.
- The skills' text carries stale references: `darkf-cli/` paths that
  predate the package merge, skeleton imports pointing at old module
  locations, a deep-reference file that no longer exists, and
  `darkf doctor <ref>` mentions that the doctor/validate split makes
  wrong.

## Success criteria

- The package ships both skills under `darkf/skills/`, renamed to
  `darkf-usage` and `darkf-writing-workflows` so they sort together in
  every host's skill list.
- The published tarball contains exactly `src/`, `workflows/`,
  `skills/`, `docs/` plus the auto-included
  `package.json`/`README`/`LICENSE` — no `examples/`, `bunfig.toml`,
  `tsconfig.json`, or `feedback/`.
- Every doc path a skill references exists inside the package — the
  deep-reference pointers resolve for a global install, offline.
- The site still builds and renders from the packaged docs (loader
  rebase, or the prepack copy with an empty-drift check).
- `darkf setup` installs both skills into every detected skill host in
  one command, creating the host dir when the host itself is present.
- `darkf setup` converges: a missing or stale copy is overwritten with
  the bundled one, every time. Local edits to a `darkf-*` skill do not
  survive a setup or upgrade — the bundled copy is the only source of
  truth, and the `darkf-` prefix is what says the path is darkf's.
- Re-running `darkf setup` is a no-op when installed copies already
  match the bundled ones.
- `darkf setup` is the only writer, and takes no flags: no positional
  args, no `--check`, no `--force`. Checking is `doctor`'s job.
- `darkf doctor` takes no ref and checks the environment only: agent
  binaries, cwd sanity, and skill state per host.
- `darkf validate <ref>` inherits doctor's workflow checks (resolves,
  loads, exports, structure) unchanged.
- `darkf doctor` reports a skills section covering every known
  harness: a present harness reports per skill `ok`, `missing`, or
  `differs`; an absent one reports `harness not present`. It writes
  nothing and exits non-zero only when a present harness has a
  `missing` or `differs` copy — via its existing `FAIL` check-line
  path, with `run darkf setup` as the fix hint.
- `darkf upgrade` runs the same sync after installing the new package
  version, so skills can never be stale relative to the engine they
  teach.
- Once per calendar day, the first darkf invocation runs the skills
  check in the background: silent when every present harness is `ok`,
  a short report only when a copy is `missing` or `differs`. It never
  blocks, never fails, and never changes the invoking command's exit
  code.
- On the author's machines, removing the skills from the agents repo
  and its dotfile symlinks leaves both hosts working, served by
  `darkf setup` copies instead.

## Design

### Canonical source and naming (repo)

The skills move into the darkf checkout:

```
darkf/skills/darkf-usage/SKILL.md
darkf/skills/darkf-writing-workflows/SKILL.md
```

- Packaging switches from "ship everything" to a `files` allowlist in
  the same change:

  ```json
  "files": ["src", "workflows", "skills", "docs"]
  ```

  npm always includes `package.json`, `README`, and `LICENSE` without
  listing them. `main`/`types` point at `src/exports.ts`, so library
  consumers keep working. What drops out: `examples/`, `bunfig.toml`,
  `tsconfig.json`, `feedback/` — dev-only, 21 of today's 55 tarball
  files.
- The allowlist is now the documented mechanism, with a known failure
  mode: a future runtime dir that is not added to `files` silently
  never ships. The tarball smoke test (see Testing) is the tripwire
  for exactly that.

### Packaged docs (the skills' deep reference)

The skills' deep-reference section points at docs that ship **inside
the package**, not at an external site URL — so an installed agent can
read the authoritative guide offline, from the same version it runs
against.

- The user docs move from `site/src/content/docs/**` to `darkf/docs/**`
  — the package becomes the single source of truth. The Astro site
  renders from those same files (content loader rebased onto
  `darkf/docs/`); npm ships them via the `docs` allowlist entry.
- Build-time fallback, if Starlight's `docsLoader` cannot rebase: a
  `prepack` step copies `site/src/content/docs/` into `darkf/docs/`
  for publishing, with a drift check (empty diff) so the two copies
  can never silently diverge. The invariant stands either way: what
  the site renders is what the package ships.
- Skills reference guides by package-relative path, e.g.
  `<package-root>/docs/guides/write-your-first-workflow.md`, with the
  package located via `readlink -f "$(which darkf)"` — works for
  `bun link` checkouts and global installs alike.
- Docs stay agent-readable: plain markdown preferred; MDX components
  only where the site needs them (today: `index.mdx` only).
- Skill body text quotes the short version; the packaged guide is the
  long form. The skill stays under the word budget by pointing, not
  duplicating.
- Renames happen as part of the move; the frontmatter `name` field is
  updated to match the new directory name (hosts validate the pair).
- The skills' stale references are fixed to the current layout in the
  same commit. Audit result (no homelab or private references in
  either skill — hostnames, IPs, usernames, dotfiles, all clean;
  every claim verified against `src/cli/index.ts`, `src/engine/`,
  `src/kit/`):

  - `darkf-cli/workflows/` → `<package-root>/workflows/`
  - `darkf-cli/docs/agent-workflows.md` → that file no longer exists;
    the deep-reference pointer becomes the packaged docs (see Packaged
    docs)
  - skeleton imports → `<abs-path>/src/core/index.ts` and
    `<abs-path>/src/kit/agents/claude-code.ts` (verified: the
    corrected skeleton passes all four doctor workflow checks; the
    skill's current skeleton cannot import at all)
  - `darkf doctor <ref>` mentions → `darkf validate <ref>` (command
    split)
  - using-skill ref resolution: `<cwd>/.darkf/workflows/<ref>` is no
    longer resolved — the real order is path → `<cwd>/darkf/<ref>`
    (project workspace) → shipped workflows
  - using-skill stale-cache gotcha: rewritten — dead cached-`running`
    entries self-classify from the journal today; ambiguity resolves
    with `--run`, not by deleting registry files
  - using-skill resume paragraph: rewritten — no shipped workflow has
    `detect_resume`/`cleanup` nodes; dev-loop resumes at the git level
    (`begin.ts` reuses an existing `feature/<slug>` branch)
  - using-skill exit codes: extended to the full status map (0/1/2/3/
    4/5/6/7), and the `start`/`run` dirty-`darkf/` guard (exit 1,
    `--allow-dirty-workflow` to proceed) is documented

  The scope is path, command, and small-paragraph fixes, plus a full
  prose pass: both skills comply with STE writing — short declarative
  sentences, active voice, no marketing words — which is also the trim
  pass toward the 500-word guideline.

- Drive-by fix, same commit: doctor's runner hint says "built-ins live
  in `src/agents/`" — the real location is `src/kit/agents/`
  (`src/cli/index.ts:267`).
- `resolve`-at-runtime uses the existing `selfRoot()` helper
  (`src/cli/index.ts:94`), the same mechanism `workflows/` resolution
  already uses, so a global install and a sibling checkout both work.

### Host detection

The known harnesses are a table in code — adding one is a row plus a
test fixture, not a feature. Common harnesses at time of writing:

| harness     | skills dir            | detected when                       |
| ----------- | --------------------- | ----------------------------------- |
| claude code | `~/.claude/skills`    | dir exists or `claude` on `PATH`    |
| opencode    | `~/.opencode/skills`  | dir exists or `opencode` on `PATH`  |
| codex cli   | `~/.codex/skills`     | dir exists or `codex` on `PATH`     |
| gemini cli  | `~/.gemini/skills`    | dir exists or `gemini` on `PATH`    |
| cursor      | `~/.cursor/skills`    | dir exists or `cursor-agent` on `PATH` |

- All rows follow the same `SKILL.md` convention (the Agent Skills
  format Claude Code introduced and OpenCode adopted), so one bundled
  layout installs everywhere unchanged. A harness that ignores the
  dir treats the copy as inert files — installation is harmless even
  where support is partial.
- Paths and binary names for codex, gemini, and cursor follow their
  documented personal skills dirs; the build step verifies them
  against each harness's current docs. A harness whose skills support
  or path cannot be confirmed drops from the table rather than
  creating dirs nothing reads.
- The "dir exists" half of the detection rule covers non-`PATH`
  installs: GUI variants, version managers, and custom installs all
  count as present through their own skills dir.
- The dir is created (mode 0755) when the harness is detected but the
  dir does not exist yet — a fresh install has no `skills/` until
  first use.
- An undetected harness reports `harness not present` — informational,
  never a failure. `setup` skips it without creating the dir; `doctor`
  still prints its line, so the skills section always names every
  harness darkf knows about.
- No host config surface (env overrides, custom dirs) — non-goal.

### Install semantics

Per host, per skill, compare the installed dir against the bundled one
(byte equality on `SKILL.md` — the only file either skill has). Three
states, used for reporting and exit codes:

- **missing** — no installed copy (or a partial one: dir without
  `SKILL.md`).
- **ok** — byte-identical to bundled.
- **differs** — present but not byte-identical.

The write policy has one rule, everywhere: **`darkf-*` is darkf's
namespace.** Setup makes every `~/.<host>/skills/darkf-*/` dir match
the bundled copy — copy when missing, overwrite when differs. No
prompts, no `--force`, no ownership probes, no receipts: the prefix is
the ownership record. A file outside the `darkf-*` names is never
read, written, or removed — a foreign skill dir is invisible to
setup.

The write itself is dir replacement, not a file-by-file merge: remove
the installed `darkf-*` dir, then copy the bundled one in fresh. The
destination is an exact mirror of the bundled dir after every sync —
files left behind by an older bundled version, or added by anyone
inside the skill dir, are wiped by the next sync. Nothing inside the
dir survives except what the bundled copy contains.

Consequence, stated plainly: a user who edits an installed
`darkf-*` skill loses the edit on the next setup or upgrade. That is
the point — a stale skill teaches an old workflow API against a new
engine, the exact mismatch this command exists to prevent. Editing
happens in the darkf repo, through review, like any other file.

Mechanically: copy the bundled dir to a dot-prefixed temp dir inside
the skills dir (`.darkf-tmp-<skill>` — hosts ignore dot-dirs when
listing skills), remove the installed dir, then rename the temp dir
into place. The swap is one rename; a crash mid-copy at worst leaves
a dot-prefixed temp dir that the next sync replaces. No state beyond
the skill dirs themselves: presence plus byte equality is the whole
"did setup run" model, and the bundled copy is the source of truth,
so drift is visible and a stale marker file is impossible.

### CLI surface

```
darkf setup           # sync both skills into every detected host
```

Output, one line per host per skill plus a host-detection line:

```
host opencode (~/.opencode/skills)
  darkf-usage               ok
  darkf-writing-workflows   installed
host claude (~/.claude/skills)
  darkf-usage               updated (was stale)
  darkf-writing-workflows   ok
```

- Exit 0 when the sync succeeded (everything `ok`/`installed`/
  `updated`); exit 1 when a copy operation failed.
- `setup` runs after the update gate like every other command, so an
  outdated install is noticed first.
- No positional args, no flags. Read-only state reporting lives in
  `doctor`, not here — one command per verb.

### Upgrade integration

`upgradeCmd` runs the skill sync after the new package version is in
place, printing its output under a `skills:` header. The new package
may ship new skill content; running the sync as part of the upgrade is
what makes "skills never lag the engine" hold by construction instead
of by discipline.

- The sync is best-effort: a failure is reported and exits non-zero,
  but never rolls back or masks the upgrade itself.
- Same code path as `darkf setup` — no second implementation to drift.

### Daily probe on first invocation

Stale skills are invisible until the user thinks to run `doctor`. The
fix follows the update-gate pattern (`updateGate`, `src/cli/index.ts`):
once per calendar day, the first darkf invocation probes the skills
and speaks only when something needs action.

- **Trigger**: every command dispatch, after the update gate. A state
  file — `~/.local/state/darkf/last-skills-check.json` (XDG semantics,
  same scheme as the update gate's state file) — stores the last probe
  date. First invocation whose local calendar date differs from the
  stored one runs the probe; same-day invocations skip it silently.
  Missing or corrupt state file counts as never probed.
- **Scope**: the skills section only — the same per-harness, per-skill
  states doctor renders, via the same shared function. No cwd sanity
  (meaningless for whatever dir the invocation happened to start in),
  no workflow checks.
- **Silent by contract**: when every present harness is `ok`, the
  probe prints nothing. On `missing`/`differs`, it prints one compact
  block — the failing lines plus `fix: run darkf setup` — before the
  invoked command's own output.
- **Never fatal**: the probe's outcome never changes the invoking
  command's exit code or output shape. A slow or erroring probe is
  swallowed; today's run of `darkf start` matters more than the
  report.
- **Exemptions**: `upgrade` (runs the sync itself) and `setup` (just
  wrote the state it would report on) skip the probe. Both refresh the
  state file so the next command starts a fresh day window.
- **Why inline, not detached**: a detached probe can only write to a
  file nobody reads. The check is two stat calls and two byte
  compares — well under a millisecond — so the first invocation of the
  day carries it at no perceptible cost, and the report can actually
  reach a terminal. "Background" here means silent-unless-actionable,
  not a separate process.

### Command split: doctor and validate

Skill checks are machine-level; workflow checks are artifact-level.
Mainstream CLIs keep doctor strictly environmental (`brew doctor`,
`flutter doctor`, `npm doctor` — no target argument) and put
config/artifact checks in a separate verb (`terraform validate`).
darkf follows that split:

```
darkf doctor           # environment only: agent binaries, cwd sanity, skills
darkf validate <ref>   # workflow only: resolves, loads, exports, structure
```

- `doctor` drops its required workflow ref. `darkf doctor` with no
  args is now meaningful on its own — the natural "is this machine
  ready?" — instead of a usage error.
- `validate` inherits the workflow checks from `doctorCmd` unchanged
  (workflow resolution, module load, exports, structure validation),
  including the `usage: darkf validate <ref-or-path>` error when no
  ref is given. The move is mechanical: the code relocates, the
  checks and their output lines stay identical.
- Back-compat: `darkf doctor <ref>` with a ref prints the new
  contract in its usage line (`darkf validate <ref> for workflow
  checks`) and exits 1. The command is young; no silent
  compatibility shim.
- Docs touched: `site/src/content/docs/reference/cli-commands.md`
  gains `validate`; doctor's page section drops the workflow
  examples. (Page list per the docs-site outline; exact copy rides
  the build.)

### Skills check (doctor)

`doctor` is the read-only surface for skill state. It renders a skills
section — one line per known harness, every harness always named —
after the agent binaries check, in the existing `check()` style:

```
ok  skills (opencode) — 2/2 installed
FAIL skills (claude) — darkf-usage differs from bundled — run: darkf setup
```

With claude code absent from the machine, the section instead shows:

```
ok  skills (opencode) — 2/2 installed
ok  skills (claude) — harness not present
```

- A present harness passes (`ok`) only when every `darkf-*` skill is
  byte-identical to bundled. Any `missing` or `differs` copy fails the
  line and so the doctor exit code, reusing the existing
  `check()` → `fail` mechanism — no new exit-code surface.
- `harness not present` always passes: a machine without the harness
  is not a broken machine, and the agent-binaries check already fails
  when a binary is absent. The line exists so the section is
  complete, not to add a second failure signal.
- `doctor` never writes; fixing is always `darkf setup`.
- `validate` does not check skills — a workflow can be sound on a
  machine whose skills are stale; the two verdicts stay independent.

### Author migration (one-time, this repo's own setup)

1. Delete `using-darkf/` and `writing-darkf-workflows/` from
   `workspace/agents/skills/` (the dotfiles-synced repo).
2. Remove the two symlink entries from the dotfiles that create them
   in `~/.opencode/skills/` and `~/.claude/skills/`.
3. Run `darkf setup` from the built checkout — both hosts flip to
   setup-managed copies.
4. The renamed skills appear as new entries (`darkf-usage`,
   `darkf-writing-workflows`); host-side skill caches that key on the
   old names simply see two new skills, nothing dangling.

## Testing

Unit tests for the sync core, deps-injected like `update.ts`
(`SetupDeps` pattern: inject `home`, `bundledDir`, `existsBinary`):

- missing target → copied, byte-identical to bundled
- identical target → untouched, reported ok
- differing target → overwritten, byte-identical to bundled
- destination with extra or leftover files → removed by the sync;
  destination is an exact mirror of bundled afterwards
- dot-prefixed temp dir left by a crashed sync → replaced by the next
  sync, never reported as a skill state
- partial install (dir without `SKILL.md`) → repaired by copy
- foreign skill dir (no `darkf-` prefix) → never read or written
- host dir absent + binary absent → harness skipped as not present
- host dir absent + binary present → dir created, skill copied
- detection by existing dir alone (binary not on `PATH`) → harness
  present
- one table row per known harness; adding a harness to the table is
  covered by the same fixtures
- upgrade runs the sync and prints the `skills:` block
- daily probe: first invocation of a day runs it, second same-day
  invocation skips it (state file injected)
- daily probe: missing or corrupt state file → probe runs
- daily probe: all ok → no output, invoking command's exit code
  unchanged
- daily probe: missing/differs → compact block printed, exit code
  unchanged
- daily probe: `setup` and `upgrade` skip it and refresh the state
  file
- doctor skills section names every known harness; renders ok /
  differs / missing / harness-not-present, writes nothing, and fails
  its exit code only on missing/differs for a present harness
- doctor with no ref runs environment checks only and never loads a
  workflow module
- `doctor <ref>` prints the new usage line and exits 1
- validate inherits the workflow checks: same lines, same exit codes
  as doctor's workflow path today (happy path and each validation
  error kind)
- tarball smoke test: `npm pack` on the package dir, then install the
  tarball into a temp prefix and run `darkf setup`, `darkf doctor`,
  `darkf render <built-in-workflow>`, and every skill-referenced
  `<package-root>/docs/...` path from it — proves the allowlist ships
  every runtime dir (`src`, `workflows`, `skills`, `docs`) and nothing
  the CLI reads was dropped
- site build: `bun run build` in `site/` succeeds with docs read from
  `darkf/docs/` (or the prepack copy in place, with the drift check
  passing)

Fixtures: temp dirs, bundled copy spied from a fixture string — no
dependence on the real `~`.

## Non-goals

- No install (write) side effects on `run`/`start`/`status`/
  `monitor`/`doctor` — only `setup` itself and `upgrade` run the sync.
  The daily probe is the one deliberate behavior change to these
  commands: a read-only skills check on the first invocation of the
  day, silent when everything is `ok`. It writes only its own state
  file, never a skill dir.
- No harnesses beyond the known-harness table. Adding one is a table
  row plus its verified path — not a config surface (no env
  overrides, no custom dirs, no MCP).
- No ownership ledger: no receipts, version stamps, or marker files —
  the `darkf-` prefix is the record.
- No skill-content management beyond shipping (edits happen in the
  repo, through review, like any other file).

## Open questions

(none — the example-refresh question resolved to path-and-command
fixes after the audit; see Design)
