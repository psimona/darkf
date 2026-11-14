// The backplane spec workspace contract (D15, D16). One spec per folder under
// `docs/specs/`, a single ordered `backlog.json`, and a `project.json` for
// harness and sandbox defaults. Every file is typed here, and validators reject
// anything the format does not name — so a workflow that imports this module
// sees the same shape the backplane does.
//
// Format rules live in the backplane repo at
// `docs/specs/0001-spec-format/spec.md`. Keep this module in sync with it.

export const SPEC_FORMAT_VERSION = 1;

/** Frontmatter of a `spec.md`. Unknown fields are rejected. */
export interface SpecFrontmatter {
  /** UUIDv4 identity. Generated at creation, never changes. */
  id: string;
  /** Human key for URLs, search, and chat. Safe to change. */
  slug: string;
  /** The one person accountable for this spec. */
  owner: string;
  /** UUIDs of specs this one waits for. Satisfied when those ship. */
  depends_on?: string[];
}

/** `docs/specs/backlog.json` — the only planning state stored (D16). */
export interface BacklogFile {
  version: 1;
  /** Spec UUIDs in priority order. Unlisted specs sort after these. */
  order: string[];
}

/** An allowlisted pod volume mount for a project's sandbox (D3). */
export interface SandboxMount {
  name: string;
  mountPath: string;
  /** Optional size hint, e.g. "10Gi". */
  size?: string;
}

/** `project.json` — harness and sandbox defaults (D2, D3). */
export interface ProjectConfig {
  version: 1;
  title?: string;
  harness?: {
    /** Agent runner kind, e.g. "claude-code" or "opencode". */
    runner: string;
    /** Optional model hint passed to the runner. */
    model?: string;
  };
  sandbox?: {
    /** Project-supplied image, normally the CI image (D3). */
    image?: string;
    /** Isolation runtime from the allowlist, e.g. "kata" or "gvisor". */
    runtimeClass?: string;
    mounts?: SandboxMount[];
  };
}

/** A parsed `spec.md`: frontmatter plus the untouched body. */
export interface SpecDocument {
  frontmatter: SpecFrontmatter;
  body: string;
}

