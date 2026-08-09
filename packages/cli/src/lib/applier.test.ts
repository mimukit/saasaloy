import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan, executePlan } from "./applier.js";
import type { Plan } from "./applier.js";
import { pathExists } from "./fs-utils.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
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
  await rm(root, { force: true, recursive: true });
  await rm(moduleRoot, { force: true, recursive: true });
});

// Lay a module folder on disk (source files under its dir) and return its LoadedModule.
async function writeModule(
  name: string,
  item: Omit<RegistryItem, "name">,
  files: Record<string, string>
): Promise<LoadedModule> {
  const dir = join(moduleRoot, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
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

function plan({
  install,
  modules,
  config,
  manifest,
}: PlanInputs): Promise<Plan> {
  return buildPlan({
    alreadyInstalled: [],
    config: config ?? emptyConfig(),
    install,
    manifest: manifest ?? emptyManifest(),
    modules: new Map(modules.map((m) => [m.item.name, m])),
    root,
  });
}

// A capability whose whole workspace ships in one scaffold entry — the `api` shape.
async function apiCapability(): Promise<LoadedModule> {
  return writeModule(
    "api",
    {
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
      type: "saasaloy:capability",
    },
    {
      "files/package.json": '{ "name": "@app/api" }\n',
      "files/src/index.ts": "export default {};\n",
    }
  );
}

describe("buildPlan — scaffolds", () => {
  it("plans scaffold files at workspace-root-relative targets", async () => {
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
    });
    expect(p.files.map((f) => f.target).toSorted()).toStrictEqual([
      "apps/api/package.json",
      "apps/api/src/index.ts",
    ]);
    expect(p.files.every((f) => f.action === "create")).toBeTruthy();
    expect(p.files.every((f) => f.module === "api")).toBeTruthy();
  });

  it("collects the aliases a scaffold registers", async () => {
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
    });
    expect(p.aliases).toStrictEqual({ "@api": "apps/api/src" });
    expect(p.aliasConflicts).toStrictEqual([]);
  });

  it("no longer defers scaffolds (the field is gone)", async () => {
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
    });
    expect(p).not.toHaveProperty("deferredScaffolds");
  });

  it("resolves a same-run feature's files against the capability's new alias", async () => {
    const feature = await writeModule(
      "waitlist",
      {
        dependsOn: ["api"],
        files: [
          {
            path: "files/routes/waitlist.ts",
            target: "@api/routes/waitlist.ts",
          },
        ],
        type: "saasaloy:feature",
      },
      { "files/routes/waitlist.ts": "export default {};\n" }
    );
    // Topo order lands the capability first; the feature's @api target must resolve
    // even though @api isn't in the on-disk config yet.
    const p = await plan({
      install: ["api", "waitlist"],
      modules: [await apiCapability(), feature],
    });
    expect(p.files.map((f) => f.target)).toContain(
      "apps/api/src/routes/waitlist.ts"
    );
  });

  it("flags an alias that would redefine an existing one to a different path", async () => {
    const config: SaasaloyConfig = {
      aliases: { "@api": "packages/api/src" },
      installed: [],
    };
    const p = await plan({
      config,
      install: ["api"],
      modules: [await apiCapability()],
    });
    expect(p.aliasConflicts).toHaveLength(1);
    expect(p.aliasConflicts[0]).toContain("@api");
  });

  it("holds back a pre-existing untracked scaffold file as a conflict", async () => {
    // A file we never wrote (not in the manifest) sits at the scaffold target.
    const existing = join(root, "apps", "api", "package.json");
    await mkdir(dirname(existing), { recursive: true });
    await writeFile(existing, '{ "name": "hand-written" }\n', "utf-8");

    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
    });
    const pkg = p.files.find((f) => f.target === "apps/api/package.json");
    expect(pkg?.action).toBe("conflict");
  });
});

describe("executePlan — scaffolds", () => {
  it("writes the workspace, registers the alias, records the manifest", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api"],
      manifest,
      modules: [await apiCapability()],
    });

    const result = await executePlan(p, root, config, manifest);

    // Files landed on disk under the workspace root.
    await expect(
      pathExists(join(root, "apps", "api", "package.json"))
    ).resolves.toBeTruthy();
    await expect(
      readFile(join(root, "apps", "api", "src", "index.ts"), "utf-8")
    ).resolves.toBe("export default {};\n");
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
    await writeFile(existing, original, "utf-8");

    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api"],
      manifest,
      modules: [await apiCapability()],
    });
    const result = await executePlan(p, root, config, manifest);

    await expect(readFile(existing, "utf-8")).resolves.toBe(original);
    expect(result.heldBack.map((f) => f.target)).toContain(
      "apps/api/package.json"
    );
    // The conflicting file is not recorded as managed.
    expect(manifest.managed["apps/api/package.json"]).toBeUndefined();
  });
});

