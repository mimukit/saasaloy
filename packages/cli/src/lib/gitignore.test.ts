import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compilePattern, isPathIgnored, parseGitignore } from "./gitignore.js";

/** The env-and-secrets stanza the base template ships, verbatim. */
const BASE_IGNORE = [
  "# Environment & secrets",
  ".env",
  ".env.*",
  "!.env.example",
  ".dev.vars",
  ".dev.vars.*",
  "!.dev.vars.example",
  "*.pem",
  "",
  "node_modules/",
].join("\n");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-gitignore-"));
  await mkdir(join(root, ".git"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = join(root, ...rel.split("/"));
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

describe(compilePattern, () => {
  it("drops blanks and comments", () => {
    expect(compilePattern("")).toBeUndefined();
    expect(compilePattern("   ")).toBeUndefined();
    expect(compilePattern("# a note")).toBeUndefined();
  });

  it("matches an unanchored pattern at any depth", () => {
    const rule = compilePattern(".dev.vars")!;
    expect(rule.test.test("apps/api/.dev.vars")).toBeTruthy();
    expect(rule.test.test(".dev.vars")).toBeTruthy();
    expect(rule.test.test("apps/api/.dev.varsX")).toBeFalsy();
  });

  it("anchors a pattern carrying a slash to the .gitignore's own directory", () => {
    const rule = compilePattern("/apps/api/.dev.vars")!;
    expect(rule.test.test("apps/api/.dev.vars")).toBeTruthy();
    expect(rule.test.test("nested/apps/api/.dev.vars")).toBeFalsy();
  });

  it("reads a trailing slash as directory-only and a leading ! as negation", () => {
    expect(compilePattern("node_modules/")).toMatchObject({
      dirOnly: true,
      negated: false,
    });
    expect(compilePattern("!.env.example")).toMatchObject({
      dirOnly: false,
      negated: true,
    });
  });

  it("keeps `*` inside one segment and lets `**/` cross them", () => {
    expect(compilePattern("*.pem")!.test.test("certs/key.pem")).toBeTruthy();
    expect(compilePattern("/a/*/c")!.test.test("a/b/c")).toBeTruthy();
    expect(compilePattern("/a/*/c")!.test.test("a/b/x/c")).toBeFalsy();
    expect(compilePattern("/a/**/c")!.test.test("a/b/x/c")).toBeTruthy();
  });
});

describe(parseGitignore, () => {
  it("keeps only the lines that carry a pattern", () => {
    expect(parseGitignore(BASE_IGNORE)).toHaveLength(8);
  });
});

describe(isPathIgnored, () => {
  it("says yes for the two files `env` writes, from the base template's ignore", async () => {
    await write(".gitignore", BASE_IGNORE);
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars")
    ).resolves.toBeTruthy();
    await expect(isPathIgnored(root, "apps/web/.env")).resolves.toBeTruthy();
  });

  it("honours a later negation over an earlier match", async () => {
    await write(".gitignore", BASE_IGNORE);
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars.example")
    ).resolves.toBeFalsy();
    await expect(
      isPathIgnored(root, "apps/web/.env.example")
    ).resolves.toBeFalsy();
  });

  it("says no once the pattern is deleted, which is what `env` refuses on", async () => {
    await write(
      ".gitignore",
      BASE_IGNORE.split("\n")
        .filter((line) => !line.includes("dev.vars"))
        .join("\n")
    );
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars")
    ).resolves.toBeFalsy();
    await expect(isPathIgnored(root, "apps/web/.env")).resolves.toBeTruthy();
  });

  it("reads a nested .gitignore, which can re-include what the root excluded", async () => {
    await write(".gitignore", BASE_IGNORE);
    await write("apps/api/.gitignore", "!.dev.vars");
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars")
    ).resolves.toBeFalsy();
    await expect(
      isPathIgnored(root, "apps/web/.dev.vars")
    ).resolves.toBeTruthy();
  });

  it("ignores everything under an ignored directory", async () => {
    await write(".gitignore", BASE_IGNORE);
    await expect(
      isPathIgnored(root, "node_modules/x/index.js")
    ).resolves.toBeTruthy();
  });

  it("treats a project with no .git as not ignored, so `env` refuses", async () => {
    await write(".gitignore", BASE_IGNORE);
    await rm(join(root, ".git"), { force: true, recursive: true });
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars")
    ).resolves.toBeFalsy();
  });

  it("answers no when there is no .gitignore at all", async () => {
    await expect(
      isPathIgnored(root, "apps/api/.dev.vars")
    ).resolves.toBeFalsy();
  });
});

// The marker is not always at the project root. `saasaloy init .` inside an existing
// repository deliberately does not nest a second one, and the CLI's own `.dev/playground`
// is that shape — anchoring at the project root would refuse every write there.
describe("a project nested inside a repository", () => {
  it("reads the repository's .gitignore from above the project", async () => {
    await write(".gitignore", BASE_IGNORE);
    const project = join(root, "sub", "project");
    await mkdir(project, { recursive: true });

    await expect(
      isPathIgnored(project, "apps/api/.dev.vars")
    ).resolves.toBeTruthy();
  });

  it("says yes for a project sitting inside an ignored directory", async () => {
    await write(".gitignore", "playground/");
    const project = join(root, "playground");
    await mkdir(project, { recursive: true });

    await expect(isPathIgnored(project, "apps/web/.env")).resolves.toBeTruthy();
  });
});
