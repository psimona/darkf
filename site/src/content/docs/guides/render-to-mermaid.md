---
title: Render a workflow to mermaid
description: See a workflow's shape before — or while — it runs.
---

```sh
bunx darkf render my-workflow
```

prints a mermaid `stateDiagram-v2` block straight to stdout — paste it into
any mermaid-aware viewer (GitHub renders mermaid code blocks natively) to
see the graph. This reads only `workflow.ts`; it never runs anything, so
it's safe to use on a workflow that calls a real paid agent.

Every `darkf run` also writes `.darkf/last-run.mmd` next to the workflow —
the same render, with the trace's last-visited state highlighted. That
file is what the quickstart's diagram in this site was generated from.

The mermaid definition is a render target, never a parsed input — darkf
never reads a `.mmd` file back as a workflow. The `WorkflowDef` object in
`workflow.ts` is the only source of truth; mermaid is strictly one-way,
generated from it.
