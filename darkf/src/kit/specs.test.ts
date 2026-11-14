import { describe, expect, test } from "bun:test";
import {
  type ProjectConfig,
  parseBacklog,
  parseBacklogJson,
  parseProjectConfig,
  parseProjectJson,
  parseSpecDocument,
  parseSpecFrontmatter,
  SPEC_FORMAT_VERSION,
  SpecFormatError,
  validateSpecGraph,
} from "./specs.ts";

const ID = "a8169a9c-1a53-4e0b-8a55-1318fef44bce";
const DEP = "0b9f8c2e-51a7-4c3d-9a11-7f6e5d4c3b2a";

function issuesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SpecFormatError);
    return (error as SpecFormatError).issues;
  }
  throw new Error("expected a SpecFormatError");
}

describe("parseSpecFrontmatter", () => {
  test("accepts the minimal shape", () => {
    expect(parseSpecFrontmatter({ id: ID, slug: "billing-v2", owner: "alice" })).toEqual({
      id: ID,
      slug: "billing-v2",
      owner: "alice",
    });
  });

  test("accepts dependencies", () => {
    const spec = parseSpecFrontmatter({
      id: ID,
      slug: "cutover",
      owner: "alice",
      depends_on: [DEP],
    });
    expect(spec.depends_on).toEqual([DEP]);
  });

  test("rejects unknown fields", () => {
    expect(
      issuesOf(() => parseSpecFrontmatter({ id: ID, slug: "x", owner: "a", priority: 1 })),
    ).toEqual(['frontmatter: unknown field "priority"']);
  });

  test("rejects a non-object", () => {
    expect(issuesOf(() => parseSpecFrontmatter("nope"))).toEqual([
      "frontmatter must be a YAML object",
    ]);
  });

  test("rejects a missing or non-v4 id", () => {
    expect(issuesOf(() => parseSpecFrontmatter({ slug: "x", owner: "a" }))).toContain(
      'frontmatter: "id" must be a UUIDv4 string',
    );
    expect(
      issuesOf(() => parseSpecFrontmatter({ id: "not-a-uuid", slug: "x", owner: "a" })),
    ).toContain('frontmatter: "id" must be a UUIDv4 string');
  });

  test("rejects a bad slug and an empty owner", () => {
    const issues = issuesOf(() =>
      parseSpecFrontmatter({ id: ID, slug: "Not_A_Slug", owner: "  " }),
    );
    expect(issues).toContain('frontmatter: "slug" must be lowercase kebab-case');
    expect(issues).toContain('frontmatter: "owner" must be a non-empty string');
  });

  test("rejects duplicate and self dependencies", () => {
    expect(
      issuesOf(() =>
        parseSpecFrontmatter({ id: ID, slug: "x", owner: "a", depends_on: [DEP, DEP] }),
      ),
    ).toContain(`frontmatter: depends_on: duplicate "${DEP}"`);
    expect(
      issuesOf(() => parseSpecFrontmatter({ id: ID, slug: "x", owner: "a", depends_on: [ID] })),
    ).toContain("frontmatter: a spec cannot depend on itself");
  });

  test("rejects non-uuid dependency entries", () => {
    expect(
      issuesOf(() => parseSpecFrontmatter({ id: ID, slug: "x", owner: "a", depends_on: ["nope"] })),
    ).toContain('frontmatter: depends_on entry "nope" is not a UUIDv4');
  });
});

describe("parseSpecDocument", () => {
  test("splits frontmatter and body", () => {
    const text = `---\nid: ${ID}\nslug: billing-v2\nowner: alice\n---\n\n# Billing\n\nBody.\n`;
    const doc = parseSpecDocument(text);
    expect(doc.frontmatter).toEqual({ id: ID, slug: "billing-v2", owner: "alice" });
    expect(doc.body.trim()).toBe("# Billing\n\nBody.");
  });

  test("rejects a missing frontmatter block", () => {
    expect(issuesOf(() => parseSpecDocument("# No frontmatter\n"))).toEqual([
      "spec.md must start with a --- frontmatter block",
    ]);
  });

  test("wraps YAML errors", () => {
    const issues = issuesOf(() => parseSpecDocument("---\nkey: [unclosed\n---\n"));
    expect(issues[0]).toStartWith("frontmatter is not valid YAML:");
  });
});

