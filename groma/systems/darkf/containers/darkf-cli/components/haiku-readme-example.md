---
type: C4 Component
title: Haiku readme example
status: stable
groma:
  id: haiku-readme-example
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/examples/haiku-readme/workflow.ts
    - scanner: typescript
      file: darkf/examples/haiku-readme/scripts/test.ts
      symbol: test
    - scanner: typescript
      file: darkf/examples/haiku-readme/scripts/write.ts
      symbol: write
  group: Example workflows
description: Demo workflow showing a Plan/Implement/Review loop with a stubbed agent runner.
---

Plan (agent) approves a goal, Implement (Write script then Test script, looping on failure) makes the change, and Review (agent) either finishes or sends it back to Write. Uses a hand-written AgentRunner stub instead of a real LLM call, to demonstrate the review/changes_requested loop deterministically.
