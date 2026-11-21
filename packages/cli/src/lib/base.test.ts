import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASE_DECLARATION,
  compileGlob,
  listTemplateFiles,
  ownedMatcher,
  readBaseDeclaration,
} from "./base.js";
import { baseTemplateDir } from "./scaffold.js";

// The base template as the render reads it (#120): its declaration and its files. These
// tests run against a throwaway template so the shipped one can change without moving
// them, except the block that pins the shipped declaration to the shipped files.

let template: string;
let root: string;

beforeEach(async () => {
  template = await mkdtemp(join(tmpdir(), "saasaloy-base-tpl-"));
  root = await mkdtemp(join(tmpdir(), "saasaloy-base-root-"));
});

afterEach(async () => {
  await rm(template, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

async function write(dir: string, rel: string, content: string): Promise<void> {
  const abs = join(dir, ...rel.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

async function declare(seedFiles: string[]): Promise<void> {
  await write(template, BASE_DECLARATION, JSON.stringify({ seedFiles }));
}

describe(readBaseDeclaration, () => {
  it("reads the seed list off the declaration", async () => {
    await declare(["README.md"]);

    await expect(readBaseDeclaration(template)).resolves.toStrictEqual({
      seedFiles: ["README.md"],
      retiredSeedFiles: [],
      ownedFiles: [],
    });
  });

  it("treats a template with no declaration as one with no seed files", async () => {
    await expect(readBaseDeclaration(template)).resolves.toStrictEqual({
      seedFiles: [],
      retiredSeedFiles: [],
      ownedFiles: [],
    });
  });

  it("folds a retired seed into the seed list", async () => {
    await write(
      template,
      BASE_DECLARATION,
      JSON.stringify({
        seedFiles: ["apps/web/DESIGN.md"],
        retiredSeedFiles: ["DESIGN.md"],
      })
    );

    await expect(readBaseDeclaration(template)).resolves.toStrictEqual({
      seedFiles: ["apps/web/DESIGN.md", "DESIGN.md"],
      retiredSeedFiles: ["DESIGN.md"],
      ownedFiles: [],
    });
  });

  it("rejects a declaration whose seed list is not a list of paths", async () => {
    await write(template, BASE_DECLARATION, JSON.stringify({ seedFiles: "x" }));

    await expect(readBaseDeclaration(template)).rejects.toThrow(
      BASE_DECLARATION
    );
  });
});

describe(listTemplateFiles, () => {
  it("lists every file with its source name and its rendered target", async () => {
    await write(template, "_gitignore", "dist\n");
    await write(template, "apps/web/package.json", "{}\n");

    const files = await listTemplateFiles(template);

    expect(files.map((f) => [f.from, f.target])).toStrictEqual([
      ["_gitignore", ".gitignore"],
      ["apps/web/package.json", "apps/web/package.json"],
    ]);
  });

  it("never lists the declaration itself", async () => {
    await declare([]);
    await write(template, "a.txt", "a\n");

    const files = await listTemplateFiles(template);

    expect(files.map((f) => f.target)).toStrictEqual(["a.txt"]);
  });
});

describe("the shipped declaration", () => {
  it("names only files the template ships", async () => {
    const dir = await baseTemplateDir();
    const declaration = await readBaseDeclaration(dir);
    const shipped = new Set(
      (await listTemplateFiles(dir)).map((f) => f.target)
    );

    const retired = new Set(declaration.retiredSeedFiles);
    const current = declaration.seedFiles.filter((seed) => !retired.has(seed));

    expect(current.length).toBeGreaterThan(0);
    for (const seed of current) {
      expect(shipped, `${seed} is declared seed but not shipped`).toContain(
        seed
      );
    }
    for (const seed of retired) {
      expect(shipped, `${seed} is retired but still shipped`).not.toContain(
        seed
      );
    }
  });

  // #234: the deploy runbook is the project's from the first day. `update` must never
  // overwrite a project's own runbook, and a project made earlier keeps its copy.
  it("seeds the deploy runbook", async () => {
    const dir = await baseTemplateDir();
    const declaration = await readBaseDeclaration(dir);
    const shipped = (await listTemplateFiles(dir)).map((f) => f.target);

    expect(declaration.seedFiles).toContain("docs/runbook-deploy.md");
    expect(shipped).toContain("docs/runbook-deploy.md");
  });

  // Plan 0116, re-grill Q2 and Q3: both merge, so neither is a seed or an owned file.
  it("leaves saasaloy.json and the key list to the merge", async () => {
    const declaration = await readBaseDeclaration(await baseTemplateDir());
    const isOwned = ownedMatcher(declaration);

    for (const target of ["saasaloy.json", "packages/env/.env.example"]) {
      expect(declaration.seedFiles).not.toContain(target);
      expect(isOwned(target)).toBeFalsy();
    }
  });

  it("is not itself copied into a project", async () => {
    const dir = await baseTemplateDir();
    const shipped = (await listTemplateFiles(dir)).map((f) => f.target);

    expect(shipped).not.toContain(BASE_DECLARATION);
    expect(shipped).not.toContain(`.${BASE_DECLARATION.slice(1)}`);
    await expect(
      readFile(join(dir, BASE_DECLARATION), "utf-8")
    ).resolves.toContain("seedFiles");
  });

  // #144: the template's own AGENTS.md says the project owns its blocks, components and
  // globals.css. Until `ownedFiles` shipped, nothing enforced it and `update` overwrote
  // every one of them.
  it("claims the files AGENTS.md tells the owner to edit", async () => {
    const dir = await baseTemplateDir();
    const isOwned = ownedMatcher(await readBaseDeclaration(dir));
    const shipped = (await listTemplateFiles(dir)).map((f) => f.target);

    for (const target of [
      "packages/ui/src/styles/globals.css",
      "packages/ui/src/styles/brand.css",
      "packages/ui/src/styles/web.css",
      "packages/ui/src/blocks/hero.tsx",
      "packages/ui/src/components/badge.tsx",
      "packages/ui/src/index.ts",
      "packages/ui/src/lib/icons.ts",
      "apps/web/src/layouts/Layout.astro",
      "apps/web/public/favicon.svg",
      "packages/tooling/src/deploy.config.ts",
      "packages/tooling/src/targets.ts",
    ]) {
      expect(shipped, `${target} is claimed but not shipped`).toContain(target);
      expect(isOwned(target), `${target} should be owned`).toBeTruthy();
    }
    for (const target of [
      "package.json",
      "AGENTS.md",
      "apps/web/wrangler.jsonc",
      "packages/tooling/src/deploy-production.ts",
      "packages/tooling/src/types.ts",
    ]) {
      expect(
        isOwned(target),
        `${target} should stay template-owned`
      ).toBeFalsy();
    }
  });
});

describe(compileGlob, () => {
  it.each([
    ["packages/ui/src/blocks/**", "packages/ui/src/blocks/hero.tsx", true],
    ["packages/ui/src/blocks/**", "packages/ui/src/blocks/deep/x.tsx", true],
    ["packages/ui/src/blocks/**", "packages/ui/src/lib/x.ts", false],
    ["apps/web/public/favicon.*", "apps/web/public/favicon.ico", true],
    ["apps/web/public/favicon.*", "apps/web/public/logo.svg", false],
    ["packages/ui/src/index.ts", "packages/ui/src/index.ts", true],
    ["packages/ui/src/index.ts", "packages/ui/src/index.tsx", false],
  ])("matches %s against %s", (pattern, target, expected) => {
    expect(compileGlob(pattern).test(target)).toBe(expected);
  });
});