/** Raised when a backplane file does not match the format. */
export class SpecFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid spec workspace file: ${issues.join("; ")}`);
    this.name = "SpecFormatError";
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SPEC_FIELDS = new Set(["id", "slug", "owner", "depends_on"]);
const BACKLOG_FIELDS = new Set(["version", "order"]);
const PROJECT_FIELDS = new Set(["version", "title", "harness", "sandbox"]);
const HARNESS_FIELDS = new Set(["runner", "model"]);
const SANDBOX_FIELDS = new Set(["image", "runtimeClass", "mounts"]);
const MOUNT_FIELDS = new Set(["name", "mountPath", "size"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${where}: unknown field "${key}"`);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function collectUnique(values: string[], label: string): string[] {
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label}: duplicate "${value}"`);
    seen.add(value);
  }
  return issues;
}

/** Parse and validate `spec.md` frontmatter. Throws {@link SpecFormatError}. */
export function parseSpecFrontmatter(value: unknown): SpecFrontmatter {
  if (!isRecord(value)) throw new SpecFormatError(["frontmatter must be a YAML object"]);

  const issues = unknownFields(value, SPEC_FIELDS, "frontmatter");
  const { id, slug, owner, depends_on } = value;

  if (!isUuid(id)) issues.push('frontmatter: "id" must be a UUIDv4 string');
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    issues.push('frontmatter: "slug" must be lowercase kebab-case');
  }
  if (typeof owner !== "string" || owner.trim() === "") {
    issues.push('frontmatter: "owner" must be a non-empty string');
  }

  let deps: string[] | undefined;
  if (depends_on !== undefined) {
    if (!Array.isArray(depends_on)) {
      issues.push('frontmatter: "depends_on" must be an array of spec UUIDs');
    } else {
      for (const dep of depends_on) {
        if (!isUuid(dep))
          issues.push(`frontmatter: depends_on entry "${String(dep)}" is not a UUIDv4`);
      }
      issues.push(...collectUnique(depends_on as string[], "frontmatter: depends_on"));
      if (depends_on.includes(id as string))
        issues.push("frontmatter: a spec cannot depend on itself");
      deps = [...(depends_on as string[])];
    }
  }

  if (issues.length > 0) throw new SpecFormatError(issues);
  const spec: SpecFrontmatter = { id: id as string, slug: slug as string, owner: owner as string };
  if (deps !== undefined) spec.depends_on = deps;
  return spec;
}

/** Parse a `spec.md` file: YAML frontmatter plus body. Throws {@link SpecFormatError}. */
export function parseSpecDocument(text: string): SpecDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    throw new SpecFormatError(["spec.md must start with a --- frontmatter block"]);
  }
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(match[1] ?? "");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SpecFormatError([`frontmatter is not valid YAML: ${reason}`]);
  }
  return { frontmatter: parseSpecFrontmatter(raw), body: text.slice(match[0].length) };
}

/** Parse and validate `docs/specs/backlog.json`. Throws {@link SpecFormatError}. */
export function parseBacklog(value: unknown): BacklogFile {
  if (!isRecord(value)) throw new SpecFormatError(["backlog must be a JSON object"]);

  const issues = unknownFields(value, BACKLOG_FIELDS, "backlog");
  if (value.version !== SPEC_FORMAT_VERSION) {
    issues.push(`backlog: "version" must be ${SPEC_FORMAT_VERSION}`);
  }
  if (!Array.isArray(value.order)) {
    issues.push('backlog: "order" must be an array of spec UUIDs');
  } else {
    for (const id of value.order) {
      if (!isUuid(id)) issues.push(`backlog: order entry "${String(id)}" is not a UUIDv4`);
    }
    issues.push(...collectUnique(value.order as string[], "backlog: order"));
  }

  if (issues.length > 0) throw new SpecFormatError(issues);
  return { version: SPEC_FORMAT_VERSION, order: [...(value.order as string[])] };
}

/** Parse backlog.json text. Throws {@link SpecFormatError}. */
export function parseBacklogJson(text: string): BacklogFile {
  return parseBacklog(parseJson(text, "backlog.json"));
}

/** Parse and validate project.json. Throws {@link SpecFormatError}. */
export function parseProjectConfig(value: unknown): ProjectConfig {
  if (!isRecord(value)) throw new SpecFormatError(["project config must be a JSON object"]);

  const issues = unknownFields(value, PROJECT_FIELDS, "project");
  if (value.version !== SPEC_FORMAT_VERSION) {
    issues.push(`project: "version" must be ${SPEC_FORMAT_VERSION}`);
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    issues.push('project: "title" must be a string');
  }

  if (value.harness !== undefined) {
    if (!isRecord(value.harness)) {
      issues.push('project: "harness" must be an object');
    } else {
      const harness = value.harness;
      issues.push(...unknownFields(harness, HARNESS_FIELDS, "project.harness"));
      if (typeof harness.runner !== "string" || harness.runner.trim() === "") {
        issues.push('project.harness: "runner" must be a non-empty string');
      }
      if (harness.model !== undefined && typeof harness.model !== "string") {
        issues.push('project.harness: "model" must be a string');
      }
    }
  }

  if (value.sandbox !== undefined) {
    if (!isRecord(value.sandbox)) {
      issues.push('project: "sandbox" must be an object');
    } else {
      const sandbox = value.sandbox;
      issues.push(...unknownFields(sandbox, SANDBOX_FIELDS, "project.sandbox"));
      for (const key of ["image", "runtimeClass"] as const) {
        if (sandbox[key] !== undefined && typeof sandbox[key] !== "string") {
          issues.push(`project.sandbox: "${key}" must be a string`);
        }
      }
      if (sandbox.mounts !== undefined) {
        if (!Array.isArray(sandbox.mounts)) {
          issues.push('project.sandbox: "mounts" must be an array');
        } else {
          sandbox.mounts.forEach((mount, index) => {
            if (!isRecord(mount)) {
              issues.push(`project.sandbox.mounts[${index}] must be an object`);
              return;
            }
            issues.push(...unknownFields(mount, MOUNT_FIELDS, `project.sandbox.mounts[${index}]`));
            if (typeof mount.name !== "string" || mount.name.trim() === "") {
              issues.push(`project.sandbox.mounts[${index}]: "name" must be a non-empty string`);
            }
            if (typeof mount.mountPath !== "string" || !mount.mountPath.startsWith("/")) {
              issues.push(`project.sandbox.mounts[${index}]: "mountPath" must be an absolute path`);
            }
            if (mount.size !== undefined && typeof mount.size !== "string") {
              issues.push(`project.sandbox.mounts[${index}]: "size" must be a string`);
            }
          });
        }
      }
    }
  }

  if (issues.length > 0) throw new SpecFormatError(issues);

  const project: ProjectConfig = { version: SPEC_FORMAT_VERSION };
  if (typeof value.title === "string") project.title = value.title;
  if (isRecord(value.harness)) {
    const harness: NonNullable<ProjectConfig["harness"]> = {
      runner: value.harness.runner as string,
    };
    if (typeof value.harness.model === "string") harness.model = value.harness.model;
    project.harness = harness;
  }
  if (isRecord(value.sandbox)) {
    const sandbox: NonNullable<ProjectConfig["sandbox"]> = {};
    if (typeof value.sandbox.image === "string") sandbox.image = value.sandbox.image;
    if (typeof value.sandbox.runtimeClass === "string") {
      sandbox.runtimeClass = value.sandbox.runtimeClass;
    }
    if (Array.isArray(value.sandbox.mounts)) {
      sandbox.mounts = value.sandbox.mounts.map((mount) => {
        const raw = mount as Record<string, unknown>;
        const parsed: SandboxMount = {
          name: raw.name as string,
          mountPath: raw.mountPath as string,
        };
        if (typeof raw.size === "string") parsed.size = raw.size;
        return parsed;
      });
    }
    project.sandbox = sandbox;
  }
  return project;
}

/** Parse project.json text. Throws {@link SpecFormatError}. */
export function parseProjectJson(text: string): ProjectConfig {
  return parseProjectConfig(parseJson(text, "project.json"));
}

/**
 * Validate a set of specs as a graph: unique ids and slugs, existing
 * dependency targets, and no cycles. Throws {@link SpecFormatError}.
 */
export function validateSpecGraph(specs: SpecFrontmatter[]): void {
  const issues: string[] = [];
  issues.push(
    ...collectUnique(
      specs.map((spec) => spec.id),
      "spec graph: id",
    ),
  );
  issues.push(
    ...collectUnique(
      specs.map((spec) => spec.slug),
      "spec graph: slug",
    ),
  );

  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  for (const spec of specs) {
    for (const dep of spec.depends_on ?? []) {
      if (!byId.has(dep))
        issues.push(`spec ${spec.slug}: depends_on target "${dep}" does not exist`);
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    const mark = state.get(id);
    if (mark === "done") return;
    if (mark === "visiting") {
      const cycle = [...path.slice(path.indexOf(id)), id]
        .map((specId) => byId.get(specId)?.slug ?? specId)
        .join(" -> ");
      issues.push(`spec graph: dependency cycle ${cycle}`);
      return;
    }
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.depends_on ?? []) visit(dep, [...path, id]);
    state.set(id, "done");
  };
  for (const spec of specs) visit(spec.id, []);

  if (issues.length > 0) throw new SpecFormatError(issues);
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SpecFormatError([`${file} is not valid JSON: ${reason}`]);
  }
}
