# darkf

A small, typed workflow engine for agent + script state graphs.

darkf runs a workflow — a plain TypeScript object describing states and
transitions — as a sequence of **agent** nodes (an LLM call) and **script**
nodes (a plain function), dispatched through one shared contract. It
journals every step to disk, so "did it finish, and how" is always
answerable from a file, not a live process.

This package carries the whole engine as source: `src/core` (shared
vocabulary), `src/engine` (the dispatch loop), `src/kit` (agent runners,
handoff contract, registry), and `src/cli` (the `darkf` binary). It has
zero runtime dependencies and runs on Bun.

## Install

```sh
bun install -g @psimona/darkf
```

## Docs

<https://psimona.github.io/darkf> — quickstart, concepts, guides, and the
CLI reference.

## License

MIT
