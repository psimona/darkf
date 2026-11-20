---
type: C4 Component
title: Series-ordering workflow
status: stable
groma:
  id: series-ordering-workflow
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/workflows/series-ordering/workflow.ts
    - scanner: typescript
      file: darkf/workflows/series-ordering/scripts/verify.ts
      symbol: verify
  group: Repo dev-loop automation
  technology: Targets Kotlin/JVM + Gradle repos
description: 'Reference dogfood workflow template: implement, verify, and review an approved bug fix in an external Kotlin/Gradle repo.'
---

Runs against whatever repo it's invoked from (rootDir is the invocation directory). Uses the Claude Code runner against a fully-specified prd.md/design.md pair, with a Verify step confirming the implementation before review. Developed against a real chronological-ordering bug fix; shipped as a reference template in the published package.
