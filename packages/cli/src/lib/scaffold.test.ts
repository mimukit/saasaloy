import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyTemplate, templateVars } from "./scaffold.js";

describe("init template variables", () => {
  it("includes the CLI package version", () => {
    expect(templateVars("demo-app")).toStrictEqual({
      PROJECT_NAME: "demo-app",
      CLI_VERSION: "0.0.0",
    });
  });
});

// `copyTemplate` writes the whole base into someone's empty directory, and until #47 the
// only thing tested about it was the variable map. Both conventions it applies — the
// `_name` → `.name` rename and `{{VAR}}` substitution — are silent when they go wrong.
describe("copyTemplate — the two conventions it applies", () => {
  let src: string;
  let dest: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), "saasaloy-tpl-src-"));
    dest = join(await mkdtemp(join(tmpdir(), "saasaloy-tpl-dest-")), "out");
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(dirname(dest), { recursive: true, force: true });
  });

  async function write(path: string, content: string): Promise<void> {
    const file = join(src, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf-8");
  }

  it("creates the destination directory when it does not exist", async () => {
    await write("a.txt", "a\n");

    await copyTemplate(src, dest, {});

    await expect(readFile(join(dest, "a.txt"), "utf-8")).resolves.toBe("a\n");
  });

  it("substitutes every {{VAR}} token from the map", async () => {
    await write("package.json", '{ "name": "{{PROJECT_NAME}}" }');

    await copyTemplate(src, dest, { PROJECT_NAME: "my-app" });

    await expect(readFile(join(dest, "package.json"), "utf-8")).resolves.toBe(
      '{ "name": "my-app" }'
    );
  });

  it("substitutes the same token everywhere it appears", async () => {
    await write("readme.md", "{{PROJECT_NAME}} — run {{PROJECT_NAME}} dev");

    await copyTemplate(src, dest, { PROJECT_NAME: "my-app" });

    await expect(readFile(join(dest, "readme.md"), "utf-8")).resolves.toBe(
      "my-app — run my-app dev"
    );
  });

  it("leaves a token the map has no value for exactly as it was", async () => {
    await write("a.txt", "{{PROJECT_NAME}} {{UNKNOWN}}");

    await copyTemplate(src, dest, { PROJECT_NAME: "my-app" });

    await expect(readFile(join(dest, "a.txt"), "utf-8")).resolves.toBe(
      "my-app {{UNKNOWN}}"
    );
  });

  it("renames a leading underscore back into a dot", async () => {
    // npm refuses to publish a literal .gitignore inside a package, so the template
    // stores it de-dotted and the copy puts the dot back.
    await write("_gitignore", "node_modules\n");

    await copyTemplate(src, dest, {});

    await expect(readFile(join(dest, ".gitignore"), "utf-8")).resolves.toBe(
      "node_modules\n"
    );
  });

  it("renames a de-dotted directory too", async () => {
    await write("_husky/pre-commit", "pnpm lint\n");

    await copyTemplate(src, dest, {});

    await expect(
      readFile(join(dest, ".husky", "pre-commit"), "utf-8")
    ).resolves.toBe("pnpm lint\n");
  });

  it("copies nested directories to the same depth", async () => {
    await write(
      "apps/web/src/index.ts",
      "export const x = {{PROJECT_NAME}};\n"
    );

    await copyTemplate(src, dest, { PROJECT_NAME: "1" });

    await expect(
      readFile(join(dest, "apps", "web", "src", "index.ts"), "utf-8")
    ).resolves.toBe("export const x = 1;\n");
  });

  it("returns every file it wrote", async () => {
    await write("a.txt", "a");
    await write("nested/b.txt", "b");

    const written = await copyTemplate(src, dest, {});

    expect(written.toSorted()).toStrictEqual([
      join(dest, "a.txt"),
      join(dest, "nested", "b.txt"),
    ]);
  });

  it("overwrites a file already at the destination", async () => {
    await write("a.txt", "new\n");
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "a.txt"), "old\n", "utf-8");

    await copyTemplate(src, dest, {});

    await expect(readFile(join(dest, "a.txt"), "utf-8")).resolves.toBe("new\n");
  });
});
