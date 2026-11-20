---
type: C4 Component
title: Graph
status: stable
groma:
  id: graph
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/core/graph.ts
  group: Workflow model
description: 'Pure, synchronous structure of a WorkflowDef: validation, registry building, and transition resolution.'
---

No dispatch, no I/O. buildRegistry flattens a WorkflowDef's nested composites into one id-keyed map; validateWorkflow checks a workflow's shape before a run starts; resolveTarget resolves a state's next transition for a given event. Anything that only needs the graph's shape — a renderer, a validator — depends on this, not on the execution engine.
