---
type: C4 Component
title: Dev-loop workflow
status: stable
groma:
  id: dev-loop-workflow
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/workflows/dev-loop/workflow.ts
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/begin.ts
      symbol: begin
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/dispatch.ts
      symbol: dispatch
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/finish.ts
      symbol: finishBranch
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/mark-done.ts
      symbol: markDone
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/validate-plan.ts
      symbol: validatePlan
    - scanner: typescript
      file: darkf/workflows/dev-loop/scripts/test.ts
      symbol: check
  group: Repo dev-loop automation
description: 'darkf''s own self-hosted (darkf-on-darkf) build loop: plans a spec into tasks, then implements, tests, and reviews each one.'
---

Begin cuts the feature branch; PlanPhase has an agent distill a spec under docs/specs/ into a TaskList, validated by a script and persisted to the run's tasks.json; Dispatch (a script) walks the plan one pending task at a time into the Task lane (Implement → Test → (Fix → Test)* → Review → MarkDone), looping back to Dispatch until the plan is exhausted; Document updates user-facing docs; Finish squash-merges onto master; Feedback writes a retrospective under darkf/feedback/. Dispatches through the OpenCode runner. Shipped as a reference template in the published package (package.json files).
