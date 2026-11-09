---
title: Test your workflow
description: Exercising a workflow's routing and retry logic without a real agent.
---

:::note[Coming soon]
Not written yet — a placeholder for a planned advanced guide.
:::

The [Quickstart](../../start-here/quickstart/)'s `haiku-commit` example
wires a real `agentRunner` (`claudeCodeRunner`) directly into
`workflow.ts`, so every `bunx darkf run` costs something. Testing a
workflow's actual logic — does `Check` really route `missing` back to
`Write`, does the loop terminate, does `validate` reject what it should —
shouldn't require a real LLM call every time.

This guide will cover swapping in a stub `AgentRunner`/`ScriptRunner` for
tests (the same pattern the `haiku-readme` example's bundled stub shows),
and what's worth asserting on: the run's `trace`, the final `NodeStatus`,
or the journal itself.
