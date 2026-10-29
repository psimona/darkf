# Picker lists all runs

## Question

Fix the actually-reported bug: the overlay's picker only ever lists
`store.unboundCandidates()` (`locate.ts:70-72`'s `unboundOf`), which is
nearly always `[]` by the time a human opens it, since every live run
gets *some* binding within ~1s of being detected. "Search always displays
empty." Design fully resolved via grilling on `search-picker-empty`'s
draft spec; this ticket is the standalone, no-new-data-needed half of
that spec.

## Type

task

## Blocked by

none. Needs nothing from **durable-run-session-schema** —
`RegistryEntry.startedAt` and `classifyTerminal` already exist today.
Ships the originally-reported fix fastest, independent of everything else
in this roadmap effort.

## Status

(unclaimed)

## Design (resolved — see `docs/specs/opencode-search-candidates/spec.md`
## for full detail; summarized here for this ticket's own scope)

- **`locate.ts`**: new unfiltered read — `listEntries(projectRoot(directory))`
  directly (not `liveRunEntries`'s filtered subset) — confirmed to return
  every registry entry ever written, live or finished, with no cap or
  pruning (`darkf-cli/src/registry.ts:99`).
- **`overlay.tsx`'s `Picker`**: data source switches to the new unfiltered
  read. Sort key `(isActive, startedAt) desc` — active status is the
  *primary* key, recency only breaks ties within each group (not recency
  alone — an active run must never rank below a just-finished one just
  because its last event happens to be older). Active/inactive status per
  entry still goes through the same defensive `classifyTerminal(journalText,
  isPidAlive(pid))` check `liveRunEntries` already uses, never the
  registry's own cached `status` field alone.
- Row differentiator: reuse the existing `●`/`○` dot convention
  `overlay.tsx`'s `renderNode` already uses for the same active/not
  distinction — no second icon language.
- **Paging**: capped at `PICKER_PAGE_SIZE = 50` per page, sorted before
  slicing. `DialogSelect` has no built-in paging — implement with a
  `page`/`offset` signal on `Picker` and a synthetic trailing row
  (`{ title: "→ more…", value: "__next_page__" }`) appended only when more
  entries exist beyond the current slice; `onSelect` checks for that
  sentinel and advances the offset instead of opening a run. Only the
  *displayed* list is capped — `listEntries` itself is untouched.

## Verification strategy

- Unit test (or a `digest.test.ts`-style fixture test) confirming: given a
  mix of live and finished registry entries, the picker's candidate list
  includes all of them, sorted active-first-then-recent, and a count over
  `PICKER_PAGE_SIZE` produces the `__next_page__` sentinel at the right
  point.
- By hand: with more than one live run and at least one finished run on
  disk, open the picker from an unbound session and confirm every run
  shows up, in the right order, with the right dot.
