export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "No package graph in this repo should ever have a cycle — the generic safety net under the two more specific rules below.",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-is-a-leaf",
      severity: "error",
      comment:
        "core/ is the shared vocabulary (per ROADMAP.md); it must not depend on any of its own consumers.",
      from: { path: "^darkf/src/core" },
      to: { path: "^darkf/src/(engine|cli|kit)" },
    },
    {
      name: "engine-does-not-import-harness",
      severity: "error",
      comment:
        "engine/ is the interpreter; cli/ and kit/ are the harness built on top of it. The dependency only ever runs one way.",
      from: { path: "^darkf/src/engine" },
      to: { path: "^darkf/src/(cli|kit)" },
    },
  ],
  options: {
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    exclude: {
      path: "^(reference|.*/node_modules)/",
    },
  },
};
