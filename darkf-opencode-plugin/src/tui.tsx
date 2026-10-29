import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { registerBand } from "./band.tsx";
import type { RunBinding } from "./locate.ts";
import { openOverlay, registerOverlay } from "./overlay.tsx";
import { registerSidebar } from "./sidebar.tsx";
import { startStore } from "./store.ts";
import { registerPromptToggle } from "./toggle.tsx";

const tui: TuiPlugin = async (api) => {
  const directory = () => api.state.path.directory;

  // Fires once per run, the instant it's first observed — including a run
  // with no session bound (the `home`-screen case; see spec:
  // docs/specs/opencode-overlay-dialog/spec.md). Unconditional auto-open
  // either way: a darkf-only view beats no view when there's no chat to
  // replace, and `PlanGraph`/`SupervisorPanel` degrade on their own when
  // `supervisor` is absent. `openOverlay` never navigates, so this never
  // disturbs whatever route is current when a run starts.
  const onNewRun = (binding: RunBinding): void => {
    openOverlay(binding.runId);
  };

  const store = startStore(api, directory, onNewRun);

  registerBand(api, store);
  registerSidebar(api, store);
  registerOverlay(api, store);
  registerPromptToggle(api, store);

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: "darkf.open",
        title: "Open darkf plan view",
        category: "darkf",
        namespace: "palette",
        slashName: "darkf",
        run() {
          openOverlay();
        },
      },
    ],
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "darkf.visualizer",
  tui,
};

export default plugin;
