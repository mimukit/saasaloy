import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PATCH_KINDS } from "./patch/index.js";
import type { PatchKind } from "./patch/index.js";
import { LEGACY_TABLE_KINDS } from "./registry.js";
import {
  MODULE_NEEDS,
  MODULE_STAGES,
  validateManifest,
  validateRegistryItem,
  validateUpdateNote,
} from "./schema.js";

// #98 fix round. Two schemas describe the same patch op: `registry-item.schema.json`
// validates it as authored, `manifest.schema.json` validates it as recorded. The
// applier copies the authored op straight into the manifest, so a kind one accepts and
// the other rejects makes `saasaloy add` write a manifest the next `loadManifest`
// refuses. That is exactly what shipped, and nothing failed. These tests hold both
// enums to `PATCH_KINDS`, so the next divergence fails here instead of in a project.

async function readSchema(name: string): Promise<Record<string, unknown>> {
  const path = fileURLToPath(new URL(`../../schemas/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
}

function kindEnum(schema: unknown, path: readonly string[]): string[] {
  let node: unknown = schema;
  for (const key of path) {
    node = (node as Record<string, unknown> | undefined)?.[key];
  }
  const values = (node as { enum?: string[] } | undefined)?.enum;
  if (!values) {
    throw new Error(`no enum at ${path.join(".")}`);
  }
  return values.toSorted();
}

describe("patch-kind enums agree across both schemas", () => {
  it("registry-item.schema.json lists exactly the engine's kinds", async () => {
    const schema = await readSchema("registry-item.schema.json");
    expect(
      kindEnum(schema, ["properties", "patches", "items", "properties", "kind"])
    ).toStrictEqual([...PATCH_KINDS]);
  });

  // A version 1 manifest records what the old engine applied, the four table kinds of
  // plan 0116 Phase 7 included, and a conversion still reads it.
  it("manifest.schema.json lists the engine's kinds and the legacy table kinds", async () => {
    const schema = await readSchema("manifest.schema.json");
    expect(
      kindEnum(schema, [
        "properties",
        "patches",
        "items",
        "properties",
        "patch",
        "properties",
        "kind",
      ])
    ).toStrictEqual([...PATCH_KINDS, ...LEGACY_TABLE_KINDS].toSorted());
  });
});

// A one-entry descriptor whose file entry carries whatever extra keys a case wants to
// put the condition through, well-formed or not.
function conditionalItem(
  extra: Record<string, unknown>
): Record<string, unknown> {
  return {
    name: "waitlist",
    type: "saasaloy:feature",
    files: [
      {
        path: "files/db/schema/waitlist.ts",
        target: "@db/schema/waitlist.ts",
        ...extra,
      },
    ],
  };
}

// `onlyWith` is retired (ADR 0065). Both file-entry shapes, top-level `files[]` and
// `scaffolds[].files[]`, set `additionalProperties: false`, so a descriptor of the running
// registry that still carries the key fails here. Only a read at an older release
// translates it first (`retired-keys.ts`).
describe("registry-item schema — onlyWith is retired (ADR 0065)", () => {
  it("declares onlyWith on neither file-entry shape", async () => {
    const schema = await readSchema("registry-item.schema.json");
    expect(JSON.stringify(schema).match(/onlyWith/g)).toBeNull();
  });

  it("refuses onlyWith on a top-level files[] entry", async () => {
    await expect(
      validateRegistryItem(conditionalItem({ onlyWith: "database-postgres" }))
    ).resolves.toMatchObject({ valid: false });
  });

  it("refuses onlyWith on a scaffold files[] entry", async () => {
    await expect(
      validateRegistryItem({
        name: "auth",
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "packages/auth",
            aliases: { "@auth": "packages/auth/src" },
            files: [
              {
                path: "files/src/db-provider.ts",
                target: "src/db-provider.ts",
                onlyWith: "database-postgres",
              },
            ],
          },
        ],
      })
    ).resolves.toMatchObject({ valid: false });
  });
});

// One authored op per kind. `Record<PatchKind, …>` keeps this exhaustive: a new kind
// with no sample here fails typecheck rather than silently going untested.
const SAMPLE_OPS: Record<PatchKind, Record<string, unknown>> = {
  "const-property": {
    constName: "deployConfig",
    property: "ciWorkflow",
    value: "ci.yml",
  },
  "drizzle-column": {
    exportName: "user",
    column: "subscriptionCustomerId",
    value: 'text("subscription_customer_id")',
  },
  "package-json-dependency": { name: "zod", version: "4.4.3" },
  "package-json-script": { name: "db:generate", value: "drizzle-kit generate" },
  "wrangler-binding": { array: "kv_namespaces", binding: "KV" },
};

// A kind the descriptor may author has to survive the round trip into the manifest.
// Both validators run against the same op so neither can quietly narrow the set.
describe.each(PATCH_KINDS)("patch kind %s", (kind) => {
  it("validates in a registry item and in a manifest", async () => {
    const op = { file: "apps/api/package.json", kind, ...SAMPLE_OPS[kind] };
    await expect(
      validateRegistryItem({
        name: "sample",
        type: "saasaloy:feature",
        patches: [op],
      })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateManifest({
        managed: {},
        patches: [{ module: "sample", file: op.file, patch: op }],
      })
    ).resolves.toMatchObject({ valid: true });
  });
});

// Plan 0116, Phase 7: a registration table is `tables` and `entries`, never a patch.
describe("tables and entries", () => {
  const item = (extra: Record<string, unknown>) => ({
    name: "sample",
    type: "saasaloy:feature",
    ...extra,
  });

  it("validates a table and a row of each shape", async () => {
    await expect(
      validateRegistryItem(
        item({
          tables: [
            {
              id: "sample.providers",
              file: "@sample/providers.generated.ts",
              shape: "calls",
            },
            {
              id: "sample.rows",
              file: "packages/sample/src/rows.generated.ts",
              shape: "objects",
              type: { name: "Row", from: "./rows.ts" },
            },
          ],
          entries: [
            {
              table: "sample.providers",
              call: "memory",
              import: { name: "memory", from: "./providers/memory" },
              order: 10,
            },
            { table: "sample.rows", entry: { name: "a" } },
            {
              table: "api.routes",
              path: "/sample",
              call: "sample",
              import: { name: "sample", from: "./routes/sample" },
            },
            {
              table: "admin.nav",
              area: "/",
              group: "Manage",
              entry: { to: "/sample", label: "Sample" },
              import: { name: "BoxIcon", from: "lucide-react" },
              when: { installed: ["admin"] },
            },
          ],
        })
      )
    ).resolves.toMatchObject({ valid: true });
  });

  it("rejects a generated file not named *.generated.ts", async () => {
    await expect(
      validateRegistryItem(
        item({
          tables: [{ id: "sample.x", file: "@sample/x.ts", shape: "calls" }],
        })
      )
    ).resolves.toMatchObject({ valid: false });
  });

  it("rejects an unknown shape and an unknown row field", async () => {
    await expect(
      validateRegistryItem(
        item({
          tables: [
            { id: "sample.x", file: "@sample/x.generated.ts", shape: "map" },
          ],
        })
      )
    ).resolves.toMatchObject({ valid: false });
    await expect(
      validateRegistryItem(
        item({ entries: [{ table: "sample.x", exportName: "x" }] })
      )
    ).resolves.toMatchObject({ valid: false });
  });

  it.each(["plugin-array", "const-array", "chained-route", "nav-entry"])(
    "rejects the old table patch kind %s",
    async (kind) => {
      await expect(
        validateRegistryItem(
          item({ patches: [{ file: "apps/api/src/index.ts", kind }] })
        )
      ).resolves.toMatchObject({ valid: false });
    }
  );
});

describe("removal warnings", () => {
  it("validates descriptor warnings and their persisted manifest form", async () => {
    const warnings = ["The organization tables survive removal."];
    await expect(
      validateRegistryItem({
        name: "teams",
        type: "saasaloy:feature",
        removeWarnings: warnings,
      })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateManifest({ managed: {}, removeWarnings: { teams: warnings } })
    ).resolves.toMatchObject({ valid: true });
  });
});

// #242 Phase 2. `when` rides on every file entry shape, plus `patches`, and the descriptor gains `untested` on a file and `enablesTesting` on itself.
describe("registry-item schema — when, untested and enablesTesting (#242)", () => {
  it.each([
    [{ testing: true }],
    [{ installed: ["e2e"] }],
    [{ installed: ["e2e", "ci"], testing: true }],
  ])("accepts when %j on a files[] entry", async (when) => {
    await expect(
      validateRegistryItem(conditionalItem({ when }))
    ).resolves.toMatchObject({ valid: true });
  });

  it.each([
    ["testing false", { testing: false }],
    ["an unknown key", { always: true }],
    ["no key at all", {}],
    ["an empty installed list", { installed: [] }],
    ["a bad module name", { installed: ["Not A Module"] }],
  ])("rejects when with %s", async (_label, when) => {
    await expect(
      validateRegistryItem(conditionalItem({ when }))
    ).resolves.toMatchObject({ valid: false });
  });

  it("accepts when on a scaffold files[] entry", async () => {
    await expect(
      validateRegistryItem({
        name: "database-lite",
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "packages/db-lite",
            files: [
              {
                path: "files/scripts/lib/dump.vitest.ts",
                target: "scripts/lib/dump.test.ts",
                when: { testing: true },
              },
            ],
          },
        ],
      })
    ).resolves.toMatchObject({ valid: true });
  });

  it("accepts when on a patch, and the manifest keeps it inside the op and beside it", async () => {
    const op = {
      file: "package.json",
      kind: "package-json-script",
      name: "db:check",
      value: "drizzle-kit check",
      when: { testing: true },
    };
    await expect(
      validateRegistryItem({
        name: "database-lite",
        type: "saasaloy:capability",
        patches: [op],
      })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateManifest({
        managed: {},
        patches: [
          { module: "database-lite", file: op.file, patch: op, when: op.when },
        ],
      })
    ).resolves.toMatchObject({ valid: true });
  });

  it("rejects when testing false on a patch", async () => {
    await expect(
      validateRegistryItem({
        name: "database-lite",
        type: "saasaloy:capability",
        patches: [
          {
            file: "package.json",
            kind: "package-json-script",
            name: "db:check",
            value: "drizzle-kit check",
            when: { testing: false },
          },
        ],
      })
    ).resolves.toMatchObject({ valid: false });
  });

  it("accepts an untested reason and rejects an empty one", async () => {
    await expect(
      validateRegistryItem(conditionalItem({ untested: "generated types" }))
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateRegistryItem(conditionalItem({ untested: "" }))
    ).resolves.toMatchObject({ valid: false });
  });

  it("accepts enablesTesting true and rejects false", async () => {
    await expect(
      validateRegistryItem({
        name: "e2e",
        type: "saasaloy:capability",
        enablesTesting: true,
      })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateRegistryItem({
        name: "e2e",
        type: "saasaloy:capability",
        enablesTesting: false,
      })
    ).resolves.toMatchObject({ valid: false });
  });
});

// #223: three optional fields an agent reads through `saasaloy list --json`. The TS
// constants mirror the schema's enums, so `list` and `new` cannot drift from what a
// descriptor may declare.
describe("description, stage and needs (#223)", () => {
  const base = { name: "widget", type: "saasaloy:feature" };

  it("mirrors the schema's stage and needs enums", async () => {
    const schema = await readSchema("registry-item.schema.json");
    expect(kindEnum(schema, ["properties", "stage"])).toStrictEqual(
      [...MODULE_STAGES].toSorted()
    );
    expect(kindEnum(schema, ["properties", "needs", "items"])).toStrictEqual(
      [...MODULE_NEEDS].toSorted()
    );
  });

  it("accepts all three, and a descriptor with none of them", async () => {
    await expect(
      validateRegistryItem({
        ...base,
        description: "A widget for the landing page.",
        needs: ["stripe", "domain"],
        stage: "money",
      })
    ).resolves.toMatchObject({ valid: true });
    await expect(validateRegistryItem(base)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("refuses an empty or multi-line description", async () => {
    for (const description of ["", "one\ntwo"]) {
      const result = await validateRegistryItem({ ...base, description });
      expect(result.valid).toBeFalsy();
    }
  });

  it("refuses an unknown stage and an unknown or repeated need", async () => {
    for (const extra of [
      { stage: "growth" },
      { needs: ["aws"] },
      { needs: ["stripe", "stripe"] },
    ]) {
      const result = await validateRegistryItem({ ...base, ...extra });
      expect(result.valid).toBeFalsy();
    }
  });
});

// #298 Phase 2: an update note's frontmatter reuses the descriptor's `when` (ADR 0054),
// so the two schemas hold one copy of it each. This keeps the copies equal.
describe("update-note schema (#298)", () => {
  it("describes when exactly as the descriptor schema does", async () => {
    const note = await readSchema("update-note.schema.json");
    const item = await readSchema("registry-item.schema.json");
    expect((note.$defs as Record<string, unknown>).when).toStrictEqual(
      (item.$defs as Record<string, unknown>).when
    );
  });

  it("accepts a title, a version and a when", async () => {
    await expect(
      validateUpdateNote({
        title: "Move the web tokens",
        version: "0.8.0",
        when: { installed: ["admin"] },
      })
    ).resolves.toMatchObject({ valid: true });
  });

  it("requires a title", async () => {
    await expect(
      validateUpdateNote({ version: "0.8.0" })
    ).resolves.toStrictEqual({
      errors: ['(root): missing required property "title"'],
      valid: false,
    });
  });

  it("rejects an unknown key, such as an id", async () => {
    await expect(
      validateUpdateNote({ id: "base/0001-x", title: "X" })
    ).resolves.toMatchObject({ valid: false });
  });

  it("rejects a version that is not semver", async () => {
    await expect(
      validateUpdateNote({ title: "X", version: "v0.8" })
    ).resolves.toMatchObject({ valid: false });
  });

  it("rejects an empty when", async () => {
    await expect(
      validateUpdateNote({ title: "X", when: {} })
    ).resolves.toMatchObject({ valid: false });
  });
});
