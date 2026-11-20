---
type: C4 Component
title: Types
status: stable
groma:
  id: types
  parent: darkf-cli
  code:
    - scanner: typescript
      file: darkf/src/core/types.ts
    - scanner: typescript
      file: darkf/src/core/index.ts
  group: Workflow model
description: 'Defines the workflow engine''s shared vocabulary: WorkflowDef, state kinds, events, and the agent/script runner interfaces.'
---

The package's core type and API surface, re-exported by the rest of the package via core/index.ts. Defines StateDef (AgentStateDef | ScriptStateDef | CompositeStateDef), WorkflowDef, the DONE/FAILED pseudostate sentinels, NodeResult/NodeEvent, DispatchInfo (what a script or agent runner receives), and the AgentRunner/ScriptRunner interfaces every adapter implements.
