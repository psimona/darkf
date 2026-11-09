# darkf

Deterministic automation with LLM agents. The engine for your dark
factory.

darkf runs your automation as a workflow: a typed state graph in plain
TypeScript describing steps and what happens next. Some steps ask an AI
agent to do the work; some steps are plain code. You decide which is
which.

Everything a run does is journaled to disk. Finished, failed, or stuck —
the answer is on disk, not in a terminal you forgot to watch.

When a step fails, the run stops right there, and you see which step and
why. Crashes stay crashes and verdicts stay verdicts — a failing agent
never reaches your routing logic. Retries, timeouts, usage-limit backoff,
cycle limits, and the journal are the engine's job, not your workflow's.

Writing a workflow needs no setup. Describe the steps in plain words and
a skill writes the workflow — best practices included. Every workflow
renders as a mermaid diagram, so the whole path stays visible and you
stay in control.

Two node types, one dispatch contract:

- **agent** — any harness that can take a prompt and write a JSON handoff.
  Shipped adapters: Claude Code and OpenCode; the `AgentRunner` interface
  takes any other.
- **script** — plain TypeScript, run in-process.

Start with one workflow. Grow it into your dark factory.

## Install

Requires [Bun](https://bun.sh). Published on npm as `@psimona/darkf`
(the unscoped `darkf` name is blocked by npm's typosquat filter — the
binary is still `darkf`):

```sh
bun install -g @psimona/darkf
```

The package bundles two agent skills (`darkf-usage`,
`darkf-writing-workflows`). Run `darkf setup` once to install them into
every detected host (Claude Code, OpenCode, codex, gemini, cursor);
`darkf upgrade` re-syncs them after each update.

Full install options — including the sibling-checkout dev setup — in the
[Install guide](https://psimona.github.io/darkf/start-here/install/).

## Quickstart

Run the `haiku-commit` example end to end — one real LLM call, a rendered
mermaid graph, a finished run:

- [Quickstart](https://psimona.github.io/darkf/start-here/quickstart/)
- [Concepts](https://psimona.github.io/darkf/concepts/node-types/)
- [Guides](https://psimona.github.io/darkf/guides/write-your-first-workflow/)
- [CLI reference](https://psimona.github.io/darkf/reference/cli-commands/)

## Development

```sh
bun install
bun run check   # gitleaks + tsc + biome + arch rules + tests
```

## License

[MIT](LICENSE)
