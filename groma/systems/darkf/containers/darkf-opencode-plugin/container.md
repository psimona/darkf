---
type: C4 Container
title: darkf-opencode-plugin
status: draft
groma:
  id: darkf-opencode-plugin
  parent: darkf
  technology: TypeScript, SolidJS, OpenTUI, OpenCode plugin API
description: OpenCode editor plugin that visualizes live and past darkf workflow runs inside the terminal UI.
---

A SolidJS/OpenTUI plugin for the OpenCode editor (@opencode/plugin, @opentui/solid). Depends on @psimona/darkf as a library (not the CLI) to read run journals, tasks.json, and workflow definitions off disk, and renders a compact always-visible status plus an expandable overlay with a live plan graph, task list, and supervisor-session synopsis for the active run, and a catalog of known workflow definitions.
