import type { Task, TaskList, TaskPriority, TaskRequirement, TaskStatus } from "./types.ts";

// Hand-written narrowing of unknown JSON to a TaskList (docs/specs/task-list-json/spec.md,
// Decisions: Validation) — zero deps, no dual-schema tolerance: the legacy
// names (`moscow`, task-side `requirements`) are simply not read, and the
// result is either a TaskList or `{ error }`. The item-loop path and the
// OpenCode plugin share this one validator, so a malformed list can never
// crash a consumer.
//
// Unknown extra fields are ignored — the schema is narrowed to, not
// enforced as a closed record.

const TASK_STATUSES: readonly TaskStatus[] = ["pending", "in-progress", "done", "failed"];
const TASK_PRIORITIES: readonly TaskPriority[] = ["must", "should", "could", "won't"];
const REQUIREMENT_KINDS: readonly TaskRequirement["kind"][] = ["req", "nfr", "ng"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

// The failure half of every sub-parse below — never checked with `in` on the
// value itself, which throws on the string primitives the success half is.
function isError(x: unknown): x is { error: string } {
  return typeof x === "object" && x !== null && "error" in x;
}

function oneOf(value: unknown, allowed: readonly string[], at: string): string | undefined {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return undefined;
  const quoted = allowed.map((a) => JSON.stringify(a)).join(" | ");
  return `${at}: expected one of ${quoted}, got ${JSON.stringify(value) ?? describe(value)}`;
}

function parsePriority(value: unknown, at: string): TaskPriority | { error: string } {
  const err = oneOf(value, TASK_PRIORITIES, at);
  return err === undefined ? (value as TaskPriority) : { error: err };
}

function parseStringArray(value: unknown, at: string): string[] | { error: string } {
  if (!Array.isArray(value)) return { error: `${at}: expected an array, got ${describe(value)}` };
  for (const [i, entry] of value.entries()) {
    if (typeof entry !== "string") {
      return { error: `${at}[${i}]: expected a string, got ${describe(entry)}` };
    }
  }
  return value;
}

function parseRequirement(value: unknown, index: number): TaskRequirement | { error: string } {
  const at = `requirements[${index}]`;
  if (!isObject(value)) return { error: `${at}: expected an object, got ${describe(value)}` };
  if (typeof value.id !== "string") {
    return { error: `${at}.id: expected a string, got ${describe(value.id)}` };
  }
  const kindErr = oneOf(value.kind, REQUIREMENT_KINDS, `${at}.kind`);
  if (kindErr !== undefined) return { error: kindErr };
  if (typeof value.text !== "string") {
    return { error: `${at}.text: expected a string, got ${describe(value.text)}` };
  }
  const requirement: TaskRequirement = {
    id: value.id,
    kind: value.kind as TaskRequirement["kind"],
    text: value.text,
  };
  if (value.priority !== undefined) {
    const priority = parsePriority(value.priority, `${at}.priority`);
    if (isError(priority)) return priority;
    requirement.priority = priority;
  }
  return requirement;
}

function parseTask(value: unknown, index: number): Task | { error: string } {
  const at = `tasks[${index}]`;
  if (!isObject(value)) return { error: `${at}: expected an object, got ${describe(value)}` };
  if (typeof value.id !== "string") {
    return { error: `${at}.id: expected a string, got ${describe(value.id)}` };
  }
  if (typeof value.title !== "string") {
    return { error: `${at}.title: expected a string, got ${describe(value.title)}` };
  }
  const statusErr = oneOf(value.status, TASK_STATUSES, `${at}.status`);
  if (statusErr !== undefined) return { error: statusErr };
  const task: Task = { id: value.id, title: value.title, status: value.status as TaskStatus };
  if (value.satisfies !== undefined) {
    const satisfies = parseStringArray(value.satisfies, `${at}.satisfies`);
    if (isError(satisfies)) return satisfies;
    task.satisfies = satisfies;
  }
  if (value.priority !== undefined) {
    const priority = parsePriority(value.priority, `${at}.priority`);
    if (isError(priority)) return priority;
    task.priority = priority;
  }
  return task;
}

export function parseTaskList(json: unknown): TaskList | { error: string } {
  if (!isObject(json)) {
    return { error: `task list: expected an object, got ${describe(json)}` };
  }
  if (typeof json.id !== "string") {
    return { error: `id: expected a string, got ${describe(json.id)}` };
  }
  const list: TaskList = { id: json.id, tasks: [] };

  if (json.spec !== undefined) {
    if (!isObject(json.spec)) {
      return { error: `spec: expected an object, got ${describe(json.spec)}` };
    }
    const spec: TaskList["spec"] = {};
    if (json.spec.prd !== undefined) {
      if (typeof json.spec.prd !== "string") {
        return { error: `spec.prd: expected a string, got ${describe(json.spec.prd)}` };
      }
      spec.prd = json.spec.prd;
    }
    if (json.spec.design !== undefined) {
      if (typeof json.spec.design !== "string") {
        return { error: `spec.design: expected a string, got ${describe(json.spec.design)}` };
      }
      spec.design = json.spec.design;
    }
    list.spec = spec;
  }

  if (json.requirements !== undefined) {
    if (!Array.isArray(json.requirements)) {
      return { error: `requirements: expected an array, got ${describe(json.requirements)}` };
    }
    const requirements: TaskRequirement[] = [];
    for (const [i, entry] of json.requirements.entries()) {
      const requirement = parseRequirement(entry, i);
      if (isError(requirement)) return requirement;
      requirements.push(requirement);
    }
    list.requirements = requirements;
  }

  if (!Array.isArray(json.tasks)) {
    return { error: `tasks: expected an array, got ${describe(json.tasks)}` };
  }
  const tasks: Task[] = [];
  for (const [i, entry] of json.tasks.entries()) {
    const task = parseTask(entry, i);
    if (isError(task)) return task;
    tasks.push(task);
  }
  list.tasks = tasks;

  return list;
}
