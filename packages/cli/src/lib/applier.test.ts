import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan, executePlan, type Plan } from "./applier.js";
import { pathExists } from "./fs-utils.js";
import { emptyManifest, type Manifest } from "./manifest.js";
import type { LoadedModule } from "./registry.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";
import { validateRegistryItem } from "./schema.js";

// The scaffold applier: a capability's scaffolds[] must materialize a whole workspace —
// files copied to workspace-root-relative targets, the declared alias registered into
// saasaloy.json, everything tracked in the manifest — reusing the files[] machinery.

let root: string;
let moduleRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-scaffold-root-"));
  moduleRoot = await mkdtemp(join(tmpdir(), "saasaloy-scaffold-mod-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(moduleRoot, { recursive: true, force: true });
});

// Lay a module folder on disk (source files under its dir) and return its LoadedModule.
async function writeModule(
  name: string,
  item: Omit<RegistryItem, "name">,
  files: Record<string, string>,
): Promise<LoadedModule> {
  const dir = join(moduleRoot, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return { dir, item: { name, ...item } };
}

function emptyConfig(): SaasaloyConfig {
  return { aliases: {}, installed: [] };
}

interface PlanInputs {
  install: string[];
  modules: LoadedModule[];
  config?: SaasaloyConfig;
  manifest?: Manifest;
}

function plan({ install, modules, config, manifest }: PlanInputs): Promise<Plan> {
  return buildPlan({
    root,
    install,
    alreadyInstalled: [],
    modules: new Map(modules.map((m) => [m.item.name, m])),
    config: config ?? emptyConfig(),
    manifest: manifest ?? emptyManifest(),
  });
}

// A capability whose whole workspace ships in one scaffold entry — the `api` shape.
async function apiCapability(): Promise<LoadedModule> {
  return writeModule(
    "api",
    {
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [
            { path: "files/package.json", target: "package.json" },
            { path: "files/src/index.ts", target: "src/index.ts" },
          ],
        },
      ],
    },
    {
      "files/package.json": '{ "name": "@app/api" }\n',
      "files/src/index.ts": "export default {};\n",
    },
  );
}

describe("buildPlan — scaffolds", () => {
  it("plans scaffold files at workspace-root-relative targets", async () => {
    const p = await plan({ install: ["api"], modules: [await apiCapability()] });
    expect(p.files.map((f) => f.target).sort()).toEqual([
      "apps/api/package.json",
      "apps/api/src/index.ts",
    ]);
    expect(p.files.every((f) => f.action === "create")).toBe(true);
    expect(p.files.every((f) => f.module === "api")).toBe(true);
  });

  it("collects the aliases a scaffold registers", async () => {
    const p = await plan({ install: ["api"], modules: [await apiCapability()] });
    expect(p.aliases).toEqual({ "@api": "apps/api/src" });
    expect(p.aliasConflicts).toEqual([]);
  });

  it("no longer defers scaffolds (the field is gone)", async () => {
    const p = await plan({ install: ["api"], modules: [await apiCapability()] });
    expect(p).not.toHaveProperty("deferredScaffolds");
  });

  it("resolves a same-run feature's files against the capability's new alias", async () => {
    const feature = await writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        dependsOn: ["api"],
        files: [{ path: "files/routes/waitlist.ts", target: "@api/routes/waitlist.ts" }],
      },
      { "files/routes/waitlist.ts": "export default {};\n" },
    );
    // Topo order lands the capability first; the feature's @api target must resolve
    // even though @api isn't in the on-disk config yet.
    const p = await plan({ install: ["api", "waitlist"], modules: [await apiCapability(), feature] });
    expect(p.files.map((f) => f.target)).toContain("apps/api/src/routes/waitlist.ts");
  });

  it("flags an alias that would redefine an existing one to a different path", async () => {
    const config: SaasaloyConfig = { aliases: { "@api": "packages/api/src" }, installed: [] };
    const p = await plan({ install: ["api"], modules: [await apiCapability()], config });
    expect(p.aliasConflicts).toHaveLength(1);
    expect(p.aliasConflicts[0]).toContain("@api");
  });

  it("holds back a pre-existing untracked scaffold file as a conflict", async () => {
    // A file we never wrote (not in the manifest) sits at the scaffold target.
    const existing = join(root, "apps", "api", "package.json");
    await mkdir(dirname(existing), { recursive: true });
    await writeFile(existing, '{ "name": "hand-written" }\n', "utf8");

    const p = await plan({ install: ["api"], modules: [await apiCapability()] });
    const pkg = p.files.find((f) => f.target === "apps/api/package.json");
    expect(pkg?.action).toBe("conflict");
  });
});

describe("executePlan — scaffolds", () => {
  it("writes the workspace, registers the alias, records the manifest", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({ install: ["api"], modules: [await apiCapability()], config, manifest });

    const result = await executePlan(p, root, config, manifest);

    // Files landed on disk under the workspace root.
    expect(await pathExists(join(root, "apps", "api", "package.json"))).toBe(true);
    expect(await readFile(join(root, "apps", "api", "src", "index.ts"), "utf8")).toBe(
      "export default {};\n",
    );
    // Alias registered + module marked installed.
    expect(config.aliases["@api"]).toBe("apps/api/src");
    expect(config.installed).toContain("api");
    // Every scaffold file tracked so `remove` can undo it.
    expect(manifest.managed["apps/api/package.json"]?.module).toBe("api");
    expect(manifest.managed["apps/api/src/index.ts"]?.module).toBe("api");
    expect(result.written).toHaveLength(2);
    expect(result.heldBack).toHaveLength(0);
  });

  it("does not clobber a held-back conflict", async () => {
    const original = '{ "name": "hand-written" }\n';
    const existing = join(root, "apps", "api", "package.json");
    await mkdir(dirname(existing), { recursive: true });
    await writeFile(existing, original, "utf8");

    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({ install: ["api"], modules: [await apiCapability()], config, manifest });
    const result = await executePlan(p, root, config, manifest);

    expect(await readFile(existing, "utf8")).toBe(original);
    expect(result.heldBack.map((f) => f.target)).toContain("apps/api/package.json");
    // The conflicting file is not recorded as managed.
    expect(manifest.managed["apps/api/package.json"]).toBeUndefined();
  });
});

describe("registry-item schema — tightened scaffolds", () => {
  it("accepts the committed { workspace, aliases, files } shape", async () => {
    const result = await validateRegistryItem({
      name: "api",
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [{ path: "files/src/index.ts", target: "src/index.ts" }],
        },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an @alias-prefixed scaffold target (must be workspace-root-relative)", async () => {
    const result = await validateRegistryItem({
      name: "api",
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          files: [{ path: "files/src/index.ts", target: "@api/index.ts" }],
        },
      ],
    });
    expect(result.valid).toBe(false);
  });
});
