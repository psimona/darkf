// Workflow discovery (opencode-overlay-tabs r9): the same two-root scan
// `darkf run`/`render` resolve against, reused instead of re-scanned.
export { listWorkflows, type WorkflowListing } from "./cli/index.ts";
export * from "./kit/registry.ts";
export * from "./kit/specs.ts";
export * from "./kit/status.ts";