// A module shipping a Claude skill folder via agent.skills — the `api` runbook shape.
async function skillModule(name = "api"): Promise<LoadedModule> {
  const folder = `saasaloy-${name}`;
  return writeModule(
    name,
    {
      agent: { skills: [`skills/${folder}`] },
      type: "saasaloy:capability",
    },
    {
      [`skills/${folder}/SKILL.md`]: "# runbook\n",
      [`skills/${folder}/reference.md`]: "notes\n",
    }
  );
}

describe("buildPlan — skill links", () => {
  it("plans skill files under .agents/skills, not .claude/skills", async () => {
    const p = await plan({ install: ["api"], modules: [await skillModule()] });
    const skillTargets = p.files
      .filter((f) => f.isSkill)
      .map((f) => f.target)
      .toSorted();
    expect(skillTargets).toStrictEqual([
      ".agents/skills/saasaloy-api/SKILL.md",
      ".agents/skills/saasaloy-api/reference.md",
    ]);
    expect(
      p.files.some((f) => f.target.startsWith(".claude/skills"))
    ).toBeFalsy();
  });

  it("plans a .claude/skills → .agents/skills symlink per skill folder", async () => {
    const p = await plan({ install: ["api"], modules: [await skillModule()] });
    expect(p.links).toHaveLength(1);
    expect(p.links[0]).toMatchObject({
      action: "create",
      module: "api",
      path: ".claude/skills/saasaloy-api",
      target: ".agents/skills/saasaloy-api",
    });
  });
});

describe("executePlan — skill links", () => {
  it("writes real skill files and a symlink pointing at them, recorded in manifest.links", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api"],
      manifest,
      modules: [await skillModule()],
    });

    const result = await executePlan(p, root, config, manifest);

    // Real committed files under .agents/skills.
    await expect(
      readFile(join(root, ".agents/skills/saasaloy-api/SKILL.md"), "utf-8")
    ).resolves.toBe("# runbook\n");
    // A symlink at .claude/skills/saasaloy-api resolving to the .agents copy.
    const linkAbs = join(root, ".claude/skills/saasaloy-api");
    expect((await lstat(linkAbs)).isSymbolicLink()).toBeTruthy();
    const dest = await readlink(linkAbs);
    expect(resolve(dirname(linkAbs), dest)).toBe(
      resolve(join(root, ".agents/skills/saasaloy-api"))
    );
    // Recorded source → link for a clean remove.
    expect(manifest.links[".agents/skills/saasaloy-api"]).toBe(
      ".claude/skills/saasaloy-api"
    );
    expect(result.links).toHaveLength(1);
    expect(result.linkConflicts).toHaveLength(0);
  });

  it("is idempotent — a re-add sees the existing link and re-creates nothing", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mod = await skillModule();
    await executePlan(
      await plan({ config, install: ["api"], manifest, modules: [mod] }),
      root,
      config,
      manifest
    );

    // Second pass over the same tree: the link already resolves correctly.
    const second = await plan({
      config,
      install: ["api"],
      manifest,
      modules: [mod],
    });
    expect(second.links[0]?.action).toBe("exists");
    const result = await executePlan(second, root, config, manifest);
    expect(result.linkConflicts).toHaveLength(0);
    expect(
      (await lstat(join(root, ".claude/skills/saasaloy-api"))).isSymbolicLink()
    ).toBeTruthy();
  });

  it("holds back a .claude/skills path already occupied by something else", async () => {
    // A real directory (not our symlink) sits where the link would go.
    const occupied = join(root, ".claude/skills/saasaloy-api");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "SKILL.md"), "hand-written\n", "utf-8");

    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api"],
      manifest,
      modules: [await skillModule()],
    });
    expect(p.links[0]?.action).toBe("conflict");

    const result = await executePlan(p, root, config, manifest);
    expect(result.linkConflicts.map((l) => l.path)).toContain(
      ".claude/skills/saasaloy-api"
    );
    // The hand-written dir is left intact and nothing is recorded for it.
    expect((await lstat(occupied)).isDirectory()).toBeTruthy();
    expect(manifest.links[".agents/skills/saasaloy-api"]).toBeUndefined();
  });
});

