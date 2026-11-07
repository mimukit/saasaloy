// Guards the column class convention across every module that ships a schema. A module
// that declares a table also ships the class file for it, so the class test a generated
// project runs stays green after `saasaloy add`, and the production read-only role never
// meets a column nobody classified.
//
// For each module with `files/db/schema/*.{pg,sqlite}.ts`, every table those files export
// must be the subject of a `defineColumnClasses(...)` in a file the module's descriptor
// installs at `@db/column-classes/<table>.ts`, where `<table>` is the SQL name in
// kebab-case, and that file must name every column key of the table, in both the Postgres
// and the SQLite variant, and no other key. A `drizzle-column` patch that adds a column to
// another module's table must add its class to that table's class file the same way.
//
// Like `./seed-slices.test.ts`, it reads the files as text: the class files import
// `drizzle-orm` through the schema, which this repo's root `node_modules` does not carry.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");
const CLASS_TARGET = /^@db\/column-classes\/([a-z0-9-]+)\.ts$/;
const SCHEMA_FILE = /^packages\/db\/src\/schema\/([a-z0-9-]+)\.ts$/;
const CLASS_FILE = /^packages\/db\/src\/column-classes\/([a-z0-9-]+)\.ts$/;

interface Table {
  /** The schema file's base name, `auth` for `auth.pg.ts`. */
  file: string;
  exportKey: string;
  tableName: string;
  /** The column keys, per variant file name. */
  keys: Map<string, string[]>;
}

interface Descriptor {
  files?: { path: string; target: string }[];
  patches?: {
    file: string;
    kind: string;
    exportName?: string;
    column?: string;
  }[];
}

/** `source` with its comments blanked out, so a brace or a colon in one is not read. */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|\s)\/\/.*$/gm, "$1");
}

/** The text between the `{` at `open` and its matching `}`. */
function objectBody(source: string, open: number): string {
  let depth = 0;
  let quote = "";
  for (let at = open; at < source.length; at += 1) {
    const char = source[at] ?? "";
    if (quote) {
      if (char === "\\") {
        at += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("{([".includes(char)) {
      depth += 1;
    } else if ("})]".includes(char)) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, at);
      }
    }
  }
  throw new Error(`unbalanced object at offset ${open}`);
}

/** The top-level property keys of an object body. A spread is reported as `...name`. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const segments: string[] = [];
  for (let at = 0; at <= body.length; at += 1) {
    const char = body[at] ?? ",";
    if (quote) {
      if (char === "\\") {
        at += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("{([".includes(char)) {
      depth += 1;
    } else if ("})]".includes(char)) {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      segments.push(body.slice(start, at));
      start = at + 1;
    }
  }
  for (const segment of segments) {
    const text = segment.trim();
    if (!text) {
      continue;
    }
    const match = /^(\.\.\.)?["']?(\w+)["']?/.exec(text);
    keys.push(match ? `${match[1] ?? ""}${match[2] ?? ""}` : text);
  }
  return keys;
}

/** Every `export const <key> = <call>("<sql name>", { … })` with its column keys. */
function tableCalls(
  source: string,
  call: string
): { exportKey: string; name: string; keys: string[] }[] {
  const code = stripComments(source);
  return [
    ...code.matchAll(
      new RegExp(`export const (\\w+) = ${call}\\(\\s*([\\w"]+),\\s*\\{`, "g")
    ),
  ].map((match) => ({
    exportKey: match[1] ?? "",
    keys: topLevelKeys(
      objectBody(code, (match.index ?? 0) + match[0].length - 1)
    ),
    name: (match[2] ?? "").replaceAll('"', ""),
  }));
}

function schemaTables(module: string): Table[] {
  const dir = join(MODULES, module, "files", "db", "schema");
  if (!existsSync(dir)) {
    return [];
  }
  const tables = new Map<string, Table>();
  for (const file of readdirSync(dir)) {
    const variant = /^(.+)\.(pg|sqlite)\.ts$/.exec(file);
    if (!variant) {
      continue;
    }
    const source = readFileSync(join(dir, file), "utf-8");
    for (const { exportKey, keys, name } of tableCalls(
      source,
      "(?:pgTable|sqliteTable)"
    )) {
      const table = tables.get(exportKey) ?? {
        exportKey,
        file: variant[1] ?? "",
        keys: new Map(),
        tableName: name,
      };
      table.keys.set(file, keys);
      tables.set(exportKey, table);
    }
  }
  return [...tables.values()];
}

