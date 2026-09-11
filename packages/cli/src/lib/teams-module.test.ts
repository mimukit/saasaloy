import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegistryItem } from "./schema.js";

const descriptorPath = fileURLToPath(
  new URL("../../../../modules/teams/registry-item.json", import.meta.url)
);
const teamsModuleUrl = new URL("../../../../modules/teams/", import.meta.url);

async function readDescriptor(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(descriptorPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("teams module descriptor", () => {
  it("declares the auth and database integration", async () => {
    const descriptor = await readDescriptor();

    await expect(validateRegistryItem(descriptor)).resolves.toMatchObject({
      valid: true,
    });
    // No driver here. The schema ships in two dialects under `onlyWith`, the same
    // shape `modules/auth` uses, so `teams` installs on either driver.
    expect(descriptor.dependsOn).toStrictEqual([
      "api",
      "database",
      "auth",
      "admin",
    ]);
    expect(descriptor.files).toStrictEqual(
      expect.arrayContaining([
        {
          path: "files/db/schema/teams.sqlite.ts",
          target: "@db/schema/teams.ts",
          onlyWith: "database-d1",
        },
        {
          path: "files/db/schema/teams.pg.ts",
          target: "@db/schema/teams.ts",
          onlyWith: "database-postgres",
        },
        {
          path: "files/auth/access.ts",
          target: "@auth/access.ts",
        },
        {
          path: "files/auth/plugins/organization.ts",
          target: "@auth/plugins/organization.ts",
        },
        {
          path: "files/auth/plugins/organization-client.ts",
          target: "@auth/plugins/organization-client.ts",
        },
      ])
    );
  });

  it("patches both Better Auth plugin arrays", async () => {
    const descriptor = await readDescriptor();

    expect(descriptor.patches).toStrictEqual(
      expect.arrayContaining([
        {
          file: "packages/auth/src/auth.ts",
          kind: "plugin-array",
          exportName: "auth",
          arrayProp: "plugins",
          call: "organizationPlugin",
          import: {
            name: "organizationPlugin",
            from: "./plugins/organization",
          },
        },
        {
          file: "packages/auth/src/client.ts",
          kind: "plugin-array",
          exportName: "authClientPlugins",
          arrayProp: "plugins",
          // The wrapper, not `organizationClient` itself: the patch engine records a
          // zero-argument call, and the client plugin needs `{ ac, roles }`.
          call: "organizationClientPlugin",
          import: {
            name: "organizationClientPlugin",
            from: "./plugins/organization-client",
          },
        },
      ])
    );
  });

  it("warns that deployed organization tables survive removal", async () => {
    const descriptor = await readDescriptor();
    const warnings = descriptor.removeWarnings as string[];

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/organization/);
    expect(warnings[0]).toMatch(/member/);
    expect(warnings[0]).toMatch(/invitation/);
    expect(warnings[0]).toMatch(/organization_roles/);
    expect(warnings[0]).toMatch(/drop migration/);
  });

  it("installs the admin screen, its components, and the sidebar entry", async () => {
    const descriptor = await readDescriptor();

    expect(descriptor.files).toStrictEqual(
      expect.arrayContaining([
        {
          path: "files/admin/routes/teams.tsx",
          target: "@admin/routes/teams.tsx",
        },
        {
          path: "files/admin/components/organization-create-form.tsx",
          target: "@admin/components/organization-create-form.tsx",
        },
        {
          path: "files/admin/components/organization-workspace.tsx",
          target: "@admin/components/organization-workspace.tsx",
        },
      ])
    );
    expect(descriptor.patches).toStrictEqual(
      expect.arrayContaining([
        {
          file: "apps/admin/src/components/app-shell.tsx",
          kind: "const-array",
          constName: "NAV_ITEMS",
          key: "to",
          entry: { to: "/teams", label: "Teams" },
        },
      ])
    );
  });

  it("ships guidance for the site-admin organization flow", async () => {
    const descriptor = await readDescriptor();
    const skill = await readFile(
      new URL("skills/saasaloy-teams/SKILL.md", teamsModuleUrl),
      "utf-8"
    );

    expect(descriptor.agent).toStrictEqual({
      skills: ["skills/saasaloy-teams"],
    });
    expect(skill).toMatch(/^---\nname: saasaloy-teams\n/);
    expect(skill).toMatch(/site-admin-only/);
    expect(skill).toMatch(/caller's own organizations/);
    expect(skill).toMatch(/Invitation ID/);
    expect(skill).toMatch(/no invitation-acceptance UI/);
  });
});
