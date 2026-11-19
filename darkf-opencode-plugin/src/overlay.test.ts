import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import {
  closeOverlay,
  initialTab,
  initOverlay,
  openOverlay,
  PANEL_NAME,
  panelCloseCommand,
  registerOverlayPanel,
} from "./overlay.tsx";
import type { LiveStore } from "./store.ts";

describe("initialTab — r3: `workflows` is the default with no active run", () => {
  test("no runId opens the workflows catalog — the /darkf command's case", () => {
    expect(initialTab()).toBe("workflows");
    expect(initialTab(undefined)).toBe("workflows");
  });

  test("a runId — auto-open, or the footer toggle's bound run — opens on `runs`", () => {
    expect(initialTab("2026-11-18T10-00-00-demo")).toBe("runs");
  });
});

describe("overlay module", () => {
  test("the tab container exports its host API — the module transforms and loads", () => {
    expect(typeof initOverlay).toBe("function");
    expect(typeof openOverlay).toBe("function");
    expect(typeof closeOverlay).toBe("function");
    expect(typeof initialTab).toBe("function");
    expect(typeof panelCloseCommand).toBe("function");
  });
});

interface CapturedClaim {
  append?: string;
  render?: (input: PanelInput) => unknown;
}

/** A full `PanelInput` shaped like the host passes it, with overridable
 *  fields — lets tests spy on `focus` while keeping every required field. */
function fakePanelInput(overrides: Partial<PanelInput> = {}): PanelInput {
  return {
    name: "some.other.panel",
    sessionID: "ses_1",
    width: 120,
    presentation: "panel",
    focused: false,
    focus: () => {},
    close: () => {},
    toggleFullscreen: () => {},
    ...overrides,
  };
}

/** Wires one module generation the way `tui.tsx`'s `setup` does, against a
 *  stub host: `initOverlay` then `registerOverlayPanel`. Stubs the pieces of
 *  the host `overlay.tsx` touches — `ui.slot` (the session.panel claim) and
 *  `ui.panel` (open/close/current) — and returns the one captured claim plus
 *  a log of every panel-api call. The claim's render is only ever invoked
 *  with a non-matching name by callers — a matching name mounts
 *  `OverlayContent`, whose component body needs the host's plugin context
 *  and render tree. */
function wireOverlay(options: { currentName?: string } = {}): {
  claim: CapturedClaim;
  calls: string[];
  openOptions: unknown[];
} {
  const calls: string[] = [];
  const openOptions: unknown[] = [];
  const claims: CapturedClaim[] = [];
  const context = {
    ui: {
      slot: (claim: CapturedClaim) => {
        claims.push(claim);
        return () => {};
      },
      panel: {
        open: (name: string, presentation?: unknown) => {
          calls.push(`open ${name}`);
          openOptions.push(presentation);
          return true;
        },
        close: () => {
          calls.push("close");
        },
        current: () =>
          options.currentName === undefined
            ? undefined
            : { name: options.currentName, sessionID: "ses_1" },
      },
    },
  } as unknown as Plugin.Context;
  initOverlay(context, {} as LiveStore);
  registerOverlayPanel(context, {} as LiveStore);
  return { claim: claims[0]!, calls, openOptions };
}

describe("registerOverlayPanel — the one session.panel claim (spec: opencode-overlay-tiles, decision 1)", () => {
  test("the content name is the plugin-prefixed darkf.panel — mirroring darkf.open", () => {
    expect(PANEL_NAME).toBe("darkf.panel");
  });

  test("registers exactly one claim, appended to session.panel, with a render", () => {
    const { claim } = wireOverlay();
    expect(claim.append).toBe("session.panel");
    expect(typeof claim.render).toBe("function");
  });

  test("renders nothing while the panel is opened under another name", () => {
    const { claim } = wireOverlay();
    // `Show`'s falsy branch — `""` here — is Solid's render-nothing value.
    expect(claim.render?.(fakePanelInput())).toBeFalsy();
  });
});

describe("openOverlay/closeOverlay — retargeted from dialog to panel (spec: opencode-overlay-tiles, open-close-api)", () => {
  test("open with nothing active calls ui.panel.open under PANEL_NAME — no dialog", () => {
    const { calls } = wireOverlay();
    openOverlay();
    // The stub host has no `ui.dialog` at all: a dialog call would throw.
    expect(calls).toEqual(["open darkf.panel"]);
  });

  test("open passes no presentation option — the host's own default is decision 3's side-panel default", () => {
    const { openOptions } = wireOverlay();
    openOverlay("2026-11-19T10-00-00-demo");
    // Decision 3 (spec: opencode-overlay-tiles): side panel by default
    // whenever there's room, full-screen forced on narrow terminals. The
    // host's open default is the side panel with exactly that forcing, so
    // `openOverlay` passes nothing — a plugin-side override could only let
    // the two disagree.
    expect(openOptions).toEqual([undefined]);
  });

  test("open while the panel is already active is the captured input's focus action, not another open", () => {
    let focused = 0;
    const { claim, calls } = wireOverlay({ currentName: PANEL_NAME });
    claim.render?.(fakePanelInput({ focus: () => focused++ }));
    openOverlay("2026-11-19T10-00-00-demo");
    expect(focused).toBe(1);
    expect(calls).toEqual([]);
  });

  test("close calls ui.panel.close — no dialog, and nothing else", () => {
    const { calls } = wireOverlay();
    closeOverlay();
    expect(calls).toEqual(["close"]);
  });
});

describe("panelCloseCommand — the keymap-bound close action (spec: opencode-overlay-tiles, decision 11)", () => {
  test("close is explicit: bound, plugin-owned, under a stable rebindable id", () => {
    const command = panelCloseCommand(() => {});
    // The binding is the plugin's own choice — decision 11 forbids assuming
    // the host closes a panel on `escape` the way it closed the dialog.
    expect(command.bind).toBe("escape");
    // Ids double as config keybind identifiers, so a user — or the live
    // check's finding, if the host claims the key — can rebind close
    // without a code change.
    expect(command.id).toBe("darkf.panel.close");
    expect(command.group).toBe("darkf");
    expect(command.title).toBe("Close darkf panel");
  });

  test("run closes through the injected panel action — once per press, no side paths", () => {
    let closed = 0;
    const command = panelCloseCommand(() => {
      closed++;
    });
    command.run();
    command.run();
    expect(closed).toBe(2);
  });

  test("the command shape registers cleanly — a named command with a bind and a run", () => {
    // The host validates command shape at layer registration ("initial
    // command-shape errors throw"): every field a named command needs is
    // present, so the layer factory that carries this command can't fail
    // on it at mount.
    const command = panelCloseCommand(() => {});
    expect(typeof command.run).toBe("function");
    expect(command.palette).toBeUndefined();
  });
});
