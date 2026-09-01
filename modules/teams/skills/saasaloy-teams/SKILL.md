---
name: saasaloy-teams
description: Runbook for the teams feature, which adds Better Auth organizations, memberships, invitations, active-organization switching, and the site-admin Teams screen. Use when changing organization settings, the schema snapshot, the admin flow, invitation handling, or removal behavior.
---

# teams

The `teams` feature adds Better Auth organizations to `packages/auth`, organization tables to `packages/db`, and a site-admin-only Teams screen to `apps/admin`. The product calls this capability "teams", but Better Auth's nested teams-within-an-organization feature stays disabled. There is no `team` table, `teamMember` table, or `session.activeTeamId` column.

## Admin screen boundaries

The `/teams` screen inherits the admin root guard. A valid session is not enough. The user must have `user.role === "admin"` before the route loader runs.

The screen lists the caller's own organizations through `auth.organization.list()`. It is not an all-organizations backoffice browser. Do not query the database directly to widen its scope because that bypasses the organization plugin's membership checks.

The screen supports organization creation, active-organization switching, member removal, invitation creation, and invitation cancellation. The create form derives an editable slug and checks it with `auth.organization.checkSlug()` before creation.

## Invitation flow

The feature sends no invitation email. A successful invite displays and copies the returned `Invitation ID`. A signed-in recipient application must call `auth.organization.acceptInvitation({ invitationId })`.

There is no invitation-acceptance UI in this module. That flow belongs in `apps/web`, where normal recipients can sign in without passing the site-admin guard. Do not add an acceptance route under `apps/admin`.

## Plugin configuration

`packages/auth/src/plugins/organization.ts` owns the server options. It keeps `teams.enabled` false and leaves `sendInvitationEmail` unset. Add custom roles through Better Auth's organization access helpers in that file.

The descriptor applies two `plugin-array` patches. One adds `organizationPlugin()` to `packages/auth/src/auth.ts`. The other adds `organizationClient()` to `authClientPlugins` in `packages/auth/src/client.ts`. Keep both calls at zero arguments because the patch engine records and reverses that exact shape.

The descriptor also applies a `const-array` patch to `NAV_ITEMS`. Its stable identity is the `to` value `/teams`. Editing the label in a generated project does not create a duplicate on update.

## Schema and migrations

`packages/db/src/schema/teams.ts` is a hand-written Better Auth 1.7.2 snapshot for `organization`, `member`, and `invitation`. `packages/db/src/schema/auth.ts` pre-declares the nullable `session.activeOrganizationId` field. Keep the Better Auth property names because its adapter matches those names.

Run `pnpm --filter @repo/db db:generate` after a schema change. Review the migration before you apply it. Then use the active database driver skill for the migration command.

Removing `teams` deletes its managed files and reverses the plugin and navigation patches. It does not drop deployed tables. The remove command warns that `organization`, `member`, and `invitation` survive, so review any generated drop migration before applying it.

## Conventions to honor

- Keep the nested teams feature off unless a separate product decision adds its tables and UI.
- Keep the admin screen limited to the caller's memberships.
- Keep invitation acceptance outside `apps/admin`.
- Keep invitation delivery optional. Do not add an `email` dependency for the copy-ID flow.
- Use the organization client methods from `@repo/auth/client`. Do not import Better Auth directly into `apps/admin`.
- Run database migrations by hand after you review the generated SQL.
