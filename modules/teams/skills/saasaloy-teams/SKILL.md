---
name: saasaloy-teams
description: Runbook for the teams feature, which adds Better Auth organizations, memberships, invitations, active-organization switching, the permission vocabulary in access.ts, and the site-admin Teams screen. Use when changing organization settings, the permission statements or base roles, the schema snapshot, the admin flow, invitation handling, or removal behavior.
---

# teams

The `teams` feature adds Better Auth organizations to `packages/auth`, organization tables to `packages/db`, and a site-admin-only Teams screen to `apps/admin`. The product calls this capability "teams", but Better Auth's nested teams-within-an-organization feature stays disabled. There is no `team` table, `teamMember` table, or `session.activeTeamId` column.

## Admin screen boundaries

The `/teams` screen inherits the admin root guard. A valid session is not enough. The user must hold `admin` or `superadmin` before the route loader runs. Neither site role grants anything inside an organization: the screen still lists only the caller's own memberships.

The screen lists the caller's own organizations through `auth.organization.list()`. It is not an all-organizations backoffice browser. Do not query the database directly to widen its scope because that bypasses the organization plugin's membership checks.

The screen supports organization creation, active-organization switching, member removal, invitation creation, and invitation cancellation. The create form derives an editable slug and checks it with `auth.organization.checkSlug()` before creation.

## Invitation flow

The feature sends no invitation email. A successful invite displays and copies the returned `Invitation ID`. A signed-in recipient application must call `auth.organization.acceptInvitation({ invitationId })`.

There is no invitation-acceptance UI in this module. That flow belongs in `apps/web`, where normal recipients can sign in without passing the site-admin guard. Do not add an acceptance route under `apps/admin`.

## The permission vocabulary

`packages/auth/src/access.ts` declares every resource an organization can grant, and the three base roles built from them. It is the one file to edit when you add a resource, and no module patches it.

`statements` spreads Better Auth's `defaultStatements` (`organization`, `member`, `invitation`, `team`, `ac`) and adds `project` and `apiKey`, each with `create`, `read`, `update` and `delete`. Keep the spread first. The plugin's own endpoints authorize against those names, so dropping one turns off a built-in endpoint rather than a feature of this project.

`owner`, `admin` and `member` are the base roles, and all three must stay in the exported `roles` map. `updateMemberRole` refuses a role name that exists in neither that map nor the `organizationRole` table, so removing one strands its holders. They are also locked: the `rbac` module's `roleLockGuard()` refuses `createRole`, `updateRole` and `deleteRole` for those three names, because a stored row of the same name would silently extend the static role.

A custom role picks from whatever `statements` holds at the moment it is created. So adding a resource is an edit to this file, then a deploy, and only then can a customer grant it.

The file imports `better-auth/plugins/access` and `better-auth/plugins/organization/access` and nothing else. Both are pure, which is what makes the file safe in the browser bundle. Keep it that way.

## Plugin configuration

`packages/auth/src/plugins/organization.ts` owns the server options. It keeps `teams.enabled` false, leaves `sendInvitationEmail` unset, passes `ac` and `roles` from `access.ts`, and enables `dynamicAccessControl`. `packages/auth/src/plugins/organization-client.ts` passes the same `ac` and `roles` to the client plugin. Both halves have to agree, or the browser offers a control the server refuses.

`dynamicAccessControl` is what makes the `organizationRole` table live. Turning the option off does not remove the table; drop both together, or `createRole` writes into nothing.

The descriptor applies two `plugin-array` patches. One adds `organizationPlugin()` to `packages/auth/src/auth.ts`. The other adds `organizationClientPlugin()` to `authClientPlugins` in `packages/auth/src/client.ts`. Keep both calls at zero arguments because the patch engine records and reverses that exact shape. That is why the options live in the two wrapper files and not in the patch.

The descriptor also applies a `const-array` patch to `NAV_ITEMS`. Its stable identity is the `to` value `/teams`. Editing the label in a generated project does not create a duplicate on update.

## Schema and migrations

`packages/db/src/schema/teams.ts` is a hand-written Better Auth 1.7.2 snapshot for `organization`, `member`, `invitation`, and `organizationRole`. `packages/db/src/schema/auth.ts` pre-declares the nullable `session.activeOrganizationId` field. Keep the Better Auth property names because its adapter matches those names.

The module ships the snapshot in two dialects, `teams.sqlite.ts` and `teams.pg.ts`, and `onlyWith` installs the one matching the project's driver. Edit one table and edit its twin. A mismatch only shows up on the other driver's first install, long after the edit.

`member`, `invitation` and `organizationRole` each follow the tenant column convention: a `organizationId` property on an `organization_id` column, `notNull`, `references(() => organization.id)`, and one index. That is what lets `forTenant` from `@repo/db/tenant` accept them once `multitenant` is installed.

Run `pnpm --filter @repo/db db:generate` after a schema change. Review the migration before you apply it. Then use the active database driver skill for the migration command.

Removing `teams` deletes its managed files and reverses the plugin and navigation patches. It does not drop deployed tables. The remove command warns that `organization`, `member`, `invitation`, and `organizationRole` survive, so review any generated drop migration before applying it.

## Conventions to honor

- Keep the nested teams feature off unless a separate product decision adds its tables and UI.
- Keep the three base roles in `roles`, and add a resource by editing `statements` rather than by patching `access.ts` from another module.
- Keep `access.ts` free of any import outside the two Better Auth access modules, so it stays safe in the browser bundle.
- Keep the admin screen limited to the caller's memberships.
- Keep invitation acceptance outside `apps/admin`.
- Keep invitation delivery optional. Do not add an `email` dependency for the copy-ID flow.
- Use the organization client methods from `@repo/auth/client`. Do not import Better Auth directly into `apps/admin`.
- Run database migrations by hand after you review the generated SQL.
