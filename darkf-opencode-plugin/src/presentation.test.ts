import { describe, expect, test } from "bun:test";
import { canTogglePresentation, MIN_SPLIT_WIDTH } from "./presentation.ts";

// Decision 3's no-op detection (docs/specs/opencode-overlay-tiles/spec.md —
// decision 3, and the narrow-fullscreen success criterion): the facts are
// unit-tested here; whether the inert control *reads* as a no-op is
// confirmed by inspection on a real terminal, per the spec's own note on
// perceptual checks (the same split row-focus.test.ts makes).

describe("canTogglePresentation — decision 3's no-op case, from documented state alone", () => {
  test("a side panel always toggles — the host only shows one when there is room", () => {
    expect(canTogglePresentation(MIN_SPLIT_WIDTH, "panel")).toBe(true);
    expect(canTogglePresentation(MIN_SPLIT_WIDTH * 4, "panel")).toBe(true);
  });

  test("full-screen toggles back once the measured width leaves room for a side panel", () => {
    expect(canTogglePresentation(MIN_SPLIT_WIDTH, "fullscreen")).toBe(true);
    expect(canTogglePresentation(MIN_SPLIT_WIDTH * 2, "fullscreen")).toBe(true);
  });

  test("below the host's split threshold, full-screen is the narrow-forced no-op", () => {
    expect(canTogglePresentation(MIN_SPLIT_WIDTH - 1, "fullscreen")).toBe(false);
    expect(canTogglePresentation(80, "fullscreen")).toBe(false);
  });

  test("the boundary is exact — the host splits at width >= 108, not > 108", () => {
    expect(canTogglePresentation(108, "fullscreen")).toBe(true);
    expect(canTogglePresentation(107, "fullscreen")).toBe(false);
  });

  test("a side panel below the threshold still reads live — the visible lie the control never tells", () => {
    expect(canTogglePresentation(MIN_SPLIT_WIDTH - 1, "panel")).toBe(true);
  });
});
