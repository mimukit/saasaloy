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
    // No driver here. `database` names its driver, so `teams` depends on the
    // capability alone, the same shape `modules/auth` uses.
    expect(descriptor.dependsOn).toStrictEqual([
      "api",
      "database",
      "auth",
      "admin",
    ]);
    expect(descriptor.files).toStrictEqual(
      expect.arrayContaining([
        {
          path: "files/db/schema/teams.ts",
          target: "@db/schema/teams.ts",
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

  it("adds a row to every Better Auth plugin table", async () => {
    const descriptor = await readDescriptor();

    expect(descriptor.entries).toStrictEqual(
      expect.arrayContaining([
        {
          table: "auth.plugins",
          call: "organizationPlugin",
          import: {
            name: "organizationPlugin",
            from: "./plugins/organization",
          },
        },
        {
          table: "client.plugins",
          // The wrapper, not `organizationClient` itself: a `calls` table prints a
          // zero-argument call, and the client plugin needs `{ ac, roles }`.
          call: "organizationClientPlugin",
          import: {
            name: "organizationClientPlugin",
            from: "./plugins/organization-client",
          },
        },
        {
          // The base-role lock ships with `dynamicAccessControl`, which this module
          // turns on. A project that enabled the switch without the guard would let a
          // stored row named `admin` widen the static `admin`.
          table: "auth.plugins",
          call: "roleLockGuard",
          import: {
            name: "roleLockGuard",
            from: "./plugins/role-lock",
          },
        },
      ])
    );
  });

  it("ships the permission rule and the base-role lock", async () => {
    const descriptor = await readDescriptor();

    expect(descriptor.files).toStrictEqual(
      expect.arrayContaining([
        {
          path: "files/auth/permission-rules.ts",
          target: "@auth/permission-rules.ts",
        },
        {
          path: "files/auth/plugins/role-lock.ts",
          target: "@auth/plugins/role-lock.ts",
        },
      ])
    );
  });

  it("warns that deployed organization tables survive removal", async () => {
    const descriptor = await readDescriptor();
    const warnings = descriptor.removeWarnings as string[];

    // One: the tables. The custom-role warning sits on `multitenant`, because removing it
    // drops the /roles screen while teams keeps the stored roles live.
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
    expect(descriptor.entries).toStrictEqual(
      expect.arrayContaining([
        {
          table: "admin.nav",
          area: "/",
          group: "Manage",
          entry: { to: "/teams", label: "Teams" },
          import: { name: "UsersRoundIcon", from: "lucide-react" },
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
