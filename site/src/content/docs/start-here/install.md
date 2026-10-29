---
title: Install
description: Install the darkf CLI and add darkf to a project.
---

darkf publishes to npm as **`@psimona/darkf`** (the unscoped `darkf` name
is blocked by npm's typosquat filter). The binary it installs is `darkf`.

## Global install

Requires [Bun](https://bun.sh) — darkf ships as source and runs on the Bun
runtime:

```sh
bun install -g @psimona/darkf
darkf --help
```

## Add to a Bun project

```sh
bun add @psimona/darkf
```

Workflow files import the API by deep path:

```ts
import { EXIT, type WorkflowDef } from "@psimona/darkf/src/core/index.ts";
import { claudeCodeRunner } from "@psimona/darkf/src/kit/agents/claude-code.ts";
```

## Sibling checkout (development)

To track darkf's source live instead of a published version, clone the
repo next to your project and depend on the folder:

```sh
git clone https://github.com/psimona/darkf ../darkf
```

```json
{
  "workspaces": ["../darkf/darkf"],
  "dependencies": {
    "@psimona/darkf": "workspace:*"
  }
}
```

Two different directories named `darkf` show up here — don't conflate them:
`../darkf` above is the clone of this repo; `darkf/my-workflow` is a
directory *inside your own project*, holding your own workflow config.
(A third, `.darkf/`, dot-prefixed, is darkf's runtime directory inside your
project — gitignore that one; never gitignore `darkf/`.)
