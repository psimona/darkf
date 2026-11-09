import { describe, expect, test } from "bun:test";
import { BoxRenderable, RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

// Regression test for the auto-close bug: the closed "df" tab used to open
// the overlay on mousedown, and the host Dialog's full-screen backdrop closes
// on mouseup (packages/tui/src/ui/dialog.tsx) — so the same physical click's
// release landed on the freshly mounted backdrop and closed the dialog
// immediately. Opening on mouseup means the gesture is complete before the
// dialog exists. This scene mirrors the backdrop contract: a full-screen
// box that fires `closed` on mouseup mounts when `open` flips.

describe("df toggle opens on mouseup", () => {
  test("press+release on the tab opens once and the backdrop never sees the release", async () => {
    const { renderer, mockMouse, renderOnce } = await createTestRenderer({
      width: 40,
      height: 10,
    });
    const root = renderer.root;

    const events: string[] = [];
    let open = false;
    let tab: BoxRenderable | undefined;
    let backdrop: BoxRenderable | undefined;

    backdrop = new BoxRenderable(renderer, {
      width: 40,
      height: 10,
      backgroundColor: RGBA.fromInts(0, 0, 0, 150),
      onMouseUp: () => events.push("closed"),
    });
    tab = new BoxRenderable(renderer, {
      width: 6,
      height: 1,
      backgroundColor: "blue",
      // The fix under test: mouseup, not mousedown.
      onMouseUp: () => {
        events.push("opened");
        open = true;
        root.add(backdrop); // the dialog backdrop mounts on open
      },
    });
    root.add(tab);
    await renderOnce();

    // The physical gesture: press, then release, at the same coords.
    await mockMouse.pressDown(2, 0);
    await renderOnce();
    await mockMouse.release(2, 0);
    await renderOnce();

    expect(events).toEqual(["opened"]);
    expect(open).toBe(true);

    // Sanity: a later click on the backdrop still closes, like the host's
    // click-outside-to-close behavior.
    await mockMouse.click(20, 5);
    await renderOnce();
    expect(events).toEqual(["opened", "closed"]);

    renderer.destroy();
  });
});
