# darkf

A small, typed workflow engine for agent + script state graphs.

darkf runs a workflow — a plain TypeScript object describing states and
transitions — as a sequence of **agent** nodes (an LLM call) and **script**
nodes (a plain function), dispatched through one shared contract. It
journals every step to disk, so "did it finish, and how" is always
answerable from a file, not a live process.

Two node types, one dispatch contract:

- **agent** — any harness that can take a prompt and write a JSON handoff.
  Shipped adapters: Claude Code and OpenCode; the `AgentRunner` interface
  takes any other.
- **script** — plain TypeScript, run in-process.

Crashes stay crashes and verdicts stay verdicts — a failing agent never
reaches your routing logic. Retries, timeouts, cycle limits, and the
journal are the engine's job, not your workflow's.

## Install

Requires [Bun](https://bun.sh). Published on npm as `@psimona/darkf`
(the unscoped `darkf` name is blocked by npm's typosquat filter — the
binary is still `darkf`):

```sh
bun install -g @psimona/darkf
```

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
