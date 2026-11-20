import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readModuleFile, renderModule } from "./module-render.js";
import type { LoadedModule } from "./registry.js";
import { templateVars } from "./scaffold.js";
import type { RegistryItem } from "./schema.js";

// `saasaloy add` renders `{{PROJECT_NAME}}` in module files and patch entries (#197), so two
// projects in one Cloudflare account get two Workers and two databases, and `update` compares
// the rendered bytes rather than reporting every templated file as changed.

const WRANGLER = '{\n  "name": "{{PROJECT_NAME}}-api"\n}\n';

let moduleRoot: string;

beforeEach(async () => {
  moduleRoot = await mkdtemp(join(tmpdir(), "saasaloy-render-mod-"));
});

afterEach(async () => {
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
