# Demo visibility: a self-healing build→test→fix loop, recorded from a replay

A design draft, not yet a decision on every point — see **Open
decisions**.

## The problem

`docs/start-here/quickstart.md` has carried a literal placeholder for
months: "Screenshot coming soon — OpenCode plugin status pane." There
is no shareable asset that shows darkf doing the one thing a reader
immediately recognizes as valuable: a workflow that builds, tests,
diagnoses a real failure, fixes it, and converges — bounded by the
same jidoka backstop (`maxCycles`) that stops the line and reports
if it *can't* converge, rather than looping forever.

Recording that live, directly off one real run against a real
project, isn't repeatable. Agent timing varies every take, a real
build→test→fix loop can take minutes, and a bad take means re-spending
real API cost and wall-clock to try again. There is no way today to
capture a finished run and play it back through the visualizer
deterministically, so "get a clean recording" and "run the real thing"
are stuck as the same expensive action.

## Goals

- A build→test→RCA→fix loop workflow pattern: `Build` (script) →
  `Test` (script, `green` → done, `red` → `RCA`) → `RCA` (agent,
  diagnoses the failure) → `Fix` (agent, applies a patch) → back to
  `Build`, wrapped in a composite with `maxCycles`. Authored by
  running the `darkf-writing-workflows` skill against a plain-language
  description of this loop — not hand-written — the same path a real
  user would take.
- One real run of that pattern against a real pet project, watched
  live end-to-end in the already-built, unmodified OpenCode plugin
  visualizer (`docs/specs/_built/opencode-visualizer`) — band, sidebar,
  and the auto-opened full route — from the moment the run starts to
  the moment it finishes or hits its cycle limit.
- A way to save, from that one real run, exactly what's needed to
  reproduce the same visual sequence later, with no agent re-dispatch
  and no re-running the build/test commands.
- A way to replay that saved sequence through the same visualizer, at
  a chosen pace, as many times as it takes to get a clean recording —
  indistinguishable to the plugin from a live run, since the plugin
  only ever reads the journal and the registry.
- Fill `quickstart.md`'s placeholder with the resulting recording.

## Non-goals

- **A new live-visualization feature.** `opencode-visualizer` already
  renders composites, cycle counts, and crash reasons; this spec reuses
  it unmodified. If this workflow's shape turns out to need a
  visualizer change, that's a follow-up to *that* spec, not this one.
- **Full-fidelity log replay.** v1 replays only the journal's
  state-graph transitions — the same information the live plugin
  already shows. Replaying actual terminal/stdout output (build logs,
  test output, agent tool calls) is a materially larger, separate
  scope.
- **Resuming a crashed run.** That's `resume-from-journal` — continuing
  real execution forward. Replay never continues anything; it only
  redisplays a run that already finished, for an audience that was
  never there.
- **Picking the pet project, or the build/test commands.** Supplied as
  parameters when the demo is actually recorded, not a decision this
  spec makes.
- **Publishing or posting the recording.** Covered by
  `visibility-sharing-and-indexing`'s follow-ups.

## Design sketch

### The workflow

