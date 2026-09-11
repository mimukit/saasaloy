---
name: saasaloy-multitenant
description: Runbook for the multitenant feature, which resolves which organization a request acts for and guards every scoped query. Use when writing or reviewing a route that reads organization-owned data, adding a table that belongs to an organization, registering a new credential type, or working on the superadmin x-organization-id bypass, the 401/403 rules, or removal behavior.
---

# multitenant

The `multitenant` feature answers one question on every request: **which organization is this for, and who is asking?** `teams` shipped the organizations. This ships the boundary around them.

It adds `requireTenant(c)` to `packages/auth`, the branded `TenantId` and the `forTenant` wrapper to `packages/db`, `GET /tenant` to the api, and a worked `projects` example you delete once your own tables exist.

## The route recipe

Two lines, and neither is optional.

```ts
// apps/api/src/routes/projects.ts
const tenant = await requireTenant(c);
const rows = await withDb(c, (db) => listProjects(db, tenant.organizationId));
```

```ts
// packages/db/src/repositories/projects.ts
export function listProjects(db: Db, tenantId: TenantId) {
  return forTenant(db, tenantId).select(projects);
}
```

`requireTenant` is the only thing in the project that mints a `TenantId`, and `forTenant` accepts nothing else. A handler that skips the first line cannot call the second, and that is a compile error rather than a review note.

The queries live in a repository, not in the route. `drizzle-orm` belongs to `@repo/db` and no other workspace imports it (ADR 0020), so a route cannot write `eq(...)` even when it wants to.

**The one gap:** a handler that ignores `forTenant` and writes `db.select().from(projects)` still compiles. Convention and review cover that in v1; a lint rule that refuses raw `db` on a tenant table is a filed follow-up. Read a scoped route for the `forTenant(` call the same way you read it for the `requireTenant(` call.

## Three different questions

Do not reach for the wrong one.

| Helper | Question |
| --- | --- |
| `requireAdmin(c)` | May this session open `apps/admin`? |
| `requireSuperadmin(c)` | Is this the one site role that crosses organizations? |
| `requireTenant(c)` | Which organization is this request for, and as whom? |

A site `admin` is an ordinary member on every tenant route. The site role grants nothing here, so an `admin` who belongs to no organization gets the same 403 as anyone else.

## The tenant column convention

Every table a request may read on behalf of one organization declares the same column and the same index:

```ts
export const projects = sqliteTable(
  "projects",
  { id: text("id").primaryKey(), organizationId: tenantColumn(), /* ... */ },
  (table) => [tenantIndex(table, "projects")]
);
```

`tenantColumn()` and `tenantIndex()` come from `@repo/db/tenant-column`, which ships in two dialects. They expand to `text("organization_id").notNull().references(() => organization.id)` plus one index named `<table>_organization_id_idx`.

Three parts matter, each for its own reason:

- **The property name is `organizationId`.** `forTenant` reads `table.organizationId`, so a table naming it `orgId` does not fit `TenantTable` even when the column underneath is right.
- **`notNull` is not negotiable.** A nullable tenant column makes a row belonging to no organization, which every scoped query silently omits and no guard ever refuses.
- **The index carries every scoped read.** Without it each one is a full scan.

The `teams` and `api-keys` tables already meet the convention. `members`, `invitations` and `organization_roles` were hand-written that way; `api_keys` gets there through the API-key plugin's `referenceId` field rename. `organizations` itself is the parent and carries no tenant column.

## What `TenantId` refuses

`TenantId` is `string` at runtime and a distinct type at compile time. `packages/db/src/tenant.typecheck.ts` is the proof, and `pnpm typecheck` in `packages/db` runs it. Every `@ts-expect-error` in that file is an assertion, so `tsc` fails if one stops being an error. Do not silence one; change it in the same commit as the guard, and say why.

It refuses, in order of how likely each is to be the bug:

- a raw string, so a route that reads an organization id out of a request body or a header cannot scope a query with it,
- a table with no `organizationId` column,
- an insert that names `organizationId` itself, so a request body spread into `values` cannot write into another organization,
- an update that sets `organizationId`, which is how a row would be moved between organizations.

## The header contract

`x-organization-id` names an organization to act inside. It is honoured **only** on the cookie path and **only** when the session's role is `superadmin`.

