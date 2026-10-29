/** @jsxImportSource @opentui/solid */

import { createTextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid/jsx-runtime";

const LABEL = "df";
const PURPLE = "#7C3AED";
const BOLD = createTextAttributes({ bold: true });

/**
 * The toggle, rendered as a horizontal "df" badge on a purple background.
 * Both ends of the toggle use this same component in the same screen corner
 * (bottom right, next to the prompt box when closed; bottom right of the
 * overlay dialog when open) so it reads as one button that flips state, not
 * two different ones — `active` only swaps the highlight. `width` widens the
 * closed-state tab for easier touch reach; `rows` makes the open-state
 * (dialog) tab a taller block, with the label pinned to its top row.
 *
 * Its own module, not `toggle.tsx` — `toggle.tsx` needs `openOverlay` from
 * `overlay.tsx`, and `overlay.tsx` needs this component for its in-dialog
 * close button; sharing one file between them would make the two modules
 * import each other (pre-existing on `master` under the old `route.tsx`/
 * `toggle.tsx` names — this split fixes it rather than re-creating it here).
 */
export function ToggleTab(props: {
  active: boolean;
  accent: string;
  onPress: () => void;
  width?: number;
  rows?: number;
}): JSX.Element {
  return (
    <box
      width={props.width ?? 4}
      height={props.rows ?? 1}
      flexDirection="column"
      justifyContent="flex-start"
      alignItems="center"
      backgroundColor={PURPLE}
      onMouseDown={() => props.onPress()}
    >
      <text attributes={props.active ? BOLD : undefined}>{LABEL}</text>
    </box>
  );
}
