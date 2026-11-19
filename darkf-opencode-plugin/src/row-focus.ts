import { createTextAttributes } from "@opentui/core";

// Row-level focus indicators (docs/specs/opencode-overlay-tiles/spec.md,
// decision 5): the focused row shows an inverse-video band across its whole
// row plus a leading `❯` cursor glyph — replacing the color-only
// `fg: accent` convention the two list views used for "this is the cursor".
// Accent keeps its other, non-focus meanings (the active view label, the
// region borders); focus is marked by band + glyph alone, never by color,
// so the indicator does not depend on the theme to be visible. Shared by
// `workflows-tab.tsx` and `runs-tab.tsx`, whose rows are otherwise
// independent of each other.

/** The focused row's leading glyph. */
export const CURSOR_GLYPH = "❯";

/** The row's leading gutter: the cursor glyph plus a space on the focused
 *  row, blank spaces of the same width on every other row — so rows keep
 *  their columns as the cursor moves instead of shifting under it. */
export function rowGutter(focused: boolean): string {
  return focused ? `${CURSOR_GLYPH} ` : "  ";
}

/** The inverse-video band alone, for a focused row's plain (unstyled)
 *  cells — `createTextAttributes({ inverse: true })` per decision 5. */
export const INVERSE = createTextAttributes({ inverse: true });

/** The band over a cell's own bold — the base style a focused row keeps. */
export const BOLD_INVERSE = createTextAttributes({ bold: true, inverse: true });

/** The band over a cell's own dim. */
export const DIM_INVERSE = createTextAttributes({ dim: true, inverse: true });
