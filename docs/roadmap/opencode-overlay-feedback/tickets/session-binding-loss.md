# Session binding loss

## Question

Opening the darkf overlay today (`tui.tsx:17-19`'s auto-open, or the toggle
in `toggle.tsx`) calls `api.route.navigate(ROUTE_NAME, ...)` — a real route
change, confirmed against `tui.d.ts`'s `TuiPluginApi.route` (one
`current: TuiRouteCurrent`, not a stack). While that route is current,
`store.ts:45-57`'s `currentSessionID(api)` — which gates whether
`locate.ts`'s `ensureBinding` can bind a newly-seen run to a session at all
— returns `undefined`, because it only resolves a session id when
`api.route.current.name === "session"`. `locate.ts:47-60` says bindings are
set once and never rebound. Net effect: any run first detected while the
overlay is open binds with no session, permanently, and `route.tsx:21-27`'s
`backTarget` then sends "back" to `home` instead of to the real chat.

Does switching the overlay from a registered `route` to `api.ui.dialog`
(`TuiDialogStack`) fix this — i.e. does opening a dialog leave
`api.route.current` untouched — and what, if anything, from the current
route-based implementation (the `api.mode.push` + `keymap.registerLayer`
escape-to-close wiring in `route.tsx:183-198`) still needs to be ported vs.
can be dropped because the dialog stack already provides it?

## Type

research

## Blocked by

none

## Status

Claimed by: session-2026-10-13-overlay-feedback
Decided

## Answer

**Switch to `api.ui.dialog.replace`/`clear`, not `api.route.register`/
`navigate`.** Resolved with high confidence from two independent sources,
neither requiring guesswork:

1. **Type contract** (`@opencode-ai/plugin@1.18.35`'s `dist/tui.d.ts`):
   `TuiPluginApi.route` and `TuiPluginApi.ui.dialog` are separate top-level
   properties (`tui.d.ts:472-487`). `TuiDialogStack`'s own shape —
   `replace(render, onClose?)`, `clear()`, `setSize(...)`, `size`, `depth`,
   `open` — never touches route params, and `route.navigate`/
   `route.current`'s own types never mention dialogs. If opening a dialog
   changed `route.current` as a host-internal side effect not expressed in
   the type, that would be an undocumented coupling, not the documented
   contract — possible in principle, not what the API says.
2. **In-repo evidence, not just inference**: `route.tsx:155-171`'s existing
   `Picker` already renders `api.ui.DialogSelect` from *inside* the
   full-screen route's own render tree, and it works today without the
   enclosing route being torn down to show it. That's a live, already-
   shipped case of a dialog composing over currently-displayed content
   rather than requiring a route of its own — the same property this fix
   depends on, just demonstrated one level up (a dialog inside a route)
   rather than the level this ticket needs (a dialog over a route).

**What ports vs. drops**, reasoned from the same type contract:

- `api.mode.push(MODE)` (`route.tsx:183-184`) — ports unchanged. It scopes
  the `darkf.toggle` keybind layer so pressing the toggle's bound key only
  does something while the overlay is open; nothing about switching the
  render host from a route to a dialog changes that need.
- The explicit `keymap.registerLayer({ bindings: [{ key: "escape", ... }] })`
  (`route.tsx:186-197`) for "Back to chat" — likely still needed, not
  provably droppable from the type alone. `TuiDialogProps.onClose` exists,
  consistent with the host calling it on some built-in close gesture, but
  the type gives no guarantee *which* key(s) trigger it or whether it fires
  for a dialog opened via `dialog.replace` (which takes its own `onClose`
  directly) the same way it would for the `Dialog` *component* (which takes
  `onClose` as a prop). Keeping the explicit escape binding costs nothing
  and fails safe; dropping it on an unverified assumption risks a dialog
  that can't be closed by keyboard. Revisit once observed live.
- `backTarget`/`navigateBack` (`route.tsx:21-33`) — the "go back to the
  bound session" logic itself is unaffected (it already `api.route.navigate`s
  to `"session"`, which is correct either way); it just stops needing to be
  reachable *from* a registered darkf route, since there won't be one —
  it becomes the dialog's `onClose`/toggle handler instead of a route-level
  keymap action.
- `onNewRun` (`tui.tsx:17-19`) and the toggle's `onPress` handlers
  (`toggle.tsx:64,74`) — both currently call `api.route.navigate(ROUTE_NAME,
  ...)`; both become `api.ui.dialog.replace(renderFn, onClose)` calls
  instead, with `renderFn` closing over `runId` directly (the dialog
  stack's `replace` takes no params argument the way `route.navigate` did,
  per `TuiDialogStack`'s signature — closure replaces route params here,
  which is a strictly simpler mechanism, not a gap).

**One empirical check carried into implementation** (not blocking this
decision, since both sources above already agree, but worth confirming
before calling the fix verified): from a live session, open the dialog and
read `api.route.current` from inside its render (e.g. a temporary
`api.ui.toast({ message: JSON.stringify(api.route.current) })`) — confirm
it still reports `{ name: "session", params: { sessionID } }`, not
`undefined` or a dialog-specific route name. This is the one fact the whole
fix depends on; everything else above (mode-push, escape handling,
backTarget) is independent of how it comes out.

**Not resolved here, deliberately deferred**: whether `TuiDialogStack`
supports true nested stacking (a second `replace` call while one is already
open) — only matters once **tabbed-overlay-views** wants a search dialog
layered on top of the plan dialog; this ticket only ever opens one dialog
at a time, so it doesn't need an answer. Tracked as fog in the map.

**Implementation note (correction to the mechanism, not the decision)**:
built using the declarative `<api.ui.Dialog>` component rendered
conditionally from the `app` slot, not the imperative
`api.ui.dialog.replace`/`clear` calls sketched above. Same effect (opening
never touches `api.route.current`), and arguably a closer match to the
in-repo precedent this Answer's point 2 already cites (`DialogSelect`
rendered as plain JSX, not pushed through an imperative stack handle) —
see `docs/specs/opencode-overlay-dialog/spec.md`'s Design overview for the
reasoning and the as-built file list. One consequence found only while
implementing: `backTarget`/`navigateBack` turned out to be deletable
outright, not just "ported to a different call site" as guessed above —
since the overlay never leaves the current route, there is no route to
navigate back *to*; closing is just clearing the signal.
