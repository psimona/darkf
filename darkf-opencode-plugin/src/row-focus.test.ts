import { describe, expect, test } from "bun:test";
import { createTextAttributes } from "@opentui/core";
import { BOLD_INVERSE, CURSOR_GLYPH, DIM_INVERSE, INVERSE, rowGutter } from "./row-focus.ts";

// Decision 5's fixture checks (docs/specs/opencode-overlay-tiles/spec.md —
// Verification strategy: "row inverse+ glyph rendering"). The band + glyph
// is the whole row-focus contract both tabs share; whether it *reads* as
// visible is confirmed by inspection on a real terminal, per the spec.

describe("rowGutter — the leading cursor glyph, width-stable across rows", () => {
  test("the focused row leads with ❯", () => {
    expect(rowGutter(true)).toBe(`${CURSOR_GLYPH} `);
    expect(rowGutter(true)).toContain("❯");
  });

  test("unfocused rows reserve the same width — no horizontal shift as the cursor moves", () => {
    expect(rowGutter(false)).toHaveLength(rowGutter(true).length);
    expect(rowGutter(false).trim()).toBe("");
  });
});

describe("focused-row attributes — the inverse band layers over a cell's own style", () => {
  const BOLD = createTextAttributes({ bold: true });
  const DIM = createTextAttributes({ dim: true });

  test("plain cells carry the band alone", () => {
    expect(INVERSE).toBe(createTextAttributes({ inverse: true }));
    expect(INVERSE).not.toBe(0);
  });

  test("the band composes with bold rather than replacing it", () => {
    expect(BOLD_INVERSE).toBe(BOLD | INVERSE);
    expect(BOLD_INVERSE & BOLD).toBe(BOLD);
  });

  test("the band composes with dim rather than replacing it", () => {
    expect(DIM_INVERSE).toBe(DIM | INVERSE);
    expect(DIM_INVERSE & DIM).toBe(DIM);
  });

  test("every focused variant carries the band — none falls back to color only", () => {
    for (const focused of [INVERSE, BOLD_INVERSE, DIM_INVERSE]) {
      expect(focused & INVERSE).toBe(INVERSE);
    }
  });
});
