import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptBase,
  BASE_DECLARATION,
  BASE_MODULE,
  BASE_NO_MERGE_BASE,
  baseEntries,
  baseRecord,
  baseUpdateInput,
  isBaseTracked,
  listTemplateFiles,
  missingBaseTargets,
  compileGlob,
  ownedMatcher,
  readBaseDeclaration,
  recordBaseFiles,
  templateHash,
} from "./base.js";
import { hashContent, pathExists } from "./fs-utils.js";
import { emptyLock, loadLock } from "./lock.js";
import type { Lockfile } from "./lock.js";
import { emptyManifest, loadManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import { applyPatch } from "./patch/index.js";
import { baseTemplateDir, copyTemplate, templateVars } from "./scaffold.js";
import { buildUpdatePlan, compareBase, executeUpdatePlan } from "./updater.js";
import type { ModuleUpdatePlan } from "./updater.js";

// The base's provenance (#120): which template files `init` laid down, at which hash, from
// which CLI. Everything here runs against a throwaway template so the shipped one can
// change without moving these expectations — except the last block, which pins the
// shipped declaration to the shipped files.

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
      ownedFiles: [],
    });
  });

  it("treats a template with no declaration as one with no seed files", async () => {
    await expect(readBaseDeclaration(template)).resolves.toStrictEqual({
      seedFiles: [],
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

describe(templateHash, () => {
  it("is stable across two reads of the same template", async () => {
    await write(template, "a.txt", "a\n");

    await expect(templateHash(template)).resolves.toBe(
      await templateHash(template)
    );
  });

  // The hash is cached per process — a template does not change under a running CLI —
  // so a changed template is a second directory here.
  it("changes when a file's content changes", async () => {
    const other = await mkdtemp(join(tmpdir(), "saasaloy-base-tpl-"));
    await write(template, "a.txt", "a\n");
    await write(other, "a.txt", "b\n");

    await expect(templateHash(other)).resolves.not.toBe(
      await templateHash(template)
    );
    await rm(other, { recursive: true, force: true });
  });

  it("changes when a file is added", async () => {
    const other = await mkdtemp(join(tmpdir(), "saasaloy-base-tpl-"));
    await write(template, "a.txt", "a\n");
    await write(other, "a.txt", "a\n");
    await write(other, "b.txt", "b\n");

    await expect(templateHash(other)).resolves.not.toBe(
      await templateHash(template)
    );
    await rm(other, { recursive: true, force: true });
  });

  it("is a sha256 digest", async () => {
    await write(template, "a.txt", "a\n");

    await expect(templateHash(template)).resolves.toMatch(/^[a-f0-9]{64}$/);
  });
});

describe(recordBaseFiles, () => {
  it("writes one entry per file under the reserved module name", () => {
    const manifest = emptyManifest();

    recordBaseFiles(manifest, [
      { target: ".gitignore", from: "_gitignore", hash: hashContent("x") },
    ]);

    expect(manifest.managed[".gitignore"]).toStrictEqual({
      module: BASE_MODULE,
      hash: hashContent("x"),
      from: "_gitignore",
    });
  });

  it("drops base entries the new list no longer carries, and no one else's", () => {
    const manifest = emptyManifest();
    manifest.managed["old.txt"] = {
      module: BASE_MODULE,
      hash: hashContent("o"),
    };
    manifest.managed["theirs.ts"] = { module: "email", hash: hashContent("e") };

    recordBaseFiles(manifest, [
      { target: "new.txt", from: "new.txt", hash: hashContent("n") },
    ]);

    expect(Object.keys(manifest.managed).toSorted()).toStrictEqual([
      "new.txt",
      "theirs.ts",
    ]);
  });
});

describe(isBaseTracked, () => {
  it("is false with no lock record", () => {
    const manifest = emptyManifest();
    manifest.managed["a.txt"] = { module: BASE_MODULE, hash: hashContent("a") };

    expect(isBaseTracked(emptyLock(), manifest)).toBeFalsy();
  });

  it("is false when the lock has a record but the manifest has no base entries", () => {
    const lock = { ...emptyLock(), base: baseRecord("0.0.0", "f".repeat(64)) };

    expect(isBaseTracked(lock, emptyManifest())).toBeFalsy();
  });

  it("is true when both halves are present", () => {
    const lock = { ...emptyLock(), base: baseRecord("0.0.0", "f".repeat(64)) };
    const manifest = emptyManifest();
    manifest.managed["a.txt"] = { module: BASE_MODULE, hash: hashContent("a") };

    expect(isBaseTracked(lock, manifest)).toBeTruthy();
  });
});

describe(adoptBase, () => {
  it("records every template file at the hash it has on disk", async () => {
    await write(template, "a.txt", "template {{PROJECT_NAME}}\n");
    await write(root, "a.txt", "edited by the owner\n");
    const manifest = emptyManifest();
    const lock = emptyLock();

    const result = await adoptBase({
      root,
      cliVersion: "0.0.0",
      projectName: basename(root),
      manifest,
      lock,
      templateDir: template,
    });

    expect(result.adopted).toStrictEqual(["a.txt"]);
    expect(manifest.managed["a.txt"]).toStrictEqual({
      module: BASE_MODULE,
      hash: hashContent("edited by the owner\n"),
      // The hash came off disk, so the next update must not read it as template output.
      adopted: true,
      from: "a.txt",
    });
    expect(lock.base).toStrictEqual(
      baseRecord("0.0.0", await templateHash(template))
    );
  });

  it("records a template file missing from disk at its rendered hash, so the next update restores it", async () => {
    await write(template, "a.txt", "hello {{PROJECT_NAME}}\n");
    const manifest = emptyManifest();

    const result = await adoptBase({
      root,
      cliVersion: "0.0.0",
      projectName: basename(root),
      manifest,
      lock: emptyLock(),
      templateDir: template,
    });

    expect(result.absent).toStrictEqual(["a.txt"]);
    expect(manifest.managed["a.txt"]?.hash).toBe(
      hashContent(`hello ${basename(root)}\n`)
    );
  });

  it("does not record a file on disk the template no longer ships", async () => {
    await write(template, "a.txt", "a\n");
    await write(root, "a.txt", "a\n");
    await write(root, "stale.txt", "gone upstream\n");
    const manifest = emptyManifest();

    await adoptBase({
      root,
      cliVersion: "0.0.0",
      projectName: basename(root),
      manifest,
      lock: emptyLock(),
      templateDir: template,
    });

    expect(manifest.managed["stale.txt"]).toBeUndefined();
  });

  it("saves both state files, and a dry run saves neither", async () => {
    await write(template, "a.txt", "a\n");
    await write(root, "a.txt", "a\n");

    await adoptBase({
      root,
      cliVersion: "0.0.0",
      projectName: basename(root),
      manifest: emptyManifest(),
      lock: emptyLock(),
      templateDir: template,
      dryRun: true,
    });
    await expect(
      pathExists(join(root, "saasaloy-lock.json"))
    ).resolves.toBeFalsy();
    await expect(pathExists(join(root, ".saasaloy"))).resolves.toBeFalsy();

    await adoptBase({
      root,
      cliVersion: "0.0.0",
      projectName: basename(root),
      manifest: emptyManifest(),
      lock: emptyLock(),
      templateDir: template,
    });
    expect((await loadLock(root)).base?.cliVersion).toBe("0.0.0");
    expect(baseEntries(await loadManifest(root))).toHaveProperty("a.txt");
  });
});

describe("the shipped declaration", () => {
  it("names only files the template ships", async () => {
    const dir = await baseTemplateDir();
    const declaration = await readBaseDeclaration(dir);
    const shipped = new Set(
      (await listTemplateFiles(dir)).map((f) => f.target)
    );

    expect(declaration.seedFiles.length).toBeGreaterThan(0);
    for (const seed of declaration.seedFiles) {
      expect(shipped, `${seed} is declared seed but not shipped`).toContain(
        seed
      );
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
      "packages/ui/src/blocks/hero.tsx",
      "packages/ui/src/components/badge.tsx",
      "packages/ui/src/index.ts",
      "apps/web/src/layouts/Layout.astro",
      "apps/web/public/favicon.svg",
    ]) {
      expect(shipped, `${target} is claimed but not shipped`).toContain(target);
      expect(isOwned(target), `${target} should be owned`).toBeTruthy();
    }
    for (const target of [
      "package.json",
      "AGENTS.md",
      "apps/web/wrangler.jsonc",
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

// --- The update path: the base as a module the engine already knows how to update ------

function trackedState(hash: string, version = "0.1.0") {
  const manifest = emptyManifest();
  manifest.managed["a.txt"] = { module: BASE_MODULE, hash: hashContent("a") };
  return {
    lock: { ...emptyLock(), base: baseRecord(version, hash) },
    manifest,
  };
}

function actionOf(mod: ModuleUpdatePlan, target: string) {
  return [...mod.files, ...mod.removals].find((f) => f.target === target)
    ?.action;
}

describe(missingBaseTargets, () => {
  it("names tracked base files that are not on disk", async () => {
    await declare([]);
    await write(root, "kept.txt", "here\n");
    const manifest = emptyManifest();
    recordBaseFiles(manifest, [
      { target: "kept.txt", from: "kept.txt", hash: hashContent("here\n") },
      { target: "gone.txt", from: "gone.txt", hash: hashContent("gone\n") },
    ]);

    await expect(
      missingBaseTargets(root, manifest, template)
    ).resolves.toStrictEqual(["gone.txt"]);
  });

  it("ignores a missing seed file, which no plan would restore anyway", async () => {
    await declare(["seed.txt"]);
    const manifest = emptyManifest();
    recordBaseFiles(manifest, [
      { target: "seed.txt", from: "seed.txt", hash: hashContent("seed\n") },
    ]);

    await expect(
      missingBaseTargets(root, manifest, template)
    ).resolves.toStrictEqual([]);
  });

  it("ignores entries another module owns", async () => {
    await declare([]);
    const manifest = emptyManifest();
    manifest.managed["theirs.txt"] = { module: "waitlist", hash: "a" };

    await expect(
      missingBaseTargets(root, manifest, template)
    ).resolves.toStrictEqual([]);
  });
});

describe(compareBase, () => {
  const running = { runningHash: "a".repeat(64), runningVersion: "0.2.0" };
  const tracked = trackedState;

  it("is current when the recorded template hash matches the running one", () => {
    const row = compareBase({ ...tracked("a".repeat(64)), ...running });

    expect(row).toMatchObject({ name: BASE_MODULE, status: "current" });
  });

  it("is outdated when the hashes differ, carrying both versions as labels", () => {
    const row = compareBase({ ...tracked("b".repeat(64)), ...running });

    expect(row.status).toBe("outdated");
    expect(row.current).toContain("0.1.0");
    expect(row.current).toContain("bbbbbbb");
    expect(row.latest).toContain("0.2.0");
    expect(row.latest).toContain("aaaaaaa");
  });

  // The bug this guards: `adoptBase` records an absent template file so "the next update
  // restores it", but a same-CLI re-run has an unmoved template hash. Comparing the hash
  // alone reported `current`, so the restore never ran on the version that recorded it.
  it("is outdated at an unmoved hash when a tracked file is missing from disk", () => {
    const row = compareBase({
      ...tracked("a".repeat(64)),
      ...running,
      missingTargets: ["a.txt"],
    });

    expect(row.status).toBe("outdated");
    expect(row.detail).toContain("missing from disk");
  });

  it("carries no missing-file detail when the hash itself moved", () => {
    const row = compareBase({
      ...tracked("b".repeat(64)),
      ...running,
      missingTargets: ["a.txt"],
    });

    expect(row.status).toBe("outdated");
    expect(row.detail).toBeUndefined();
  });

  it("is untracked with no lock record, pointing at `saasaloy update`", () => {
    const row = compareBase({
      lock: emptyLock(),
      manifest: emptyManifest(),
      ...running,
    });

    expect(row.status).toBe("untracked");
    expect(row.detail).toContain("saasaloy update");
  });

  it("is untracked when the lock has a record but the manifest has no base entries", () => {
    const row = compareBase({
      lock: { ...emptyLock(), base: baseRecord("0.1.0", "a".repeat(64)) },
      manifest: emptyManifest(),
      ...running,
    });

    expect(row.status).toBe("untracked");
  });
});

describe("baseUpdateInput — classifying base files through the module engine", () => {
  const CLI = "0.0.0";

  /** Scaffold `root` from `template` exactly as `init` does, and record it. */
  async function scaffold(): Promise<{ manifest: Manifest; lock: Lockfile }> {
    const written = await copyTemplate(
      template,
      root,
      templateVars(basename(root))
    );
    const manifest = emptyManifest();
    recordBaseFiles(manifest, written);
    const lock = {
      ...emptyLock(),
      base: baseRecord(CLI, await templateHash(template)),
    };
    return { manifest, lock };
  }

  /** A second template dir standing in for the one a newer CLI ships. */
  async function bumped(files: Record<string, string>): Promise<string> {
    const next = await mkdtemp(join(tmpdir(), "saasaloy-base-next-"));
    for (const [rel, content] of Object.entries(files)) {
      await write(next, rel, content);
    }
    return next;
  }

  async function planAgainst(
    next: string,
    state: { manifest: Manifest; lock: Lockfile }
  ) {
    const handle = await baseUpdateInput({
      root,
      manifest: state.manifest,
      lock: state.lock,
      templateDir: next,
      cliVersion: CLI,
      projectName: basename(root),
      comparison: compareBase({
        ...state,
        runningHash: await templateHash(next),
        runningVersion: CLI,
      }),
    });
    const plan = await buildUpdatePlan({
      root,
      config: { aliases: {}, installed: [] },
      manifest: state.manifest,
      lock: state.lock,
      inputs: [handle.input],
      considered: [],
    });
    return { plan, cleanup: handle.cleanup, base: plan.modules[0]! };
  }

  it("overwrites a clean file the template changed, and stamps the no-merge-base reason", async () => {
    await write(template, "AGENTS.md", "v1\n");
    const state = await scaffold();
    const next = await bumped({ "AGENTS.md": "v2\n" });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "AGENTS.md")).toBe("overwrite");
    expect(base.noMergeBase).toBe(BASE_NO_MERGE_BASE);
    expect(base.baseRecord).toStrictEqual(
      baseRecord(CLI, await templateHash(next))
    );
    await cleanup();
  });

  it("routes a hand-edited file into the merge plan", async () => {
    await write(template, "AGENTS.md", "v1\n");
    const state = await scaffold();
    await write(root, "AGENTS.md", "v1 plus my rules\n");
    const next = await bumped({ "AGENTS.md": "v2\n" });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "AGENTS.md")).toBe("drift");
    expect(base.needsMerge).toBeTruthy();
    await cleanup();
  });

  it("compares against the render for this project, so a substituted file is not drift", async () => {
    await write(template, "package.json", '{"name":"{{PROJECT_NAME}}"}\n');
    const state = await scaffold();
    const next = await bumped({
      "package.json": '{"name":"{{PROJECT_NAME}}","v":2}\n',
    });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "package.json")).toBe("overwrite");
    expect(base.files[0]?.theirs).toBe(`{"name":"${basename(root)}","v":2}\n`);
    await cleanup();
  });

  it("skips every declared seed file, as a file and as a removal", async () => {
    await write(template, "README.md", "seed\n");
    await write(template, "AGENTS.md", "v1\n");
    await declare(["README.md"]);
    const state = await scaffold();
    // The next template drops README.md entirely *and* changes it — neither may reach the plan.
    const next = await bumped({ "AGENTS.md": "v2\n" });
    await write(
      next,
      BASE_DECLARATION,
      JSON.stringify({ seedFiles: ["README.md"] })
    );

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "README.md")).toBeUndefined();
    expect(base.files.map((f) => f.target)).toStrictEqual(["AGENTS.md"]);
    expect(base.removals).toStrictEqual([]);
    await cleanup();
  });

  it("restores a tracked base file that is missing from disk", async () => {
    await write(template, "AGENTS.md", "v1\n");
    const state = await scaffold();
    await rm(join(root, "AGENTS.md"));
    const next = await bumped({ "AGENTS.md": "v1\n" });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "AGENTS.md")).toBe("restore");
    await cleanup();
  });

  // The whole loop `adoptBase`'s message promises, on one CLI: adopt a project whose file
  // is absent, then update against the *same* template and get the file back. Before
  // `missingTargets`, this second run reported "already at" and wrote nothing.
  it("restores an adopted-absent file on a re-run at the same template hash", async () => {
    await declare([]);
    await write(template, "AGENTS.md", "v1 {{PROJECT_NAME}}\n");
    const manifest = emptyManifest();
    const lock = emptyLock();
    const adoption = await adoptBase({
      root,
      cliVersion: CLI,
      projectName: basename(root),
      manifest,
      lock,
      templateDir: template,
    });
    expect(adoption.absent).toStrictEqual(["AGENTS.md"]);

    const state = { manifest, lock };
    const comparison = compareBase({
      ...state,
      runningHash: await templateHash(template),
      runningVersion: CLI,
      missingTargets: await missingBaseTargets(root, manifest, template),
    });
    expect(comparison.status).toBe("outdated");

    const handle = await baseUpdateInput({
      root,
      ...state,
      templateDir: template,
      cliVersion: CLI,
      projectName: basename(root),
      comparison,
    });
    const config = { aliases: {}, installed: [] };
    const plan = await buildUpdatePlan({
      root,
      config,
      ...state,
      inputs: [handle.input],
      considered: [],
    });
    expect(actionOf(plan.modules[0]!, "AGENTS.md")).toBe("restore");
    await executeUpdatePlan(plan, { root, config, ...state });

    await expect(readFile(join(root, "AGENTS.md"), "utf-8")).resolves.toBe(
      `v1 ${basename(root)}\n`
    );
    // And the third run is genuinely quiet.
    await expect(
      missingBaseTargets(root, manifest, template)
    ).resolves.toStrictEqual([]);
    await handle.cleanup();
  });

  it("re-applies a module's recorded patch after overwriting the file it patched", async () => {
    await write(template, "apps/web/package.json", '{"scripts":{}}\n');
    const state = await scaffold();
    const patch = {
      kind: "package-json-script" as const,
      file: "apps/web/package.json",
      name: "waitlist:dev",
      value: "wrangler dev",
    };
    state.manifest.patches.push({
      module: "waitlist",
      file: patch.file,
      patch,
    });
    const next = await bumped({
      "apps/web/package.json": '{"scripts":{},"v":2}\n',
    });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "apps/web/package.json")).toBe("overwrite");
    expect(base.patches).toHaveLength(1);
    expect(base.patches[0]).toMatchObject({
      module: "waitlist",
      action: "apply",
    });
    expect(base.files[0]?.patchedBy).toStrictEqual(["waitlist"]);
    await cleanup();
  });

  it("reads a file that holds exactly the new render plus its patches as unchanged", async () => {
    await write(template, "apps/web/package.json", '{"scripts":{}}\n');
    const state = await scaffold();
    const patch = {
      kind: "package-json-script" as const,
      file: "apps/web/package.json",
      name: "waitlist:dev",
      value: "wrangler dev",
    };
    state.manifest.patches.push({
      module: "waitlist",
      file: patch.file,
      patch,
    });
    // `add` applied the patch after `init` recorded the hash, which is what the disk holds.
    await write(
      root,
      "apps/web/package.json",
      applyPatch('{"scripts":{}}\n', patch, patch.file).content
    );
    const next = await bumped({ "apps/web/package.json": '{"scripts":{}}\n' });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "apps/web/package.json")).toBe("unchanged");
    await cleanup();
  });

  it("demotes an overwrite to drift when a recorded patch no longer matches the new render", async () => {
    await write(template, "apps/web/package.json", '{"scripts":{}}\n');
    const state = await scaffold();
    const patch = {
      kind: "package-json-dependency" as const,
      file: "apps/web/package.json",
      section: "dependencies" as const,
      name: "zod",
      range: "3.0.0",
    };
    state.manifest.patches.push({
      module: "waitlist",
      file: patch.file,
      patch,
    });
    // The template now ships its own `zod` pin — the patch's identity, a different value.
    const next = await bumped({
      "apps/web/package.json":
        '{"scripts":{},"dependencies":{"zod":"4.0.0"}}\n',
    });

    const { base, cleanup } = await planAgainst(next, state);

    expect(actionOf(base, "apps/web/package.json")).toBe("drift");
    expect(base.patches[0]?.matched).toBeDefined();
    expect(base.needsMerge).toBeTruthy();
    await cleanup();
  });

  it("moves the lock's base record only on a clean run, and rewrites the manifest entries", async () => {
    await write(template, "AGENTS.md", "v1\n");
    await write(template, "CLAUDE.md", "c1\n");
    const clean = await scaffold();
    const next = await bumped({ "AGENTS.md": "v2\n", "CLAUDE.md": "c2\n" });
    const config = { aliases: {}, installed: [] };

    const first = await planAgainst(next, clean);
    await executeUpdatePlan(first.plan, { root, config, ...clean });
    expect(clean.lock.base).toStrictEqual(
      baseRecord(CLI, await templateHash(next))
    );
    expect(clean.manifest.managed["AGENTS.md"]?.hash).toBe(hashContent("v2\n"));
    await first.cleanup();

    await write(root, "CLAUDE.md", "mine\n");
    const later = await bumped({ "AGENTS.md": "v3\n", "CLAUDE.md": "c3\n" });
    const second = await planAgainst(later, clean);
    const before = { ...clean.lock.base! };
    await executeUpdatePlan(second.plan, { root, config, ...clean });
    expect(clean.lock.base).toStrictEqual(before);
    expect(clean.lock.modules).toStrictEqual({});
    await second.cleanup();
  });

  it("re-reads the root package.json it just overwrote before writing module dependency pins", async () => {
    await write(template, "package.json", '{"name":"app","dependencies":{}}\n');
    const state = await scaffold();
    const next = await bumped({
      "package.json": '{"name":"app","v":2,"dependencies":{}}\n',
    });
    const handle = await baseUpdateInput({
      root,
      manifest: state.manifest,
      lock: state.lock,
      templateDir: next,
      cliVersion: CLI,
      projectName: basename(root),
      comparison: compareBase({
        ...state,
        runningHash: await templateHash(next),
        runningVersion: CLI,
      }),
    });
    const pkg = { name: "app", dependencies: {} };
    const plan = await buildUpdatePlan({
      root,
      config: { aliases: {}, installed: [] },
      manifest: state.manifest,
      lock: state.lock,
      inputs: [handle.input],
      considered: [],
      pkg,
    });
    plan.modules[0]!.depAdds.push({ name: "zod", version: "4.0.0" });

    await executeUpdatePlan(plan, {
      root,
      config: { aliases: {}, installed: [] },
      ...state,
      pkg,
    });

    const written = JSON.parse(
      await readFile(join(root, "package.json"), "utf-8")
    );
    expect(written).toMatchObject({ v: 2, dependencies: { zod: "4.0.0" } });
    await handle.cleanup();
  });
});
