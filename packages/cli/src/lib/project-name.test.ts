import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectName } from "./project-name.js";

// #144: `update` used to render the template with `basename(root)`, so running it inside
// a git worktree rewrote `package.json` `name`, `wrangler.jsonc` `name` and `siteName` to
// the branch-named directory. The name has to come from the project.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-name-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(resolveProjectName, () => {
  it("prefers the name saasaloy.json records", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "from-package" }),
      "utf-8"
    );

    await expect(
      resolveProjectName(root, { name: "unishopr" })
    ).resolves.toStrictEqual({ name: "unishopr", source: "config" });
  });

  it("falls back to the root package.json for a project scaffolded before the field", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "unishopr-reborn" }),
      "utf-8"
    );

    await expect(resolveProjectName(root, {})).resolves.toStrictEqual({
      name: "unishopr-reborn",
      source: "package.json",
    });
  });

  it("uses the directory only when nothing else names the project", async () => {
    await expect(resolveProjectName(root, {})).resolves.toStrictEqual({
      name: basename(root),
      source: "directory",
    });
  });
});
