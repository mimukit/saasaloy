import { index, text } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations } from "./schema/teams";

// The Postgres half of the tenant column convention, selected by
// `onlyWith: "database-postgres"`. Its SQLite twin sits beside it as
// `tenant-column.sqlite.ts`, and exactly one of the two lands as
// `packages/db/src/tenant-column.ts`. Change one and change the other.
//
// THE CONVENTION, in one line: every table a request may read on behalf of one
// organization declares `organizationId: text("organization_id").notNull().references(()
// => organizations.id)` plus one index on that column. `members`, `invitations` and
// `organization_roles` from `teams` were hand-written that way before this helper existed,
// and `api_keys` from `api-keys` gets there through the plugin's own field rename. The two
// functions below are the same declaration, written once, for every table a project adds
// afterwards.
//
// `forTenant` in `./tenant.ts` accepts a table only when it carries this column, so a
// table that skips the convention cannot be read through the guard at all. That is the
// enforcement; this file is the convenience.

/**
 * The tenant column. Use it as the `organizationId` property of a scoped table, and
 * nothing else:
 *
 *   export const projects = pgTable("projects", { organizationId: tenantColumn(), ... })
 *
 * The property name matters as much as the column name. `forTenant` reads
 * `table.organizationId`, so a table that names the property `orgId` does not fit
 * `TenantTable` even when the underlying column is right.
 *
 * `notNull` is not negotiable. A nullable tenant column makes a row that belongs to no
 * organization, which every scoped query then silently omits and no guard ever refuses.
 *
 * `text` rather than `uuid`, because `organizations.id` is the Better Auth plugin's own
 * generated string id and a foreign key has to match the column it points at.
 */
export function tenantColumn() {
  return text("organization_id")
    .notNull()
    .references(() => organizations.id);
}

/**
 * The one index the convention asks for, named `<table>_organization_id_idx` to match the
 * three `teams` tables. Every scoped read filters on this column, so without it each one
 * is a sequential scan.
 *
 *   (table) => [tenantIndex(table, "projects")]
 */
export function tenantIndex(
  table: { organizationId: AnyPgColumn },
  name: string
) {
  return index(`${name}_organization_id_idx`).on(table.organizationId);
}
