import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseModule } from "magicast";
import { describe, expect, it } from "vitest";
import { applyPatch, reversePatch } from "./patch/index.js";
import type { RegistryPatch } from "./schema.js";

// The client/admin split (ADR 0050) gives `packages/auth` two Better Auth instances,
// `auth` and `adminAuth`, and two client plugin arrays, `authClientPlugins` and
// `adminAuthClientPlugins`. Both instances carry the same feature plugins, so every module
// that adds a Better Auth plugin patches both arrays of each pair.
//
// This runs each such module's real descriptor against the real `auth.ts` and `client.ts`
// that `modules/auth` ships: `add` must put every call into both arrays, and `remove` must
// take every one back out, leaving the files byte-for-byte as `auth` shipped them.

const MODULES = ["teams", "api-keys", "billing-stripe"] as const;

/** Each export that holds a plugin array, paired with its twin on the other instance. */
const TWINS: Record<string, string> = {
  auth: "adminAuth",
  authClientPlugins: "adminAuthClientPlugins",
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

async function pluginPatches(module: string) {
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
  ) as { patches: RegistryPatch[] };
  return descriptor.patches.filter(
    (
      patch
    ): patch is Extract<RegistryPatch, { kind: "plugin-array" }> & {
      file: AuthFile;
    } => patch.kind === "plugin-array" && patch.file in FILES
  );
}

/**
 * The source with whitespace and trailing commas taken out. Recast prints an array it
 * touched on one line, so a round trip through `add` and `remove` changes the layout of a
 * multi-line array and nothing else. A real run formats every patched file with the
 * project's Prettier afterwards (`formatPatchedFiles`), which restores the layout.
 */
function squash(source: string): string {
  return source.replaceAll(/\s+/g, "").replaceAll(/,([\]}])/g, "$1");
}

/** The callee names in `<exportName>`'s `plugins` array, read back with magicast. */
function callsIn(source: string, exportName: string): string[] {
  const array = parseModule(source).exports[exportName]?.$args?.[0]?.plugins as
    { length: number; [index: number]: { $callee?: string } } | undefined;
  expect(array, `${exportName} has a plugins array`).toBeDefined();
  const calls: string[] = [];
  for (let i = 0; i < (array?.length ?? 0); i += 1) {
    calls.push(array?.[i]?.$callee ?? "");
  }
  return calls;
}

describe("modules that add a Better Auth plugin", () => {
  it.each(MODULES)(
    "%s patches each plugin array and its twin",
    async (module) => {
      const patches = await pluginPatches(module);
      expect(patches.length).toBeGreaterThan(0);

      for (const patch of patches.filter((p) => p.exportName in TWINS)) {
        expect(patches).toContainEqual({
          ...patch,
          exportName: TWINS[patch.exportName],
        });
      }
      // No patch targets an export outside the two pairs.
      for (const patch of patches) {
        expect([...Object.keys(TWINS), ...Object.values(TWINS)]).toContain(
          patch.exportName
        );
      }
    }
  );

  it.each(MODULES)(
    "%s adds every call to both instances and removes it again",
    async (module) => {
      const patches = await pluginPatches(module);

      for (const file of Object.keys(FILES) as AuthFile[]) {
        const mine = patches.filter((p) => p.file === file);
        if (mine.length === 0) {
          continue;
        }
        const original = await shipped(file);

        let content = original;
        for (const patch of mine) {
          const result = applyPatch(content, patch, file);
          expect(
            result.reason,
            `${patch.exportName} ${patch.call}`
          ).toBeUndefined();
          expect(result.changed).toBeTruthy();
          content = result.content;
        }
        for (const patch of mine) {
          expect(callsIn(content, patch.exportName)).toContain(patch.call);
        }

        for (const patch of mine.toReversed()) {
          const result = reversePatch(content, patch, file);
          expect(
            result?.changed,
            `remove ${patch.exportName} ${patch.call}`
          ).toBeTruthy();
          content = result?.content ?? content;
        }
        expect(squash(content)).toBe(squash(original));
      }
    }
  );
});

describe("the shipped auth files", () => {
  it("give each instance a plugins array the codemod can find next to the spread options", async () => {
    const auth = await shipped("packages/auth/src/auth.ts");

    expect(callsIn(auth, "auth")).toStrictEqual([
      "audience",
      "siteRoles",
      "clientAdminGuard",
    ]);
    expect(callsIn(auth, "adminAuth")).toStrictEqual([
      "audience",
      "siteRoles",
      "rankGuard",
    ]);
  });

  it("give each client factory its own plugin array", async () => {
    const client = await shipped("packages/auth/src/client.ts");

    expect(callsIn(client, "authClientPlugins")).toStrictEqual([]);
    expect(callsIn(client, "adminAuthClientPlugins")).toStrictEqual([
      "adminClient",
    ]);
  });
});
