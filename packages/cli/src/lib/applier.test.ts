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
    const p = await plan({ install: ["api"], modules: [await apiCapability()], config, manifest });
    await executePlan(p, root, config, manifest);

    expect(manifest.managed["apps/api/src/index.ts"]).toMatchObject({
      module: "api",
      from: "files/src/index.ts",
    });
  });

  it("records `from` for a files[] entry resolved through an alias", async () => {
    const config: SaasaloyConfig = { aliases: { "@api": "apps/api/src" }, installed: [] };
    const manifest = emptyManifest();
    const mod = await writeModule(
      "waitlist",
      { type: "saasaloy:feature", files: [{ path: "files/routes/waitlist.ts", target: "@api/routes/waitlist.ts" }] },
      { "files/routes/waitlist.ts": "export const route = 1;\n" },
    );
    const p = await plan({ install: ["waitlist"], modules: [mod], config, manifest });
    await executePlan(p, root, config, manifest);

    expect(manifest.managed["apps/api/src/routes/waitlist.ts"]).toMatchObject({
      from: "files/routes/waitlist.ts",
    });
  });

  it("records `from` for a copied skill file", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const p = await plan({ install: ["api"], modules: [await skillModule()], config, manifest });
    await executePlan(p, root, config, manifest);

    expect(manifest.managed[".agents/skills/saasaloy-api/SKILL.md"]).toMatchObject({
      from: "skills/saasaloy-api/SKILL.md",
    });
  });

  it("passes schema validation with `from` present", async () => {
    const result = await validateManifest({
      managed: {
        "apps/api/src/index.ts": { module: "api", hash: "a".repeat(64), from: "files/src/index.ts" },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("still validates a manifest written before `from` existed", async () => {
    const result = await validateManifest({
      managed: { "apps/api/src/index.ts": { module: "api", hash: "a".repeat(64) } },
    });
    expect(result.valid).toBe(true);
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
