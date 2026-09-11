import { index, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { organization } from "./schema/teams";

// The SQLite half of the tenant column convention, selected by `onlyWith: "database-d1"`.
// Its Postgres twin sits beside it as `tenant-column.pg.ts`, and exactly one of the two
// lands as `packages/db/src/tenant-column.ts`. Change one and change the other.
//
// THE CONVENTION, in one line: every table a request may read on behalf of one
// organization declares `organizationId: text("organization_id").notNull().references(()
// => organization.id)` plus one index on that column. `member`, `invitation` and
// `organizationRole` from `teams` were hand-written that way before this helper existed,
// and `apikey` from `api-keys` gets there through the plugin's own field rename. The two
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
 *   export const project = sqliteTable("project", { organizationId: tenantColumn(), ... })
 *
 * The property name matters as much as the column name. `forTenant` reads
 * `table.organizationId`, so a table that names the property `orgId` does not fit
 * `TenantTable` even when the underlying column is right.
 *
 * `notNull` is not negotiable. A nullable tenant column makes a row that belongs to no
 * organization, which every scoped query then silently omits and no guard ever refuses.
 */
export function tenantColumn() {
  return text("organization_id")
    .notNull()
    .references(() => organization.id);
}

/**
 * The one index the convention asks for, named `<table>_organization_id_idx` to match the
 * three `teams` tables. Every scoped read filters on this column, so without it each one
 * is a full scan.
 *
 *   (table) => [tenantIndex(table, "project")]
 */
export function tenantIndex(
  table: { organizationId: AnySQLiteColumn },
  name: string
) {
  return index(`${name}_organization_id_idx`).on(table.organizationId);
}
