# Verify opencode session env var

## Question

opencode issue anomalyco/opencode#15739 ("Propagate session ID to tool
subprocesses via environment variable") was merged via PR #51975
(commit `f109a1c`, 2026-09-29) — shell-tool subprocesses are supposed to
receive `OPENCODE_SESSION_ID`. But the locally installed binary
(`~/.opencode/bin/opencode`, self-reported `1.18.35`, GitHub release tag
`v1.18.35` → commit `4ac0d9c`, published 2026-10-06 — a week after the
merge) shows **no** trace of `OPENCODE_SESSION_ID` anywhere in its
embedded strings, checked two ways (prefix scan of all `OPENCODE_*`
identifiers; a separate `*SESSION*ID*` scan). Unresolved by static
analysis alone — needs a live check: upgrade to current latest
(`1.19.0`, released 2026-10-11) and/or run `env | grep OPENCODE_SESSION`
from a real bash tool call inside a live opencode session, on both the
current and upgraded binary, to find the actual version boundary where
`OPENCODE_SESSION_ID` starts showing up.

This directly gates `search-picker-empty`'s harness-detection design
(see that ticket's Q3/Q4): darkf only claims opencode-session
correlation support from whichever version this check confirms upward —
not from "the PR merged" alone, since the installed build already
postdates the merge by version number and still doesn't show it.

## Type

research

## Blocked by

none — but **deliberately not run yet**. This host currently has a live
darkf run and a live opencode session; `opencode upgrade` changes the
installed binary machine-wide, which risks disrupting both. Run this
once the host is idle (no live darkf/opencode run in progress).

## Status

(unclaimed — intentionally deferred, see Blocked by)
