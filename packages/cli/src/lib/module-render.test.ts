import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan, executePlan } from "./applier.js";
import { hashContent } from "./fs-utils.js";
import { emptyLock } from "./lock.js";
import { emptyManifest } from "./manifest.js";
import { readModuleFile, renderModule } from "./module-render.js";
import type { LoadedModule } from "./registry.js";
import { templateVars } from "./scaffold.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";
import { buildUpdatePlan } from "./updater.js";

// `saasaloy add` renders `{{PROJECT_NAME}}` in module files and patch entries (#197), so two
// projects in one Cloudflare account get two Workers and two databases, and `update` compares
// the rendered bytes rather than reporting every templated file as changed.

const WRANGLER = '{\n  "name": "{{PROJECT_NAME}}-api"\n}\n';

let root: string;
let moduleRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-render-root-"));
  moduleRoot = await mkdtemp(join(tmpdir(), "saasaloy-render-mod-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(moduleRoot, { recursive: true, force: true });
});

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

function api(): Promise<LoadedModule> {
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
    { "files/wrangler.jsonc": WRANGLER }
  );
}

function d1(): Promise<LoadedModule> {
  return writeModule("database-d1", {
    type: "saasaloy:capability",
    dependsOn: ["api"],
    patches: [
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding",
        bindingType: "d1_databases",
        entry: { binding: "DB", database_name: "{{PROJECT_NAME}}-db" },
      },
    ],
  });
}

function emptyConfig(): SaasaloyConfig {
  return { aliases: {}, installed: [] };
}

describe(renderModule, () => {
  it("renders every string in a patch entry and leaves the rest as authored", async () => {
    const rendered = renderModule(await d1(), templateVars("alpha"));
    expect(rendered.item.patches?.[0]).toMatchObject({
      file: "apps/api/wrangler.jsonc",
      entry: { binding: "DB", database_name: "alpha-db" },
    });
  });

  it("is a no-op on a module it already rendered", async () => {
    const vars = templateVars("alpha");
    const once = renderModule(await d1(), vars);
    expect(renderModule(once, vars).item).toStrictEqual(once.item);
  });

  it("reads a file rendered, and raw when the module carries no vars", async () => {
    const mod = await api();
    const abs = join(mod.dir, "files/wrangler.jsonc");
    await expect(readModuleFile(mod, abs)).resolves.toBe(WRANGLER);
    await expect(
      readModuleFile(renderModule(mod, templateVars("alpha")), abs)
    ).resolves.toBe('{\n  "name": "alpha-api"\n}\n');
  });
});

describe("buildPlan with vars", () => {
  it("writes the project's names and hashes the rendered bytes", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const modules = new Map([
      ["api", await api()],
      ["database-d1", await d1()],
    ]);
    const plan = await buildPlan({
      root,
      install: ["api", "database-d1"],
      alreadyInstalled: [],
      modules,
      config,
      manifest,
      vars: templateVars("alpha"),
    });
    await executePlan(plan, root, config, manifest);

    const written = await readFile(
      join(root, "apps/api/wrangler.jsonc"),
      "utf-8"
    );
    expect(written).toContain('"name": "alpha-api"');
    expect(written).toContain('"database_name": "alpha-db"');
    expect(written).not.toContain("{{PROJECT_NAME}}");
    expect(manifest.managed["apps/api/wrangler.jsonc"]?.hash).toBe(
      hashContent('{\n  "name": "alpha-api"\n}\n')
    );
    expect(manifest.patches[0]?.patch).toMatchObject({
      entry: { database_name: "alpha-db" },
    });
  });

  it("gives two projects two sets of names from one module", async () => {
    const names: string[] = [];
    for (const project of ["alpha", "beta"]) {
      const plan = await buildPlan({
        root,
        install: ["api"],
        alreadyInstalled: [],
        modules: new Map([["api", await api()]]),
        config: emptyConfig(),
        manifest: emptyManifest(),
        vars: templateVars(project),
      });
      names.push(plan.files[0]?.content ?? "");
    }
    expect(names[0]).toContain("alpha-api");
    expect(names[1]).toContain("beta-api");
  });
});

describe("buildUpdatePlan with vars", () => {
  it("reports no change for a module whose rendered files and patches are on disk", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    const vars = templateVars("alpha");
    const mods = { api: await api(), d1: await d1() };
    await executePlan(
      await buildPlan({
        root,
        install: ["api", "database-d1"],
        alreadyInstalled: [],
        modules: new Map([
          ["api", mods.api],
          ["database-d1", mods.d1],
        ]),
        config,
        manifest,
        vars,
      }),
      root,
      config,
      manifest
    );

    const plan = await buildUpdatePlan({
      root,
      config,
      manifest,
      lock: emptyLock(),
      vars,
      inputs: [mods.api, mods.d1].map((mod) => ({
        comparison: {
          name: mod.item.name,
          source: "local",
          ref: "local",
          current: "local",
          latest: "local",
          status: "outdated" as const,
        },
        // No merge base, as for a local install: the file is compared with disk alone.
        theirs: mod,
        // `update` hands each module the patches others recorded against its files.
        reapplyPatches: manifest.patches.filter(
          (p) => p.module !== mod.item.name
        ),
      })),
    });

    const actions = plan.modules.flatMap((m) => m.files.map((f) => f.action));
    expect(actions).toStrictEqual(["unchanged"]);
    // database-d1's own patch already sits in the file under the rendered name.
    expect(plan.modules[1]?.patches.map((p) => p.action)).toStrictEqual([
      "unchanged",
    ]);
  });

  it("keeps the names a project installed before the token existed", async () => {
    const config = emptyConfig();
    const manifest = emptyManifest();
    // The module as it shipped before #197: literal names, no token.
    const oldApi = await writeModule(
      "old-api",
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
    const oldD1: LoadedModule = {
      ...(await d1()),
      item: {
        ...(await d1()).item,
        patches: [
          {
            file: "apps/api/wrangler.jsonc",
            kind: "wrangler-binding",
            bindingType: "d1_databases",
            entry: { binding: "DB", database_name: "app-db" },
          },
        ],
      },
    };
    await executePlan(
      await buildPlan({
        root,
        install: ["api", "database-d1"],
        alreadyInstalled: [],
        modules: new Map([
          ["api", { ...oldApi, item: { ...oldApi.item, name: "api" } }],
          ["database-d1", oldD1],
        ]),
        config,
        manifest,
      }),
      root,
      config,
      manifest
    );

    const plan = await buildUpdatePlan({
      root,
      config,
      manifest,
      lock: emptyLock(),
      vars: templateVars("alpha"),
      inputs: [await api(), await d1()].map((mod) => ({
        comparison: {
          name: mod.item.name,
          source: "local",
          ref: "local",
          current: "local",
          latest: "local",
          status: "outdated" as const,
        },
        theirs: mod,
        reapplyPatches: manifest.patches.filter(
          (p) => p.module !== mod.item.name
        ),
      })),
    });

    expect(plan.modules[0]?.files.map((f) => f.action)).toStrictEqual([
      "unchanged",
    ]);
    expect(plan.modules[1]?.patches.map((p) => p.action)).toStrictEqual([
      "unchanged",
    ]);
    expect(plan.modules[1]?.patches[0]?.patch).toMatchObject({
      entry: { database_name: "app-db" },
    });
  });
});