describe("registry-item schema — tightened scaffolds", () => {
  it("accepts the committed { workspace, aliases, files } shape", async () => {
    const result = await validateRegistryItem({
      name: "api",
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [{ path: "files/src/index.ts", target: "src/index.ts" }],
        },
      ],
      type: "saasaloy:capability",
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects an @alias-prefixed scaffold target (must be workspace-root-relative)", async () => {
    const result = await validateRegistryItem({
      name: "api",
      scaffolds: [
        {
          workspace: "apps/api",
          files: [{ path: "files/src/index.ts", target: "@api/index.ts" }],
        },
      ],
      type: "saasaloy:capability",
    });
    expect(result.valid).toBeFalsy();
  });
});

describe("buildPlan — dep buckets", () => {
  it("aggregates dependencies and devDependencies into parallel plan arrays", async () => {
    const mod = await writeModule(
      "waitlist",
      {
        dependencies: ["zod@4.0.5"],
        devDependencies: ["@types/node@26.1.1"],
        type: "saasaloy:feature",
      },
      {}
    );
    const p = await plan({ install: ["waitlist"], modules: [mod] });
    expect(p.dependencies).toStrictEqual(["zod@4.0.5"]);
    expect(p.devDependencies).toStrictEqual(["@types/node@26.1.1"]);
  });
});

// --- Config patches: applied (not deferred), array-shaped, idempotent (ADR 0019). ---

// api variant that ships a real wrangler.jsonc scaffold file for `database` to patch.
async function apiWithWrangler(): Promise<LoadedModule> {
  return writeModule(
    "api",
    {
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [{ path: "files/wrangler.jsonc", target: "wrangler.jsonc" }],
        },
      ],
      type: "saasaloy:capability",
    },
    { "files/wrangler.jsonc": '{\n  "name": "api"\n}\n' }
  );
}

// A `database`-shaped capability: it patches the D1 binding into api's wrangler.jsonc.
async function dbCapability(): Promise<LoadedModule> {
  return writeModule(
    "database",
    {
      dependsOn: ["api"],
      patches: [
        {
          file: "apps/api/wrangler.jsonc",
          kind: "wrangler-binding",
          bindingType: "d1_databases",
          entry: {
            binding: "DB",
            database_name: "app-db",
            database_id: "local",
            migrations_dir: "../../packages/db/migrations",
          },
        },
      ],
      scaffolds: [
        {
          workspace: "packages/db",
          aliases: { "@db": "packages/db/src" },
          files: [{ path: "files/client.ts", target: "src/client.ts" }],
        },
      ],
      type: "saasaloy:capability",
    },
    { "files/client.ts": "export const x = 1;\n" }
  );
}

describe("buildPlan — config patches", () => {
  it("plans a patch against a same-run scaffolded file (not yet on disk)", async () => {
    const p = await plan({
      install: ["api", "database"],
      modules: [await apiWithWrangler(), await dbCapability()],
    });
    expect(p.patches).toHaveLength(1);
    const patch = p.patches[0];
    expect(patch).toMatchObject({
      action: "apply",
      file: "apps/api/wrangler.jsonc",
      module: "database",
    });
    expect(patch?.diff).toContain("d1_databases");
  });

  it("marks a patch unchanged when the binding is already present (idempotent)", async () => {
    const existing = join(root, "apps", "api", "wrangler.jsonc");
    await mkdir(dirname(existing), { recursive: true });
    await writeFile(
      existing,
      '{\n  "d1_databases": [{ "binding": "DB" }]\n}\n',
      "utf-8"
    );
    const p = await plan({
      install: ["database"],
      modules: [await dbCapability()],
    });
    expect(p.patches[0]?.action).toBe("unchanged");
  });

  it("marks a patch missing when the target is neither planned nor on disk", async () => {
    const p = await plan({
      install: ["database"],
      modules: [await dbCapability()],
    });
    expect(p.patches[0]?.action).toBe("missing");
  });
});

