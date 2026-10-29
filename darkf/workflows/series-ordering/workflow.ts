// series-ordering — dogfood workflow: implement + verify + review a bug
// fix in a Kotlin/JVM + Gradle repo (any repo you point it at; developed
// against a real chronological-ordering bug fix).
//
// Uses the built-in claude-code harness (handoff-file contract, session
// resume). rootDir — the agent's working directory and the run-artifact root —
// is the INVOCATION directory, so run from the repo you target:
//   cd /path/to/your-gradle-repo
//   darkf start <this dir> "<bug id>"
import { type AgentRunner, DONE, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";

export const agentRunner: AgentRunner = claudeCodeRunner;

const IMPLEMENT_PROMPT = `You are implementing an approved, fully specified bug fix in the Kotlin/JVM + Gradle repo at your working directory.

If the working tree already contains a partial implementation (a previous attempt), verify and complete it instead of starting over.

Read both spec files first (paths relative to the repo root):
- docs/specs/_implemented/marketdata-series-chronological-order/prd.md (REQ-1..REQ-5, CON-1..CON-3)
- docs/specs/_implemented/marketdata-series-chronological-order/design.md (exact changes, code sketches, test plan)

Implement exactly the design, nothing more:
1. MarketDataPort: add the ordering-contract KDoc (design has the wording).
2. PostgresMarketDataAdapter: ORDER BY asset_id, date, market, currency (quotes); ORDER BY asset_id, date, type (corporate actions).
3. MarketDataMapping: sort before groupBy — quotes compareBy(date, market, currency); corporate actions compareBy(date, type.wireName).
4. Extend existing test classes only (design Testing Strategy):
   - MarketDataMappingTest: shuffled rows read back ascending; equal-date tiebreak cases (quotes and corporate actions).
   - PostgresMarketDataAdapterTest: seed rows in reverse date order, read ascending, read twice identical (DatabaseIntegrationTestBase).
   - ComputePipelineIntegrationTest: multi-date data via its FakeLoaders, pipeline run twice with differently-constructed but ascending list instances, identical nav/marketValue/twr. The test's inputs must both honor the port contract (ascending); do not import marketdata's adapter.outbound.database internals.

Then run ./gradlew check from the repo root; it must pass. If Docker (Testcontainers) is unavailable, run ./gradlew test instead and say so in your report.

Rules: touch only the files the design names; no new files; do NOT commit or stage anything; no code comments.

If a review demand contradicts the spec (prd.md/design.md) or would make a test unable to fail, do NOT silently comply — object. Write your result with event "disputed", the demand you reject, and your spec-grounded rationale in output.

Write your result per the handoff instructions: event "implemented" (done and check green), "blocked" (cannot proceed — reason in output), or "disputed" (review demand contradicts the spec — demand + rationale in output).`;

const REVIEW_PROMPT = `You are reviewing an implementation in the repo at your working directory.

Spec: docs/specs/_implemented/marketdata-series-chronological-order/prd.md and design.md.

Inspect EVERYTHING in the working tree: git diff for tracked files AND git status --porcelain for untracked files — an earlier review missed agent-authored extra files because git diff alone does not show them. Nothing beyond the six files the design names may exist as part of this change.

Check:
1. Every REQ-1..REQ-5 in prd.md is implemented and backed by a test that can actually fail if the production fix is reverted.
2. The diff matches the design change list exactly — no scope creep, no unrelated edits, no extra files.
3. Constraints hold: no REST wire-shape change (CON-1), no schema change (CON-2), no module-boundary violations (CON-3).

Write your result per the handoff instructions: event "done" if it matches the spec, or "changes_requested" with a numbered list of concrete fixes in output.`;

export const workflow: WorkflowDef = {
  initial: "Fix",
  states: {
    Fix: {
      initial: "Implement",
      maxCycles: 8,
      states: {
        Implement: {
          type: "agent",
          retries: 1,
          prompt: IMPLEMENT_PROMPT,
          on: { implemented: "Verify", blocked: DONE, disputed: DONE },
        },
        Verify: {
          type: "script",
          file: "verify.ts",
          on: { green: "Review", red: "Implement" },
        },
      },
    },
    Review: {
      type: "agent",
      retries: 1,
      prompt: REVIEW_PROMPT,
      on: { done: DONE, changes_requested: "Implement" },
    },
  },
};
