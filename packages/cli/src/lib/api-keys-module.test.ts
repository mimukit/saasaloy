import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegistryItem } from "./schema.js";
import { satisfies } from "./semver.js";

// The `api-keys` split (#229, ADR 0048), read off disk. The core holds what every owner
// shares, and each owner holds what differs. An installed project moves from the old
// single module to the pair by `add api-keys-organization`, which only works while the
// moved files keep their targets and the two `auth.ts` patches stay in the core. So the
// split itself is under test here, not just the descriptors' validity.

const MODULES = new URL("../../../../modules/", import.meta.url);

async function readDescriptor(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      fileURLToPath(new URL(`${name}/registry-item.json`, MODULES)),
      "utf-8"
    )
  ) as Record<string, unknown>;
}

interface FileEntry {
  path: string;
  target: string;
  onlyWith?: string;
}

interface PatchEntry {
  file: string;
  kind: string;
  call?: string;
  import?: { name: string; from: string };
}

describe("the api-keys core", () => {
  it("is valid, depends on auth alone, and asks for one owner", async () => {
    const descriptor = await readDescriptor("api-keys");

    await expect(validateRegistryItem(descriptor)).resolves.toMatchObject({
      valid: true,
    });
    expect(descriptor.dependsOn).toStrictEqual(["auth"]);
    expect(descriptor.requiresOneOf).toStrictEqual([
      "api-keys-organization",
      "api-keys-user",
    ]);
  });

  it("declares a CLI range the CLI in this checkout satisfies", async () => {
    const descriptor = await readDescriptor("api-keys");
    const cli = JSON.parse(
      await readFile(
        fileURLToPath(new URL("../../package.json", import.meta.url)),
        "utf-8"
      )
    ) as { version: string };
    const range = (descriptor.requires as { saasaloy?: string } | undefined)
      ?.saasaloy;

    // An older CLI must refuse this descriptor before `update` plans a delete. The range
    // is raised to the first released CLI that refuses an unmet `requiresOneOf`.
    expect(range).toBeDefined();
    expect(satisfies(cli.version, range ?? "")).toBeTruthy();
  });

  it("keeps the auth.ts and client.ts patches, importing from the owner's fixed path", async () => {
    const patches = (await readDescriptor("api-keys")).patches as PatchEntry[];

    expect(
      patches.map((patch) => [patch.file, patch.kind, patch.import?.from])
    ).toStrictEqual([
      ["packages/auth/package.json", "package-json-dependency", undefined],
      ["packages/auth/src/auth.ts", "plugin-array", "./plugins/api-key"],
      ["packages/auth/src/auth.ts", "plugin-array", "./plugins/api-key"],
      [
        "packages/auth/src/client.ts",
        "plugin-array",
        "./plugins/api-key-client",
      ],
    ]);
  });

  it("ships the shared options and the client plugin, and no owner file", async () => {
    const files = (await readDescriptor("api-keys")).files as FileEntry[];

    expect(files.map((file) => file.target)).toStrictEqual([
      "@auth/plugins/api-key-options.ts",
      "@auth/plugins/api-key-client.ts",
    ]);
  });
});