function descriptor(module: string): Descriptor {
  return JSON.parse(
    readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
  ) as Descriptor;
}

/** The schema export key a class file passes to `defineColumnClasses`, and its keys. */
function classified(
  source: string
): { exportKey: string; from: string; keys: string[] }[] {
  const imports = new Map<string, { name: string; from: string }>();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*"\.\.\/schema\/([^"]+)"/g
  )) {
    for (const part of (match[1] ?? "").split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (name) {
        imports.set(alias ?? name, { from: match[2] ?? "", name });
      }
    }
  }
  return tableCalls(source, "defineColumnClasses").map(({ keys, name }) => ({
    exportKey: imports.get(name)?.name ?? name,
    from: imports.get(name)?.from ?? "",
    keys,
  }));
}

function kebab(tableName: string): string {
  return tableName.replaceAll("_", "-");
}

const modules = readdirSync(MODULES).filter(
  (module) => schemaTables(module).length > 0
);

describe("module column classes", () => {
  it("finds the modules that ship tables", () => {
    // A moved directory would otherwise leave every check below passing on nothing.
    assert.ok(modules.length >= 10, `found only ${modules.length} modules`);
  });

  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const module of modules) {
    describe(module, () => {
      const tables = schemaTables(module);
      const files = (descriptor(module).files ?? []).filter((file) =>
        CLASS_TARGET.test(file.target)
      );

      it("ships every class file its descriptor installs", () => {
        for (const file of files) {
          assert.ok(
            existsSync(join(MODULES, module, file.path)),
            `${file.path} is in the descriptor but not on disk`
          );
        }
      });

      // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
      for (const table of tables) {
        const target = `@db/column-classes/${kebab(table.tableName)}.ts`;

        it(`classifies ${table.tableName} in ${target}`, () => {
          const file = files.find(
            (candidate) =>
              CLASS_TARGET.exec(candidate.target)?.[1] ===
              kebab(table.tableName)
          );
          assert.ok(
            file,
            `${module} declares ${table.tableName} but installs no ${target}`
          );
          const calls = classified(
            readFileSync(join(MODULES, module, file.path), "utf-8")
          );
          assert.deepEqual(
            calls.map(
              (call) => `${call.exportKey} from ../schema/${call.from}`
            ),
            [`${table.exportKey} from ../schema/${table.file}`],
            `${file.path} must call defineColumnClasses once, with ${table.exportKey} imported from ../schema/${table.file}`
          );
          const keys = calls[0]?.keys ?? [];
          for (const [variant, columns] of table.keys) {
            const missing = columns.filter((key) => !keys.includes(key));
            const extra = keys.filter((key) => !columns.includes(key));
            assert.deepEqual(
              { extra, missing },
              { extra: [], missing: [] },
              `${file.path} must name every column key of ${table.exportKey} in ${variant}, and no other`
            );
          }
        });
      }
    });
  }

  it("classifies every column a drizzle-column patch adds", () => {
    // The table a schema file exports, by `<schema file>:<export key>`.
    const owners = new Map<string, Table>();
    for (const module of modules) {
      for (const table of schemaTables(module)) {
        owners.set(`${table.file}:${table.exportKey}`, table);
      }
    }
    const problems: string[] = [];
    for (const module of readdirSync(MODULES)) {
      if (!existsSync(join(MODULES, module, "registry-item.json"))) {
        continue;
      }
      const patches = (descriptor(module).patches ?? []).filter(
        (patch) => patch.kind === "drizzle-column"
      );
      for (const patch of patches) {
        const schemaFile = SCHEMA_FILE.exec(patch.file)?.[1];
        if (!schemaFile) {
          continue;
        }
        const table = owners.get(`${schemaFile}:${patch.exportName}`);
        if (!table) {
          problems.push(
            `${module}: ${patch.file} has no table exported as ${patch.exportName}`
          );
          continue;
        }
        const classPatch = patches.find(
          (candidate) =>
            CLASS_FILE.exec(candidate.file)?.[1] === kebab(table.tableName) &&
            candidate.exportName === table.exportKey &&
            candidate.column === patch.column
        );
        if (!classPatch) {
          problems.push(
            `${module}: adds ${table.tableName}.${patch.column} but no drizzle-column patch on packages/db/src/column-classes/${kebab(table.tableName)}.ts classifies it`
          );
        }
      }
    }
    assert.deepEqual(problems, []);
  });
});
