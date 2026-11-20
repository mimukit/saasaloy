import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseModule } from "magicast";
import { describe, expect, it } from "vitest";
import type { RegistryEntry } from "./schema.js";

// The client/admin split (ADR 0050) gives `packages/auth` two Better Auth instances,
// `auth` and `adminAuth`, and two client plugin arrays, `authClientPlugins` and
// `adminAuthClientPlugins`. Both instances carry the same feature plugins, so every module
// that adds a Better Auth plugin adds a row to both tables of each pair.
//
// Each table is a generated file the CLI writes (plan 0116, Phase 7). This reads each such
// module's real descriptor, and the real `auth.ts` and `client.ts` that `modules/auth`
// ships: each array holds the plugins `auth` ships, then the spread of its table.

const MODULES = ["teams", "api-keys", "subscription-stripe"] as const;

/** Each table of plugins, paired with its twin on the other instance. */
const TWINS: Record<string, string> = {
  "auth.plugins": "adminAuth.plugins",
  "client.plugins": "adminClient.plugins",
};

const FILES = {
  "packages/auth/src/auth.ts": "../../../../modules/auth/files/src/auth.ts",
  "packages/auth/src/client.ts": "../../../../modules/auth/files/src/client.ts",
} as const;

type AuthFile = keyof typeof FILES;

async function shipped(file: AuthFile): Promise<string> {
  return readFile(
    fileURLToPath(new URL(FILES[file], import.meta.url)),
    "utf-8"
  );
}

async function pluginRows(module: string): Promise<RegistryEntry[]> {
  const descriptor = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          `../../../../modules/${module}/registry-item.json`,
          import.meta.url
        )
      ),
      "utf-8"
    )
  ) as { entries?: RegistryEntry[] };
  const tables = new Set([...Object.keys(TWINS), ...Object.values(TWINS)]);
  return (descriptor.entries ?? []).filter((row) => tables.has(row.table));
}

/**
 * Each element of `<exportName>`'s `plugins` array: the callee of a call, or
 * `...<name>` for a spread, read back off the AST.
 */
function elementsIn(source: string, exportName: string): string[] {
  const array = parseModule(source).exports[exportName]?.$args?.[0]?.plugins as
    { $ast?: { elements?: Record<string, unknown>[] } } | undefined;
  const elements = array?.$ast?.elements;
  expect(elements, `${exportName} has a plugins array`).toBeDefined();
  return (elements ?? []).map((element) => {
    const node =
      element.type === "SpreadElement"
        ? (element.argument as Record<string, unknown>)
        : (element.callee as Record<string, unknown>);
    const name = String(node.name);
    return element.type === "SpreadElement" ? `...${name}` : name;
  });
}

describe("modules that add a Better Auth plugin", () => {
  it.each(MODULES)(
    "%s adds each plugin to a table and its twin",
    async (module) => {
      const rows = await pluginRows(module);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows.filter((candidate) => candidate.table in TWINS)) {
        expect(rows).toContainEqual({
          ...row,
          table: TWINS[row.table],
        });
      }
    }
  );
});

describe("the shipped auth files", () => {
  it("give each instance its shipped plugins, then the generated table", async () => {
    const auth = await shipped("packages/auth/src/auth.ts");

    expect(elementsIn(auth, "auth")).toStrictEqual([
      "audience",
      "siteRoles",
      "clientAdminGuard",
      "...authPlugins",
    ]);
    expect(elementsIn(auth, "adminAuth")).toStrictEqual([
      "audience",
      "siteRoles",
      "rankGuard",
      "...adminAuthPlugins",
    ]);
  });

  it("give each client factory its own plugin array", async () => {
    const client = await shipped("packages/auth/src/client.ts");

    expect(elementsIn(client, "authClientPlugins")).toStrictEqual([
      "...clientPlugins",
    ]);
    expect(elementsIn(client, "adminAuthClientPlugins")).toStrictEqual([
      "adminClient",
      "...adminClientPlugins",
    ]);
  });
});