describe("the api-keys-organization owner", () => {
  it("is valid, stacks on the core and multitenant, and refuses the user owner", async () => {
    const descriptor = await readDescriptor("api-keys-organization");

    await expect(validateRegistryItem(descriptor)).resolves.toMatchObject({
      valid: true,
    });
    expect(descriptor.dependsOn).toStrictEqual(["api-keys", "multitenant"]);
    expect(descriptor.conflictsWith).toStrictEqual(["api-keys-user"]);
    // One skill in the core covers both modes (plan 0075, Q12).
    expect(descriptor.agent).toBeUndefined();
  });

  it("ships every file the single module used to, at the same targets", async () => {
    const files = (await readDescriptor("api-keys-organization"))
      .files as FileEntry[];

    // The targets an installed `api-keys` project already holds. `add` adopts a file
    // only at the path the manifest records it under.
    expect(files).toStrictEqual([
      {
        path: "files/db/schema/api-keys.sqlite.ts",
        target: "@db/schema/api-keys.ts",
        onlyWith: "database-d1",
      },
      {
        path: "files/db/schema/api-keys.pg.ts",
        target: "@db/schema/api-keys.ts",
        onlyWith: "database-postgres",
      },
      {
        path: "files/auth/plugins/api-key.ts",
        target: "@auth/plugins/api-key.ts",
      },
      {
        path: "files/auth/resolvers/api-key.ts",
        target: "@auth/resolvers/api-key.ts",
      },
      {
        path: "files/admin/routes/api-keys.tsx",
        target: "@admin/routes/api-keys.tsx",
      },
      {
        path: "files/admin/components/api-key-workspace.tsx",
        target: "@admin/components/api-key-workspace.tsx",
      },
    ]);
  });

  it("owns the tenant resolver and the sidebar entry", async () => {
    const patches = (await readDescriptor("api-keys-organization"))
      .patches as PatchEntry[];

    expect(patches.map((patch) => [patch.file, patch.kind])).toStrictEqual([
      ["packages/auth/src/tenant.ts", "plugin-array"],
      ["apps/admin/src/components/app-shell.tsx", "const-array"],
    ]);
  });

  it("warns that the deployed table survives removal", async () => {
    const warnings = (await readDescriptor("api-keys-organization"))
      .removeWarnings as string[];

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/api_keys table survives/);
  });
});

describe("the api-keys-user owner", () => {
  it("is valid, stacks on the core and auth alone, and refuses the organization owner", async () => {
    const descriptor = await readDescriptor("api-keys-user");

    await expect(validateRegistryItem(descriptor)).resolves.toMatchObject({
      valid: true,
    });
    // No multitenant, teams or admin: a project with no organizations installs this.
    expect(descriptor.dependsOn).toStrictEqual(["api-keys", "auth"]);
    expect(descriptor.conflictsWith).toStrictEqual(["api-keys-organization"]);
    expect(descriptor.agent).toBeUndefined();
  });

  it("ships the owner file at the path the core's auth.ts patches import", async () => {
    const files = (await readDescriptor("api-keys-user")).files as FileEntry[];

    expect(files).toStrictEqual([
      {
        path: "files/db/schema/api-keys.sqlite.ts",
        target: "@db/schema/api-keys.ts",
        onlyWith: "database-d1",
      },
      {
        path: "files/db/schema/api-keys.pg.ts",
        target: "@db/schema/api-keys.ts",
        onlyWith: "database-postgres",
      },
      {
        path: "files/auth/plugins/api-key.ts",
        target: "@auth/plugins/api-key.ts",
      },
      {
        path: "files/auth/api-key-scopes.ts",
        target: "@auth/api-key-scopes.ts",
      },
      {
        path: "files/auth/api-key-rules.ts",
        target: "@auth/api-key-rules.ts",
      },
      { path: "files/auth/caller.ts", target: "@auth/caller.ts" },
    ]);
  });

  it("carries no patch, because nothing it adds needs a registration table", async () => {
    expect((await readDescriptor("api-keys-user")).patches).toStrictEqual([]);
  });

  it("is named by the core's requiresOneOf and by the organization owner's conflictsWith", async () => {
    expect((await readDescriptor("api-keys")).requiresOneOf).toContain(
      "api-keys-user"
    );
    expect(
      (await readDescriptor("api-keys-organization")).conflictsWith
    ).toContain("api-keys-user");
  });

  it("is the module that fills auth's pre-declared ./caller export", async () => {
    const pkg = JSON.parse(
      await readFile(
        fileURLToPath(new URL("auth/files/package.json", MODULES)),
        "utf-8"
      )
    ) as { exports: Record<string, string> };

    expect(pkg.exports["./caller"]).toBe("./src/caller.ts");
  });
});
