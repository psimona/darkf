# Registry mirror outside the repo: durable `.darkf/` beyond a careless `git clean`

**Draft — future work.** This captures the problem as found; it does not
propose a design yet. Not reviewed, not scheduled. A spec for `darkf-cli`'s
registry/journal storage — pure runtime-storage mechanics, no
workflow-authoring content.

## How it came up

Flagged as fog in `docs/roadmap/run-resilience/map.md` during the
`registry-lifecycle` spec: that spec fixed the known cleanup-script wiper
(a workflow bug that swept `.darkf/` on reset), but `.darkf/` itself still
has no backing store beyond the working tree it lives in.

## Problem

`.darkf/` is darkf's own runtime/run-storage directory — registry, run
journals, per-run artifacts — gitignored by design, never checked for
drift (unlike the consumer repo's versioned `darkf/` workflow config,
which `registry-lifecycle`'s dirty-config guard does cover). Nothing
mirrors its contents anywhere else. One careless `git clean -fdx`, a
`rm -rf` of the wrong directory, or a lost/reimaged machine erases every
run's history — registry state, journals, failure records — with no
recovery path. The known wiper (the old cleanup script) is fixed; the
exposure from *any* destructive operation on the working tree is not.

## Open questions (not yet designed)

- **Where does the mirror live?** A fixed location outside the repo
  (e.g. `~/.local/state/darkf/<repo-hash>/`), a separate git repo darkf
  manages itself, or a pluggable sync target (cloud bucket, NFS mount)?
- **What gets mirrored?** Registry only (small, high-value), or registry
  + full journals (larger, but journals are the forensic record RCA and
  `darkf report` depend on)?
- **Write cadence.** Write-through on every registry/journal mutation
  (simplest, some I/O cost per dispatch) vs. periodic snapshot (cheaper,
  can lose the tail of a crashed run)?
- **Multi-repo / multi-machine.** Does one darkf installation's mirror
  need to disambiguate across multiple consumer repos, and does it need
  to be readable from a second machine, or is single-repo/single-machine
  durability the actual bar this effort is solving for?
- **Restore path.** What does recovering a wiped `.darkf/` from the
  mirror look like to the supervisor — automatic on next `darkf status`,
  or an explicit `darkf restore` command?

## Non-goals (tentative — revisit once scoped)

- Not a backup system for the consumer repo's own git history or `darkf/`
  workflow config — those are already versioned.
- Not a sync/collaboration feature (shared live state across supervisors
  watching the same run) unless the multi-machine question above lands
  that way.