- A `superadmin` sending it gets that organization, with `principal: { kind: "superadmin", userId }`. The id is looked up first, so a typo is 404 `unknown organization` rather than a tenant that does not exist.
- Any other signed-in caller sending it gets 403 `forbidden`. Refused, not ignored — a silently ignored header reads as "it worked" to whoever sent it.
- Beside a bearer credential it is 403 whatever it says. A key is bound to one organization.

There is no organization picker in `apps/admin` yet. Reach for the header with `curl` until the follow-up issue lands.

## Failure codes

Every one of these renders through api's `ERROR_CODES` envelope, so a caller parses one body.

| Condition | Status | Message |
| --- | --- | --- |
| Signed out | 401 | `sign in first` |
| No active organization, or membership revoked | 403 | `no active organization` |
| `x-organization-id` from a caller who may not send it | 403 | `forbidden` |
| `x-organization-id` from a `superadmin` naming no organization | 404 | `unknown organization` |
| A claimed bearer credential that fails (`api-keys`) | 401 | `invalid api key` |
| A `can()` refusal (`rbac`) | 403 | `permission required: <resource>:<action>` |

`NO_ACTIVE_ORGANIZATION` is exported and `apps/admin` matches on the exact string, to tell "you have no organization yet" apart from "you may not do this". Change it in `tenant-rules.ts` and change the SPA in the same commit.

## The credential resolver table

`packages/auth/src/tenant.ts` exports an empty table:

```ts
export const tenantResolvers = defineTenantResolvers({ resolvers: [] });
```

A credential module registers into it with one `plugin-array` patch, the same shape `authClientPlugins` uses. Keep the array literal at module scope, and never remove it even while it is empty.

A resolver has a `name`, a synchronous `claims(headers)` and an async `resolve(c)`. `claims` answers "is this my credential", not "is it valid". Returning `true` takes the request off the session path for good: `resolve` then returns a `Tenant` or throws. That is what stops a rejected API key from quietly falling back to whatever session cookie rode along with it. Array order is precedence; the first claimer wins.

## Roles are loaded once

On the member path, `requireTenant` reads that organization's `organization_roles` rows in one query and resolves the caller's statements onto the principal. `rbac`'s `can()` then reads the answer instead of asking again, so a route with three permission checks still pays for one round trip.

The merge has four cases, all in `resolveStatements` in `tenant-rules.ts` and all covered by `tenant-rules.test.ts`: a base role with a stored row of the same name resolves to the static role widened by the row; a base role alone resolves to itself; a custom role resolves to its stored row; a name matching neither resolves to nothing. The last one is the decision that matters — a deleted role fails closed for its holders rather than falling back to `member`.

## Boundaries to honor

- **Do not add a second permission path.** `rbac`'s `can()` reads `principal.statements` and nothing else. A route that calls `auth.api.hasPermission` itself pays a query per check and answers from a different engine.
- **Do not mint a `TenantId` outside `requireTenant`.** `asTenantId` exists for that one caller. Calling it on a request-supplied value hands out another organization's rows.
- **Do not widen `Tenant.organizationId` to `string`.** Every guarantee above turns into a naming convention the moment you do.
- **Do not resolve the tenant in middleware.** The `chained-route` patch kind registers routes, not `.use()` links (ADR 0028), so a middleware convention would have no way to install itself.
- **The `projects` table and its routes are an example.** Delete them once your own scoped tables exist. `remove multitenant` names `projects` in its warning, and every route written against `requireTenant` or `forTenant` stops compiling when this module goes.

## Upgrading from singular table names

A project that installed `multitenant` before the tables became plural has a `project` table in its database. `projects` is this module's example table, not a Better Auth table, so the adapter never looks it up. A project that already deleted the example has nothing to do here. Otherwise, move it to the new name like this:

1. Update `auth` first, because its schema rename and `usePlural: true` land together. Then run `saasaloy update multitenant` to take the new schema file.
2. Run `pnpm db:generate`.
3. drizzle-kit asks, for each new table, whether it is created or renamed from an existing table. Pick the rename from the old name: `project` → `projects`.
4. Read the generated SQL before you apply it. It must rename the table and its index (`ALTER TABLE ... RENAME TO ...`), and contain no `DROP TABLE` or `CREATE TABLE` for a table that holds data.
5. If it drops a table, delete that migration file and run `pnpm db:generate` again.
6. Apply the migration, then sign in once to confirm the adapter finds every table.
