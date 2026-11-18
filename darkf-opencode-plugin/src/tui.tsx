import { Plugin } from "@opencode/plugin/tui";
import { registerBand } from "./band.tsx";
import { initOverlay, openOverlay } from "./overlay.tsx";
import { registerSidebar } from "./sidebar.tsx";
import { startStore } from "./store.ts";
import { registerPromptToggle } from "./toggle.tsx";

export default Plugin.define({
  id: "darkf.visualizer",
  async setup(context) {
    // The location this TUI instance opened. `context.location` is optional in
    // the type; the location data cache's default is the same directory.
    const directory = () =>
      context.location?.directory ?? context.data.location.default().directory;

    // Fires once per run, the instant it's first observed — including a run
    // with no session bound (the `home`-screen case; see spec:
    // docs/specs/_built/opencode-overlay-dialog/spec.md). Unconditional auto-open
    // either way: a darkf-only view beats no view when there's no chat to
    // replace, and `PlanGraph`/`SupervisorPanel` degrade on their own when
    // `supervisor` is absent. Opening is a host dialog, so it never disturbs
    // whatever route is current when a run starts.
    const { store, dispose } = startStore(context, directory, (binding) => {
      openOverlay(binding.runId);
    });

    initOverlay(context, store);
    registerBand(context, store);
    registerSidebar(context, store);
    registerPromptToggle(context, store);

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "darkf.open",
          title: "Open darkf plan view",
          group: "darkf",
          palette: true,
          slash: { name: "darkf" },
          run() {
            openOverlay();
          },
        },
      ],
    }));

    return dispose;
  },
});
