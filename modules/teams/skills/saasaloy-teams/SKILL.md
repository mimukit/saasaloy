---
name: saasaloy-teams
description: Runbook for the teams feature, which adds Better Auth organizations, memberships, invitations, active-organization switching, the permission vocabulary in access.ts, the pure can() rule, the base-role lock, and the site-admin Teams screen. Use when changing organization settings, adding a resource to the permission vocabulary, creating or editing a custom role, or working on the base-role lock, the dangling-role rule, the schema snapshot, the admin flow, invitation handling, or removal behavior.
---

# teams

The `teams` feature adds Better Auth organizations to `packages/auth`, organization tables to `packages/db`, and a site-admin-only Teams screen to `apps/admin`. The product calls this capability "teams", but Better Auth's nested teams-within-an-organization feature stays disabled. There is no `team` table, `teamMember` table, or `sessions.activeTeamId` column.

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

`owner`, `admin` and `member` are the base roles, and all three must stay in the exported `roles` map. `updateMemberRole` refuses a role name that exists in neither that map nor the `organization_roles` table, so removing one strands its holders. They are also locked: this module's `roleLockGuard()` refuses `createRole`, `updateRole` and `deleteRole` for those three names, because a stored row of the same name would silently extend the static role.

A custom role picks from whatever `statements` holds at the moment it is created. So adding a resource is an edit to this file, then a deploy, and only then can a customer grant it.

The file imports `better-auth/plugins/access` and `better-auth/plugins/organization/access` and nothing else. Both are pure, which is what makes the file safe in the browser bundle. Keep it that way.

## Adding a resource

Edit `packages/auth/src/access.ts`, and nothing else.

```ts
export const statements = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete"],
  invoice: ["read", "refund"], // new
} as const;
```

Then decide which base roles hold it, in the same file. The `/roles` grid that `multitenant` ships picks the new resource up with no change, a custom role can be given it immediately, and `requirePermission(c, { invoice: ["refund"] })` starts typechecking.

No module patches `access.ts`. A project owns it outright.

## The base roles are locked

`owner`, `admin` and `member` are static, and they stay that way. Two things enforce it:

- `roleLockGuard()`, a Better Auth `before` hook on `/organization/create-role`, `/update-role` and `/delete-role`. It refuses any request naming a base role with 403 `base role is locked: <name>`, and it runs before the plugin's own `ac` check, so an owner holding every statement cannot get past it.
- The `/roles` screen renders base roles with no edit or delete control.

The reason is the merge. `dynamicAccessControl` makes `hasPermission` load an organization's stored rows and merge each one **over** the static role of the same name. A stored row called `admin` would widen the static `admin` invisibly, and a row called `member` would widen every ordinary member in that organization at once. Neither shows up in a code review, and both survive a deploy.

The guard and the switch ship together, in this module, because a project that enables `dynamicAccessControl` without the guard is the exact hole above.

Better Auth refuses the three names on its own in `1.7.3`: `createRole` and `updateRole` call `checkIfRoleNameIsTakenByPreDefinedRole`, and `deleteRole` answers `CANNOT_DELETE_A_PRE_DEFINED_ROLE`. So `roleLockGuard()` is defence in depth rather than the only guard. Keep it. It runs before the plugin's own `ac` check, it gives one message (`base role is locked: <name>`) for all three endpoints, and the plugin's check is a library behaviour that a minor upgrade can change.

To change what a base role holds, edit `access.ts`. That is a code change, and it is reviewed.

## Custom roles

A custom role is a name plus a permission map picked from `statements`. Create one on the `/roles` screen `multitenant` ships, or from code:

```ts
await auth.organization.createRole({
  organizationId,
  role: "viewer",
  permission: { project: ["read"], ac: ["read"] },
});
```

Assign it with `updateMemberRole`. It takes effect on the member's next request: `requireTenant` reads the `organization_roles` rows fresh each time.

Three rules the screen enforces and you should keep:

- **A held role cannot be deleted.** `deleteRole` does not check for holders in `better-auth@1.7.2`, and a member left holding a deleted name resolves to *no statements at all* — a silent lockout, not a demotion. The screen disables delete while anyone holds the role and names the holders.
- **A dangling role grants nothing.** That is the decision, not an accident: `resolveStatements` returns `{}` for a name that matches neither a base role nor a stored row. Failing back to `member` would hand a deleted role more power than the operator meant.
- **The last owner cannot be demoted.** Better Auth refuses it server-side; the screen disables the option so the operator does not have to read an error to learn it.

## `can()` is pure

