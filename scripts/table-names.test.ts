// Guards the table-name convention (ADR 0038) across every module that ships a schema.
// A table name is plural snake_case, its Drizzle export key is the camelCase form of the
// same plural, and an index is named after its table.
//
// The rule has a runtime edge that no type catches. `packages/auth/src/auth.ts` passes
// `usePlural: true` to `drizzleAdapter`, and the adapter then looks a Better Auth model
// up by `<model>s` in the schema object. A singular export key, or a missing `usePlural`,
// compiles and then throws `The model "user" was not found in the schema object` on the
// first sign-up. This test is where that mistake goes red before a project runs it.
//
// It reads the files as text, like `modules/auth/files/src/schema-version.test.ts`: the
// schema variants import `drizzle-orm`, which this repo's root `node_modules` does not
// carry. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

interface TableCall {
  exportKey: string;
  tableName: string;
  body: string;
}

function schemaFiles(): string[] {
  return readdirSync(MODULES).flatMap((module) => {
    const dir = join(MODULES, module, "files", "db", "schema");
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    return entries
      .filter((file) => /\.(pg|sqlite)\.ts$/.test(file))
      .map((file) => join(dir, file));
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((file) => file.endsWith(".ts") && !file.includes("node_modules"))
    .map((file) => join(dir, file));
}

// Each call runs from its `export const` to the next one, so an index declared in the
// table's third argument lands in that table's body.
function tableCalls(source: string): TableCall[] {
  const pattern = /export const (\w+) = (?:pgTable|sqliteTable)\(\s*"([^"]+)"/g;
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, i) => ({
    body: source.slice(match.index, matches[i + 1]?.index ?? source.length),
    exportKey: match[1] ?? "",
    tableName: match[2] ?? "",
  }));
}

// A file without its comment lines: a comment may quote `modelName: "X"` to explain the rule.
function codeLines(file: string): string {
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
    .join("\n");
}

function camelCase(snake: string): string {
  return snake.replaceAll(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const relative = (file: string) => file.slice(ROOT.length);
const files = schemaFiles();

describe("module schema table names", () => {
  it("finds the schema files", () => {
    // A moved directory would otherwise leave every check below passing on nothing.
    assert.ok(files.length >= 14, `found only ${files.length} schema files`);
  });

  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const file of files) {
    const calls = tableCalls(readFileSync(file, "utf-8"));

    describe(relative(file), () => {
      it("declares at least one table", () => {
        assert.ok(calls.length > 0, "no pgTable or sqliteTable export found");
      });

      // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
      for (const call of calls) {
        it(`names ${call.exportKey} as a plural snake_case table`, () => {
          assert.match(
            call.tableName,
            /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*s$/,
            `table "${call.tableName}" must be plural snake_case`
          );
          assert.equal(
            call.exportKey,
            camelCase(call.tableName),
            `export key must be the camelCase form of "${call.tableName}"`
          );
        });

        it(`names every ${call.exportKey} index after its table`, () => {
          const names = [
            ...call.body.matchAll(/(?:uniqueIndex|index)\(\s*"([^"]+)"/g),
            ...call.body.matchAll(/tenantIndex\(\s*\w+,\s*"([^"]+)"/g),
          ].map((match) => match[1] ?? "");
          for (const name of names) {
            assert.ok(
              name === call.tableName || name.startsWith(`${call.tableName}_`),
              `index "${name}" must start with "${call.tableName}_"`
            );
          }
        });
      }
    });
  }

  it("gives each .pg.ts file a .sqlite.ts twin with the same tables", () => {
    for (const pg of files.filter((file) => file.endsWith(".pg.ts"))) {
      const sqlite = pg.replace(/\.pg\.ts$/, ".sqlite.ts");
      assert.ok(files.includes(sqlite), `${relative(pg)} has no sqlite twin`);
      const shape = (path: string) =>
        tableCalls(readFileSync(path, "utf-8"))
          .map((call) => `${call.exportKey}=${call.tableName}`)
          .toSorted();
      assert.deepEqual(shape(sqlite), shape(pg), relative(pg));
    }
  });
});

describe("the Better Auth adapter", () => {
  it("passes usePlural: true to drizzleAdapter", () => {
    const auth = readFileSync(
      join(MODULES, "auth", "files", "src", "auth.ts"),
      "utf-8"
    );
    assert.ok(
      /drizzleAdapter\([^)]*usePlural:\s*true/.test(auth),
      "modules/auth/files/src/auth.ts must call drizzleAdapter with usePlural: true"
    );
  });

  it("exports <modelName>s for every custom modelName a plugin sets", () => {
    // `usePlural` appends `s` to a custom modelName too (`getModelName` in
    // `@better-auth/core`), so the key the adapter asks for is `<modelName>s`.
    const exportKeys = new Set(
      files.flatMap((file) =>
        tableCalls(readFileSync(file, "utf-8")).map((call) => call.exportKey)
      )
    );
    const modelNames = sourceFiles(MODULES).flatMap((file) =>
      [...codeLines(file).matchAll(/modelName:\s*"(\w+)"/g)].map((match) => ({
        file,
        modelName: match[1] ?? "",
      }))
    );
    assert.ok(modelNames.length > 0, "found no modelName to check");
    for (const { file, modelName } of modelNames) {
      assert.ok(
        exportKeys.has(`${modelName}s`),
        `${relative(file)} sets modelName "${modelName}", so a schema file must export "${modelName}s"`
      );
    }
  });
});
