# Run feedback — skill-setup dev-loop

- **Date:** 2026-11-09
- **Engine/workflow:** darkf dev-loop
- **Run:** 853649bd-f470-47dd-8d58-9e5925758bf4
- **Final outcome:** Succeeded. Squash-merged to master as `c9890fc feat: skill-setup (skill-setup)`; branch `feature/skill-setup` deleted.
- **Scopes:** Loop shipped `darkf setup` (skill sync across claude/opencode/codex/gemini/cursor hosts), `darkf upgrade` re-sync, the doctor/validate split, a daily skills probe, a packaging files allowlist, the docs move to `darkf/docs/`, and the two bundled `darkf-*` skills.

## What worked

- Every state passed on the first attempt: Check passed, Review approved, Document documented, Finish merged.
- Review verified independently: `bun test darkf/src` 242 pass 0 fail, `bun run lint` clean, site build 17 pages.
- The five-host table (`darkf/src/cli/setup.ts:30-36`) matches the spec exactly and is pinned by a test.
- Setup, upgrade, doctor, and the daily probe share one code path (`skillsCheck`/`syncAll`), so state cannot drift between them.
- The exact-mirror write policy is proven by tests: leftover-file wipe and crashed-temp replacement.
- The daily probe is silent when all present hosts are ok and never changes the calling command's exit code (tested end-to-end).
- The packaging allowlist is verified offline by a tarball test (`npm pack` top-level set).
- Docs moved to `darkf/docs/`; the site globs the moved docs through the loader rebase and builds 17 pages.
- The prior working tree already carried most of the feature, so the Implement pass was verification plus one missing test fixture — cheap.

## Failures and root causes

None observed. All gates passed on the first attempt. (Secret-scan cost, from the Check tail: gitleaks scanned about 680 MB in 11.7 s.)

## Notes

- This run resumed after a prior run was blocked on a "disputed pre-existing lint gate". The tree already held most of the feature. Next run: before dispatching Implement, inspect the working tree and scope the step to verification or the missing pieces.
- CLI contract changed: workflow checks now live in `darkf validate <ref>`; `darkf doctor` checks the environment only. Update any new docs and prompts to the new split.
- Bundled skill files (`darkf/skills/*/SKILL.md`) were byte-unchanged this run. Treat their content as settled unless a spec changes it.
- Pre-existing staleness left alone on purpose: `docs/agent-workflows.md` still references `src/agents/*` and `darkf/darkf-cli`, which do not match the current `src/kit/` layout. Worth a cleanup run.
- The journal's runId strings vary in spelling across events. Match runs by the run directory name, not by string equality on the journal field.