`packages/auth/src/permission-rules.ts` ships here, beside the vocabulary it reads, and it imports nothing at runtime. `requireTenant` already ran the one `organization_roles` query and merged the statements onto the principal, so `can(principal, permissions)` is a function over data the request already holds. A route with three permission checks still pays for one round trip.

`multitenant` ships the throwing half, `requirePermission`, because that is the request path. Read `saasaloy-multitenant` for the route recipe and the 403 table.

Three arms, and one of them is not about statements:

| Principal | Answer |
| --- | --- |
| `superadmin` | true, without reading statements at all |
| `member` | every demanded action must appear in the resolved statements |
| `apiKey` | the same rule, over the key's fixed scope |

An empty demand — `{}` — is refused, not allowed. It is a bug at the call site, and reading it as "no permission needed" would open a route.

## Plugin configuration

`packages/auth/src/plugins/organization.ts` owns the server options. It keeps `teams.enabled` false, leaves `sendInvitationEmail` unset, passes `ac` and `roles` from `access.ts`, and enables `dynamicAccessControl`. `packages/auth/src/plugins/organization-client.ts` passes the same `ac` and `roles` to the client plugin. Both halves have to agree, or the browser offers a control the server refuses.

`dynamicAccessControl` is what makes the `organization_roles` table live. Turning the option off does not remove the table; drop both together, or `createRole` writes into nothing.

The descriptor applies two `plugin-array` patches. One adds `organizationPlugin()` to `packages/auth/src/auth.ts`. The other adds `organizationClientPlugin()` to `authClientPlugins` in `packages/auth/src/client.ts`. Keep both calls at zero arguments because the patch engine records and reverses that exact shape. That is why the options live in the two wrapper files and not in the patch.

The descriptor also applies a `const-array` patch to `NAV_ITEMS`. Its stable identity is the `to` value `/teams`. Editing the label in a generated project does not create a duplicate on update.

## Schema and migrations

`packages/db/src/schema/teams.ts` is a hand-written Better Auth 1.7.2 snapshot for the `organizations`, `members`, `invitations`, and `organization_roles` tables. `packages/db/src/schema/auth.ts` pre-declares the nullable `sessions.activeOrganizationId` field. Keep the Better Auth property names because its adapter matches those names.

The module ships the snapshot in two dialects, `teams.sqlite.ts` and `teams.pg.ts`, and `onlyWith` installs the one matching the project's driver. Edit one table and edit its twin. A mismatch only shows up on the other driver's first install, long after the edit.

The `members`, `invitations` and `organization_roles` tables each follow the tenant column convention: a `organizationId` property on an `organization_id` column, `notNull`, `references(() => organizations.id)`, and one index. That is what lets `forTenant` from `@repo/db/tenant` accept them once `multitenant` is installed.

Run `pnpm --filter @repo/db db:generate` after a schema change. Review the migration before you apply it. Then use the active database driver skill for the migration command.

Removing `teams` deletes its managed files and reverses the plugin and navigation patches. It does not drop deployed tables. The remove command warns that the `organizations`, `members`, `invitations`, and `organization_roles` tables survive, so review any generated drop migration before applying it. It also warns that stored custom roles survive with nothing left to read them, so reassign their holders to a base role first.

## Conventions to honor

- Keep the nested teams feature off unless a separate product decision adds its tables and UI.
- Keep the three base roles in `roles`, and add a resource by editing `statements` rather than by patching `access.ts` from another module.
- Keep `access.ts` free of any import outside the two Better Auth access modules, so it stays safe in the browser bundle.
- Keep the admin screen limited to the caller's memberships.
- Keep invitation acceptance outside `apps/admin`.
- Keep invitation delivery optional. Do not add an `email` dependency for the copy-ID flow.
- Use the organization client methods from `@repo/auth/client`. Do not import Better Auth directly into `apps/admin`.
- Run database migrations by hand after you review the generated SQL.

## Upgrading from singular table names

A project that installed `teams` before the tables became plural has `organization`, `member`, `invitation` and `organizationRole` in its database. Move them to the new names like this:

1. Update `auth` first, because its schema rename and `usePlural: true` land together. Then run `saasaloy update teams` to take the new schema file.
2. Run `pnpm db:generate`.
3. drizzle-kit asks, for each new table, whether it is created or renamed from an existing table. Pick the rename from the old name: `organization` → `organizations`, `member` → `members`, `invitation` → `invitations`, `organizationRole` → `organization_roles`.
4. Read the generated SQL before you apply it. It must rename tables and indexes (`ALTER TABLE ... RENAME TO ...`), and contain no `DROP TABLE` or `CREATE TABLE` for a table that holds data.
5. If it drops a table, delete that migration file and run `pnpm db:generate` again.
6. Apply the migration, then sign in once to confirm the adapter finds every table.
