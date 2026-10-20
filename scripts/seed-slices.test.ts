// Guards the seed slice convention across every module that ships a schema. A module that
// declares a table also ships the seed slice for it, so `pnpm db:seed` fills every table
// and the completeness test a generated project runs stays green after `saasaloy add`.
//
// For each module with `files/db/schema/*.{pg,sqlite}.ts`, every table those files export
// must be the subject of a `defineSlice(...)` in a file the module's descriptor installs at
// `@db/seed/slices/<table>.ts`, where `<table>` is the SQL name in kebab-case. One file per
// table keeps a table's seed rows where the next reader looks for them.
//
// Like `./table-names.test.ts`, it reads the files as text: the slices import `drizzle-orm`
// through the schema, which this repo's root `node_modules` does not carry. Run it with
// `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");
const SLICE_TARGET = /^@db\/seed\/slices\/([a-z0-9-]+)\.ts$/;

interface Table {
  exportKey: string;
  tableName: string;
}

interface SliceFile {
  path: string;
  target: string;
}

function schemaTables(module: string): Table[] {
  const dir = join(MODULES, module, "files", "db", "schema");
  if (!existsSync(dir)) {
    return [];
  }
  const tables = new Map<string, Table>();
  for (const file of readdirSync(dir)) {
    if (!/\.(pg|sqlite)\.ts$/.test(file)) {
      continue;
    }
    const source = readFileSync(join(dir, file), "utf-8");
    for (const match of source.matchAll(
      /export const (\w+) = (?:pgTable|sqliteTable)\(\s*"([^"]+)"/g
    )) {
      const [, exportKey = "", tableName = ""] = match;
      tables.set(exportKey, { exportKey, tableName });
    }
  }
  return [...tables.values()];
}

function sliceFiles(module: string): SliceFile[] {
  const descriptor = JSON.parse(
    readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
  ) as { files?: { path: string; target: string }[] };
  return (descriptor.files ?? []).filter((file) =>
    SLICE_TARGET.test(file.target)
  );
}

/** The schema export keys a slice file passes to `defineSlice`, through any import alias. */
function slicedExports(source: string): string[] {
  const aliases = new Map<string, string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*"\.\.\/\.\.\/schema\/[^"]+"/g
  )) {
    for (const part of (match[1] ?? "").split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (name) {
        aliases.set(alias ?? name, name);
      }
    }
  }
  return [...source.matchAll(/defineSlice\(\s*(\w+)/g)].map(
    (match) => aliases.get(match[1] ?? "") ?? match[1] ?? ""
  );
}

function kebab(tableName: string): string {
  return tableName.replaceAll("_", "-");
}

const modules = readdirSync(MODULES).filter(
  (module) => schemaTables(module).length > 0
);

describe("module seed slices", () => {
  it("finds the modules that ship tables", () => {
    // A moved directory would otherwise leave every check below passing on nothing.
    assert.ok(modules.length >= 7, `found only ${modules.length} modules`);
  });

  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const module of modules) {
    describe(module, () => {
      const tables = schemaTables(module);
      const files = sliceFiles(module);

      it("ships every slice file its descriptor installs", () => {
        for (const file of files) {
          assert.ok(
            existsSync(join(MODULES, module, file.path)),
            `${file.path} is in the descriptor but not on disk`
          );
        }
      });

      // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
      for (const table of tables) {
        it(`seeds ${table.tableName} from @db/seed/slices/${kebab(table.tableName)}.ts`, () => {
          const file = files.find(
            (candidate) =>
              SLICE_TARGET.exec(candidate.target)?.[1] ===
              kebab(table.tableName)
          );
          assert.ok(
            file,
            `${module} declares ${table.tableName} but installs no @db/seed/slices/${kebab(table.tableName)}.ts`
          );
          const source = readFileSync(
            join(MODULES, module, file.path),
            "utf-8"
          );
          assert.deepEqual(
            slicedExports(source),
            [table.exportKey],
            `${file.path} must call defineSlice once, with ${table.exportKey}`
          );
        });
      }
    });
  }
});
