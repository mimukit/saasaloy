import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PATCH_KINDS } from "./patch/index.js";
import type { PatchKind } from "./patch/index.js";
import { validateManifest, validateRegistryItem } from "./schema.js";

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

  it("manifest.schema.json lists exactly the engine's kinds", async () => {
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
    ).toStrictEqual([...PATCH_KINDS]);
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
        path: "files/db/schema/waitlist.sqlite.ts",
        target: "@db/schema/waitlist.ts",
        ...extra,
      },
    ],
  };
}

// `onlyWith` is authored on a file entry, and there are two of those objects in the
// schema — top-level `files[]` and `scaffolds[].files[]`. Both set
// `additionalProperties: false`, so a keyword added to one and forgotten on the other
// rejects half the descriptors that use it. auth's variants live in a scaffold and
// waitlist's in `files[]`, so #99 needs both.
describe("registry-item schema — onlyWith (#99)", () => {
  it("declares onlyWith on both file-entry shapes", async () => {
    const schema = await readSchema("registry-item.schema.json");
    expect(JSON.stringify(schema).match(/"onlyWith"/g)).toHaveLength(2);
  });

  it("accepts onlyWith on a top-level files[] entry", async () => {
    await expect(
      validateRegistryItem(conditionalItem({ onlyWith: "database-d1" }))
    ).resolves.toMatchObject({ valid: true });
  });

  it("accepts onlyWith on a scaffold files[] entry", async () => {
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
                path: "files/src/db-provider.pg.ts",
                target: "src/db-provider.ts",
                onlyWith: "database-postgres",
              },
            ],
          },
        ],
      })
    ).resolves.toMatchObject({ valid: true });
  });

  it("rejects a misspelt onlyWit", async () => {
    await expect(
      validateRegistryItem(conditionalItem({ onlyWit: "database-d1" }))
    ).resolves.toMatchObject({ valid: false });
  });

  it("rejects a condition that is not one module name", async () => {
    await expect(
      validateRegistryItem(conditionalItem({ onlyWith: "Database D1" }))
    ).resolves.toMatchObject({ valid: false });
    await expect(
      validateRegistryItem(conditionalItem({ onlyWith: ["database-d1"] }))
    ).resolves.toMatchObject({ valid: false });
  });
});

// One authored op per kind. `Record<PatchKind, …>` keeps this exhaustive: a new kind
// with no sample here fails typecheck rather than silently going untested.
const SAMPLE_OPS: Record<PatchKind, Record<string, unknown>> = {
  "chained-route": {
    exportName: "default",
    path: "/waitlist",
    call: "waitlist",
    import: { name: "waitlist", from: "./routes/waitlist.js" },
  },
  "const-array": {
    constName: "NAV_ITEMS",
    key: "to",
    entry: { to: "/teams", label: "Teams" },
  },
  "package-json-dependency": { name: "zod", version: "4.4.3" },
  "package-json-script": { name: "db:generate", value: "drizzle-kit generate" },
  "plugin-array": {
    exportName: "auth",
    property: "plugins",
    insert: "organization()",
  },
  "wrangler-binding": { array: "d1_databases", binding: "DB" },
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
