import { DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { opencodeRunner } from "@psimona/darkf/src/kit/agents/opencode.ts";

// dev-loop — begin → implement → check → review → document → finish(squash) →
// feedback.
//
// The darkf-on-darkf pilot, expanded after its first real run built the CLI
// self-update feature (docs/specs/self-update/). Shape ported from
// blueprint's build-backend: Begin cuts the feature branch, the composite
// bounds the implement/fix/review cycle, Finish squash-merges onto master
// with blueprint's rails, Feedback writes the run retrospective under
// darkf/feedback/.
//
// Run from the target repo root with the released engine from the npm
// registry (never the workspace symlink — doctor's selfRoot guard fails
// inside the checkout; never a source-tarball install — repeated
// install:global runs corrupt bun's global manifest with duplicate
// dependency keys):
//
//   bun install -g @psimona/darkf@latest   # released engine; the working
//                                          # tree's workflow rides the branch
//   darkf validate darkf/workflows/dev-loop
//   darkf start darkf/workflows/dev-loop "message" --allow-dirty-workflow
//
// Editing the FEATURE / RUN_DATE constants at the top of the begin/finish
// scripts and this file's agent prompts is the per-feature contract until
// engine-side input plumbing exists. Resume is the fresh-run semantics: a
// second run on an already-implemented tree verifies and ships it (see the
// Implement prompt). No other git automation: the human curates what the
// workflow leaves behind (spec archive, roadmap entry, feedback note).
//
// The implementer, fixer, reviewer, and documenter are separate dispatches.
// Their only
// shared channels are the repo itself (files, git diff, the spec docs) and
// the one-hop handoff — matching PHILOSOPHY.md: nothing rides along for
// free.

export const agentRunner = opencodeRunner;

const MODEL = "zai-coding-plan/glm-5.3-flash";
const RUN_DATE = "2026-11-09";
const FEATURE = "skill-setup";

export const workflow: WorkflowDef = {
  initial: "Begin",
  states: {
    Begin: {
      type: "script",
      file: "begin.ts",
      retries: 1,
      on: { started: "Loop", branch_failed: DONE },
    },
    Loop: {
      initial: "Implement",
      // The normal path is one cycle (Implement → Check → Review → Document
      // → Finish). Each Fix → Check re-entry costs another. 8 leaves room
      // for two fix rounds including the terminal Document dispatch before
      // the engine calls the run stuck.
      maxCycles: 8,
      states: {
        Implement: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `Implement the ${FEATURE} feature in this repository.

First read docs/specs/${FEATURE}/spec.md. It is the contract: its Decisions and Non-goals sections are locked — implement exactly what they specify, nothing more. The spec is the only contract artifact; no design.md exists for this feature.

Resume semantics: if the working tree already implements part of the spec, verify that part instead of re-implementing. The bundled skills already exist and are final content — darkf/skills/darkf-usage/SKILL.md and darkf/skills/darkf-writing-workflows/SKILL.md. Do not rewrite them. Wire them into setup, doctor, packaging, and the docs move as the spec specifies.

Deliverables (when not already present):
- darkf/src/cli/setup.ts (new): \`darkf setup\` — sync both bundled skills into every detected host's skills dir. Hosts are a table in code per the spec: claude code (~/.claude/skills, binary claude), opencode (~/.opencode/skills, opencode), codex cli (~/.codex/skills, codex), gemini cli (~/.gemini/skills, gemini), cursor (~/.cursor/skills, cursor-agent); a host is detected when its skills dir exists OR its binary is on PATH. Write policy: darkf-* is darkf's namespace — copy when missing; when present, replace the whole dir (copy bundled to a dot-prefixed temp dir inside the skills dir, remove the installed dir, rename into place) so the destination is an exact mirror. States missing/ok/differs per skill. Output: one host-detection line, then one line per host per skill. Creates a missing skills dir (mode 0755) for a detected host; skips an undetected host without creating anything. Exits non-zero when a present host still ends missing/differs after the sync attempt. Takes no flags and no positional args; never prompts.
- \`darkf upgrade\` (darkf/src/cli/update.ts) runs the same sync after self-update, under a "skills:" header, best-effort: a sync failure is reported and exits non-zero but never masks the upgrade itself.
- doctor/validate split in darkf/src/cli/index.ts: \`darkf doctor\` with no ref checks the environment only — agent binaries, cwd sanity, skills section. \`darkf validate <ref>\` inherits the workflow checks doctor has today (resolves, loads, exports, structure), unchanged lines and exit codes. Back-compat: \`darkf doctor <ref>\` prints the new usage and exits 1. The skills section names every known harness: per skill ok/missing/differs for a present harness, \`harness not present\` for an absent one; it writes nothing and exits non-zero only for missing/differs on a present harness, with \`run darkf setup\` as the fix hint. All three (doctor skills section, validate checks, setup sync) share one skills-check function. Fix doctor's stale runner hint while there: "built-ins live in src/agents/" — the real location is src/kit/agents/.
- Daily probe: once per calendar day, the first darkf invocation after the update gate runs a skills-only check via the same shared function. State file per the spec (XDG state semantics like updateStateFile) stores the last probe date; missing or corrupt counts as never probed. Silent when every present harness is ok. On missing/differs, print one compact block (the failing lines plus "fix: run darkf setup") before the invoked command's own output. Never fatal — the probe never changes the invoking command's exit code. \`setup\` and \`upgrade\` skip the probe and refresh the state file.
- Packaging: darkf/package.json gains "files": ["src", "workflows", "skills", "docs"].
- Docs move: move site/src/content/docs/** to darkf/docs/** and rebase the site's content loading onto darkf/docs/ (site/src/content.config.ts, starlight docsLoader — rebase it, or if the loader cannot rebase, a prepack copy with a drift check per the spec). bun run build in site/ must still succeed.
- Tests per the spec's Testing section: setup tests with deps injected like update.ts's UpdateDeps (home, bundledDir, existsBinary) covering host detection by dir alone / by binary / absent, copy and mirror semantics including leftover-file wipe and crashed-temp-dir replacement, state reporting, and exit codes; doctor/validate split tests; daily-probe tests (first-of-day runs, same-day skip, corrupt state file, silent-ok, block-on-failure, exemptions); the tarball smoke check (npm pack, temp-prefix install, run setup/doctor/render and the skill-referenced docs paths).

Follow the existing code style of darkf/src/cli/index.ts and darkf/src/cli/update.ts. Do not commit. Do not touch files outside darkf/src/, darkf/package.json, darkf/skills/, darkf/docs/, site/, and docs/specs/${FEATURE}/.

Finish with event "implemented". If the spec cannot be implemented as written, finish with event "blocked" and put the reason in the output. If a review demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { implemented: "Check", blocked: DONE, disputed: DONE },
        },
        Check: {
          type: "script",
          file: "check.ts",
          retries: 1,
          on: { passed: "Review", failed: "Fix" },
        },
        Fix: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are repairing the ${FEATURE} implementation after a failed gate.

The handoff you received carries either the failing tail of "bun run check" or the reviewer's change list. Read docs/specs/${FEATURE}/spec.md for the contract. Fix the code minimally. Do not redesign. Do not commit. Do not touch files outside darkf/src/, darkf/package.json, darkf/skills/, darkf/docs/, and site/.

Finish with event "fixed". If the failure exposes a spec defect you cannot resolve in code, finish with event "blocked" and the reason. If the demand contradicts the spec, finish with event "disputed" and ground the objection in the spec text.`,
          on: { fixed: "Check", blocked: DONE, disputed: DONE },
        },
        Review: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are an independent reviewer. Do not modify any files.

Verify the working tree against docs/specs/${FEATURE}/spec.md:
- inspect git status --porcelain in addition to git diff — agent-authored new files are invisible to git diff alone
- check the host table matches the spec exactly: five harnesses (claude code, opencode, codex cli, gemini cli, cursor), their skills dirs and binary names, and dir-exists OR binary-on-PATH detection
- check the write policy: darkf-* namespace only, dir replacement not file merge (temp-dir copy, remove, rename), exact-mirror destinations, no flags, no prompts, undetected hosts skipped without dir creation
- check the upgrade sync: runs after self-update under a "skills:" header, best-effort, same code path as setup
- check the doctor/validate split: doctor with no ref = environment only (binaries, cwd sanity, skills section); validate <ref> inherits the workflow checks with unchanged lines and exit codes; doctor <ref> back-compat prints usage and exits 1; the skills section names every known harness with the spec's states and exit rules; the stale "src/agents/" hint is fixed to src/kit/agents/
- check the daily probe: once per calendar day on first invocation after the update gate, skills-only via the shared function, spec state file with missing/corrupt treated as never probed, silent on ok, compact block plus fix hint on missing/differs, never fatal, setup/upgrade exempt and refreshing the state file
- check packaging: package.json files allowlist exactly ["src", "workflows", "skills", "docs"]; docs moved to darkf/docs/; the site still builds from the moved docs (loader rebase or prepack copy with drift check)
- check the bundled skills are byte-unchanged: darkf/skills/darkf-usage/SKILL.md and darkf/skills/darkf-writing-workflows/SKILL.md
- check the tests cover the spec's Testing section: setup deps-injection fixtures, mirror semantics, doctor/validate split, daily probe behaviors, tarball smoke check
- you may run "bun test darkf/src" and "bun run lint" yourself

Approve only if the implementation fulfills the spec. Otherwise list every required change concretely in the output.

Finish with event "approved" or event "changes_requested".`,
          on: { approved: "Document", changes_requested: "Fix" },
        },
        Document: {
          type: "agent",
          agent: { model: MODEL },
          retries: 1,
          prompt: `You are updating user-facing documentation for the ${FEATURE} feature, after an independent review approved the implementation. Do not modify code or tests.

Read docs/specs/${FEATURE}/spec.md (or prd.md/design.md when present) for what the feature does, and run git diff master plus git status --porcelain to see what shipped.

Docs must match the spec when this run lands — drift accumulates one stale page at a time. Update everything the feature's surface touches:
- README.md — CLI flags/commands, plugin behavior, setup steps that changed
- packaged docs under darkf/docs/ — the site renders from these files, so they are the docs:
  - reference/cli-commands.md for any CLI surface change (new command, flag, exit code, default)
  - the guides and concepts pages the feature's surface touches — re-read them and fix stale paths, stale command names, and claims the feature made wrong
  - start-here/install.md when setup, packaging, or install steps changed
- cross-references anywhere in darkf/docs/ or README.md that now point at moved or renamed paths

Do NOT touch: ROADMAP.md, darkf/feedback/, docs/specs/ (the spec archive move and roadmap entry are post-merge human curation), any file under darkf/src/ or darkf-opencode-plugin/.

If nothing user-facing changed and no doc drifted, finish with event "skipped" and put the one-line reason in the output. Otherwise make the edits and finish with event "documented". If the docs cannot be updated (for example the site is broken), finish with event "blocked" and the reason.`,
          on: { documented: "Finish", skipped: "Finish", blocked: DONE },
        },
      },
    },
    Finish: {
      type: "script",
      file: "finish.ts",
      retries: 1,
      on: { merged: "Feedback", merge_failed: DONE },
    },
    Feedback: {
      type: "agent",
      agent: { model: MODEL },
      retries: 1,
      prompt: `Write the run retrospective for the ${FEATURE} dev-loop run, in the style of a post-run feedback note.

Read the newest journal: the run directory under .darkf/run/ with the latest mtime, file journal.jsonl (one JSON event per line). Also run git log -3 --oneline to confirm the merge.

Write darkf/feedback/${RUN_DATE}-${FEATURE}.md with exactly this shape:
- a "# Run feedback — <title>" heading
- bullet fields: Date, Engine/workflow (darkf dev-loop), Run (the runId from the journal), Final outcome, Scopes (one line on what shipped)
- a "## What worked" section — factual bullets only
- a "## Failures and root causes" section — numbered, with cost where visible; write "none observed" if empty
- a "## Notes" section — anything the next run of this workflow should know

Do not modify any other file. Do not commit. Finish with event "recorded". If the journal is unreadable, finish with event "skipped".`,
      on: { recorded: DONE, skipped: DONE },
    },
  },
};