describe("executePlan — config patches", () => {
  it("writes the binding into the scaffolded file and does not track it as managed", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api", "database"],
      manifest,
      modules: [await apiWithWrangler(), await dbCapability()],
    });
    const result = await executePlan(p, root, config, manifest);

    const wrangler = await readFile(
      join(root, "apps", "api", "wrangler.jsonc"),
      "utf-8"
    );
    expect(wrangler).toContain("d1_databases");
    expect(wrangler).toContain('"binding": "DB"');
    // The patched file stays owned by whoever scaffolded it — the patch doesn't retrack it (ADR 0019).
    expect(manifest.managed["apps/api/wrangler.jsonc"]?.module).toBe("api");
    expect(result.patched.map((x) => x.file)).toContain(
      "apps/api/wrangler.jsonc"
    );
    expect(result.patchConflicts).toHaveLength(0);
  });

  it("is idempotent — a second apply changes nothing", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWithWrangler(), await dbCapability()];
    await executePlan(
      await plan({
        config,
        install: ["api", "database"],
        manifest,
        modules: mods,
      }),
      root,
      config,
      manifest
    );
    const before = await readFile(
      join(root, "apps", "api", "wrangler.jsonc"),
      "utf-8"
    );

    const second = await plan({
      config,
      install: ["api", "database"],
      manifest,
      modules: mods,
    });
    const result = await executePlan(second, root, config, manifest);
    expect(result.patched).toHaveLength(0);
    await expect(
      readFile(join(root, "apps", "api", "wrangler.jsonc"), "utf-8")
    ).resolves.toBe(before);
  });

  it("reports a conflict when the patch target is missing", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["database"],
      manifest,
      modules: [await dbCapability()],
    });
    const result = await executePlan(p, root, config, manifest);
    expect(result.patchConflicts.map((x) => x.file)).toContain(
      "apps/api/wrangler.jsonc"
    );
    expect(result.patched).toHaveLength(0);
  });

  it("records the applied patch in the manifest so `remove` can warn about it", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      config,
      install: ["api", "database"],
      manifest,
      modules: [await apiWithWrangler(), await dbCapability()],
    });
    await executePlan(p, root, config, manifest);

    expect(manifest.patches).toHaveLength(1);
    expect(manifest.patches[0]).toMatchObject({
      file: "apps/api/wrangler.jsonc",
      module: "database",
    });
    expect(manifest.patches[0]?.patch.kind).toBe("wrangler-binding");
  });

  it("dedupes an identical patch entry on re-apply (structural equality)", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWithWrangler(), await dbCapability()];
    await executePlan(
      await plan({
        config,
        install: ["api", "database"],
        manifest,
        modules: mods,
      }),
      root,
      config,
      manifest
    );
    expect(manifest.patches).toHaveLength(1);

    // Hand-revert the patched file so `--force` sees the same op apply again.
    await writeFile(
      join(root, "apps", "api", "wrangler.jsonc"),
      '{\n  "name": "api"\n}\n',
      "utf-8"
    );

    const second = await plan({
      config,
      install: ["api", "database"],
      manifest,
      modules: mods,
    });
    const result = await executePlan(second, root, config, manifest);
    expect(result.patched).toHaveLength(1);
    // Same module/file/patch as before — not duplicated.
    expect(manifest.patches).toHaveLength(1);
  });
});

describe("registry-item schema — pinned deps", () => {
  it("accepts exact-pinned dependencies (plain and scoped)", async () => {
    const result = await validateRegistryItem({
      dependencies: ["zod@4.0.5"],
      devDependencies: ["@types/node@26.1.1"],
      name: "waitlist",
      type: "saasaloy:feature",
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a bare (un-pinned) dependency", async () => {
    const result = await validateRegistryItem({
      dependencies: ["zod"],
      name: "waitlist",
      type: "saasaloy:feature",
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a floating-range dependency", async () => {
    const result = await validateRegistryItem({
      dependencies: ["zod@^4.0.5"],
      name: "waitlist",
      type: "saasaloy:feature",
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a bare devDependency", async () => {
    const result = await validateRegistryItem({
      devDependencies: ["@types/node"],
      name: "waitlist",
      type: "saasaloy:feature",
    });
    expect(result.valid).toBeFalsy();
  });
});

describe("registry-item schema — config patches", () => {
  it("accepts a patches array of a wrangler-binding op", async () => {
    const result = await validateRegistryItem({
      name: "database",
      patches: [
        {
          file: "apps/api/wrangler.jsonc",
          kind: "wrangler-binding",
          bindingType: "d1_databases",
          entry: { binding: "DB" },
        },
      ],
      type: "saasaloy:capability",
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a patch op missing its file", async () => {
    const result = await validateRegistryItem({
      name: "database",
      patches: [
        {
          kind: "wrangler-binding",
          bindingType: "d1_databases",
          entry: { binding: "DB" },
        },
      ],
      type: "saasaloy:capability",
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects the legacy object-shaped patches", async () => {
    const result = await validateRegistryItem({
      name: "api",
      patches: {},
      type: "saasaloy:capability",
    });
    expect(result.valid).toBeFalsy();
  });
});
