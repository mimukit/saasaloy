import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TABLES,
  TABLES_FLOOR,
  TABLE_KINDS,
  convertDescriptor,
} from "./convert-tables.ts";

const MODULES = fileURLToPath(new URL("../modules", import.meta.url));

const PROVIDER = `{
  "name": "email-console",
  "type": "saasaloy:feature",
  "requires": { "saasaloy": ">=0.7.0" },
  "dependsOn": ["email"],
  "patches": [
    {
      "file": "packages/email/src/index.ts",
      "kind": "plugin-array",
      "exportName": "email",
      "arrayProp": "providers",
      "call": "consoleEmail",
      "import": { "name": "consoleEmail", "from": "./providers/console" }
    },
    {
      "file": "apps/api/package.json",
      "kind": "package-json-dependency",
      "section": "dependencies",
      "name": "@repo/email",
      "range": "workspace:*"
    }
  ],
  "files": []
}
`;

describe("convertDescriptor", () => {
  it("turns a table patch into a row, keeps the other patches and raises the floor", () => {
    const { converted, text } = convertDescriptor(PROVIDER);
    const out = JSON.parse(text) as Record<string, unknown>;
    assert.equal(converted, 1);
    assert.deepEqual(out.entries, [
      {
        table: "email.providers",
        call: "consoleEmail",
        import: { name: "consoleEmail", from: "./providers/console" },
      },
    ]);
    assert.equal((out.patches as unknown[]).length, 1);
    assert.deepEqual(out.requires, { saasaloy: TABLES_FLOOR });
  });

  it("declares the tables a module owns", () => {
    const { text } = convertDescriptor(
      '{ "name": "email", "type": "saasaloy:capability", "files": [] }\n'
    );
    const out = JSON.parse(text) as { tables: { id: string }[] };
    assert.deepEqual(
      out.tables.map((table) => table.id),
      ["email.providers", "email.envPresets"]
    );
  });

  it("changes nothing on a second run", () => {
    const once = convertDescriptor(PROVIDER).text;
    const twice = convertDescriptor(once);
    assert.equal(twice.converted, 0);
    assert.equal(twice.text, once);
  });

  it("stops on a table it has no id for", () => {
    const unknown = PROVIDER.replace(
      '"exportName": "email"',
      '"exportName": "mail"'
    );
    assert.throws(() => convertDescriptor(unknown), /TABLES does not hold/);
  });
});

describe("the converted registry", () => {
  const names = readdirSync(MODULES).filter((name) =>
    existsSync(join(MODULES, name, "registry-item.json"))
  );

  it("holds no patch of the four table kinds (plan 0116, Phase 7)", () => {
    const left = names.flatMap((name) => {
      const item = JSON.parse(
        readFileSync(join(MODULES, name, "registry-item.json"), "utf-8")
      ) as { patches?: { kind: string }[] };
      return (item.patches ?? [])
        .filter((patch) =>
          (TABLE_KINDS as readonly string[]).includes(patch.kind)
        )
        .map((patch) => `${name}: ${patch.kind}`);
    });
    assert.deepEqual(left, []);
  });

  it("names a table for every row, and an owner for every table", () => {
    const ids = new Set(Object.values(TABLES).map((spec) => spec.id));
    assert.equal(ids.size, 48);
    for (const name of names) {
      const item = JSON.parse(
        readFileSync(join(MODULES, name, "registry-item.json"), "utf-8")
      ) as { entries?: { table: string }[] };
      for (const row of item.entries ?? []) {
        assert.ok(ids.has(row.table), `${name}: no table ${row.table}`);
      }
    }
  });
});