describe("parseBacklog", () => {
  test("accepts an ordered list", () => {
    expect(parseBacklog({ version: 1, order: [ID, DEP] })).toEqual({
      version: 1,
      order: [ID, DEP],
    });
  });

  test("accepts an empty order", () => {
    expect(parseBacklog({ version: 1, order: [] })).toEqual({ version: 1, order: [] });
  });

  test("rejects a version mismatch and unknown fields", () => {
    const issues = issuesOf(() => parseBacklog({ version: 2, order: [], extra: true }));
    expect(issues).toContain(`backlog: "version" must be ${SPEC_FORMAT_VERSION}`);
    expect(issues).toContain('backlog: unknown field "extra"');
  });

  test("rejects duplicates and non-uuid entries", () => {
    const issues = issuesOf(() => parseBacklog({ version: 1, order: [ID, ID, "nope"] }));
    expect(issues).toContain(`backlog: order: duplicate "${ID}"`);
    expect(issues).toContain('backlog: order entry "nope" is not a UUIDv4');
  });

  test("parseBacklogJson wraps JSON errors", () => {
    expect(issuesOf(() => parseBacklogJson("{"))[0]).toStartWith("backlog.json is not valid JSON:");
  });
});

describe("parseProjectConfig", () => {
  const full: ProjectConfig = {
    version: 1,
    title: "darkf backplane",
    harness: { runner: "opencode", model: "openai/gpt-5" },
    sandbox: {
      image: "ghcr.io/psimona/backplane-ci:latest",
      runtimeClass: "gvisor",
      mounts: [{ name: "bun-cache", mountPath: "/root/.bun", size: "10Gi" }],
    },
  };

  test("accepts the full shape", () => {
    expect(parseProjectConfig(full)).toEqual(full);
  });

  test("accepts the minimal shape", () => {
    expect(parseProjectConfig({ version: 1 })).toEqual({ version: 1 });
  });

  test("rejects unknown fields at every level", () => {
    const issues = issuesOf(() =>
      parseProjectConfig({
        version: 1,
        extra: true,
        harness: { runner: "opencode", apiKey: "x" },
        sandbox: {
          image: "i",
          privileged: true,
          mounts: [{ name: "a", mountPath: "/a", mode: "rw" }],
        },
      }),
    );
    expect(issues).toContain('project: unknown field "extra"');
    expect(issues).toContain('project.harness: unknown field "apiKey"');
    expect(issues).toContain('project.sandbox: unknown field "privileged"');
    expect(issues).toContain('project.sandbox.mounts[0]: unknown field "mode"');
  });

  test("requires a runner when a harness is present", () => {
    expect(issuesOf(() => parseProjectConfig({ version: 1, harness: {} }))).toContain(
      'project.harness: "runner" must be a non-empty string',
    );
  });

  test("requires absolute mount paths", () => {
    const issues = issuesOf(() =>
      parseProjectConfig({
        version: 1,
        sandbox: { mounts: [{ name: "a", mountPath: "relative" }] },
      }),
    );
    expect(issues).toContain('project.sandbox.mounts[0]: "mountPath" must be an absolute path');
  });

  test("parseProjectJson wraps JSON errors", () => {
    expect(issuesOf(() => parseProjectJson("nope"))[0]).toStartWith(
      "project.json is not valid JSON:",
    );
  });
});

describe("validateSpecGraph", () => {
  const base = { owner: "alice" };

  test("accepts a valid graph", () => {
    expect(() =>
      validateSpecGraph([
        { ...base, id: ID, slug: "parent" },
        { ...base, id: DEP, slug: "child", depends_on: [ID] },
      ]),
    ).not.toThrow();
  });

  test("rejects duplicate ids and slugs", () => {
    const issues = issuesOf(() =>
      validateSpecGraph([
        { ...base, id: ID, slug: "same" },
        { ...base, id: ID, slug: "same" },
      ]),
    );
    expect(issues).toContain(`spec graph: id: duplicate "${ID}"`);
    expect(issues).toContain('spec graph: slug: duplicate "same"');
  });

  test("rejects missing dependency targets", () => {
    expect(
      issuesOf(() => validateSpecGraph([{ ...base, id: ID, slug: "child", depends_on: [DEP] }])),
    ).toContain(
      'spec child: depends_on target "0b9f8c2e-51a7-4c3d-9a11-7f6e5d4c3b2a" does not exist',
    );
  });

  test("rejects cycles", () => {
    const third = "11111111-1111-4111-8111-111111111111";
    const issues = issuesOf(() =>
      validateSpecGraph([
        { ...base, id: ID, slug: "a", depends_on: [DEP] },
        { ...base, id: DEP, slug: "b", depends_on: [third] },
        { ...base, id: third, slug: "c", depends_on: [ID] },
      ]),
    );
    expect(issues).toContain("spec graph: dependency cycle a -> b -> c -> a");
  });
});