A composite loop, same shape as the existing `article-classifier`
example (a composite wrapping a cycle, `maxCycles` as the safety net —
see `PHILOSOPHY.md`'s "Jidoka, not full autonomy"):

```
Loop (composite, maxCycles: N):
  Build  (script)  -> Test
  Test   (script)  on: { green: DONE, red: "RCA" }
  RCA    (agent)   -> Fix        # reads Test's captured failure output
  Fix    (agent)   -> Build      # applies a patch, loops back
```

`maxCycles` is the demo's actual thesis, not an incidental safety
limit: if the loop can't converge, the run ends in a `cycle-limit`
crash and reports exactly where it got stuck — the same stop-the-line
behavior `README.md` and the docs homepage now describe in prose. A
clean convergence and a clean stop are both worth showing; which one
the recorded take gets depends on what the pet project's seeded
failure actually needs.

Final directory name and exact prompts are an authoring detail for
whoever runs `darkf-writing-workflows` against this description, not
locked here.

### Artifact capture — what "necessary to replay" means

- The run's `journal.jsonl` — already written, unconditionally, by
  every run. No new capture needed for this part.
- A frozen copy of the `workflow.ts` that produced it. The live plugin
  needs the actual workflow module to build the graph it renders
  (`buildRegistry`, per `opencode-visualizer`'s own data-mapping
  design) — the journal alone isn't enough to redraw the tree.
- A new bundling step, `darkf snapshot <runId>`, writing
  `.darkf/replay/<runId>/{journal.jsonl, workflow.ts, meta.json}`.
  `meta.json` carries the original workflow directory path, for
  provenance — v1's replay never re-resolves or re-executes anything
  from it (see Non-goals).

### Replay + record

A new CLI command, `darkf replay <bundle> [--run <newRunId>] [--speed
<n>]` — deliberately **not** a `WorkflowDef`. It dispatches nothing,
so modeling it as agent/script nodes would be fake plumbing wrapped
around a single linear file read.

- Reads the bundled `journal.jsonl` in original order and re-emits
  each line to a **new** `.darkf/run/<newRunId>/journal.jsonl` (a
  fresh run id, so replay never collides with or mutates the original
  run), plus a matching registry entry — the same shape `locate.ts`'s
  `liveRunEntries` already looks for, `workflowDir` pointed at the
  bundle's frozen `workflow.ts`.
- Paces the re-emission from the **deltas between the original
  events' own timestamps**, scaled to fit `--speed`'s target —  so the
  replay reads like a real run compressed, not a uniform metronome.
- The OpenCode plugin needs zero changes: it only ever polls/watches
  `.darkf/registry/*.json` and `.darkf/run/*/journal.jsonl`
  (`opencode-visualizer`'s **Refresh** design). A replay that writes
  those same files the same way *is*, to the plugin, a live run. This
  is "the journal is the durable record; nothing else needs to be"
  (`PHILOSOPHY.md`), applied to presentation instead of resume.
- Recording itself (asciinema/screen capture while `darkf replay` runs
  with the plugin open) is an operator action, not a deliverable of
  this spec — same boundary as "posting" in
  `visibility-sharing-and-indexing`.

## Open decisions

- **Pacing model.** A fixed target duration (always compress to, say,
  ~30s regardless of the real run's length) versus a fixed speed
  multiplier (always `10x`, whatever that yields). Leaning
  target-duration: the demo's length is the actual constraint, and a
  multiplier doesn't guarantee hitting it.
- **Replay provenance in the journal.** Should a replayed run's begin
  marker carry `replayedFrom: <runId>`, mirroring
  `resume-from-journal`'s planned `resumedFrom`? Leaning yes — cheap,
  and keeps `.darkf/run/` honest about which entries are real runs
  versus redisplays, if anyone later greps it.
- **Where `darkf replay` lives.** Leaning: a new `darkf-cli` command
  alongside `start`/`run`/`status`/`monitor`/`report` — no competing
  design surfaced.
- **Re-executing script/agent steps during replay.** Confirmed
  non-goal for v1 (see above). Revisit only if a future demo wants
  replay to also re-run the original build/test commands live for
  extra authenticity — a materially bigger scope than this spec takes
  on.

## Dependencies

- `opencode-visualizer` (built) — the rendering surface this spec
  reuses unmodified; replay's entire design rests on it needing no
  changes.
- `darkf-writing-workflows` skill — authors the build→test→RCA→fix
  loop workflow.
- Loosely related to `resume-from-journal` (open) — same
  journal-centric family of ideas, different purpose (continuing
  execution vs. redisplaying a finished run). Worth a cross-reference
  so the two don't duplicate design later; not a hard dependency
  either direction.

## Verification

- `darkf replay` against a captured fixture journal: assert the new
  run's journal is the same sequence of events (same `state`/`status`
  payloads), only `runId` and timestamps differing.
- Manual: run the real build→test→RCA→fix workflow once against a pet
  project with a seeded failing test; confirm it diagnoses and fixes
  it within `maxCycles` (or cleanly crashes with `cycle-limit` if it
  doesn't); snapshot it; replay it with the OpenCode plugin open;
  confirm the band/sidebar/full route show the identical sequence a
  live run would have shown.

## Success criteria

- `quickstart.md`'s "Screenshot coming soon" placeholder is replaced
  with a real recording.
- The recording can be regenerated from the same snapshot, any number
  of times, without spending further API cost or re-running the real
  build/test commands.
