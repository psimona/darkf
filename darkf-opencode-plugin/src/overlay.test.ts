import { describe, expect, test } from "bun:test";
import { closeOverlay, initialTab, initOverlay, openOverlay } from "./overlay.tsx";

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
  });
});
