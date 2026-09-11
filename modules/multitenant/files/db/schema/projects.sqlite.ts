import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tenantColumn, tenantIndex } from "../tenant-column";

// The SQLite half of the worked example, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `projects.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/projects.ts`.
//
// `projects` is a real table with one string column, and it exists to be the thing the
// tenant guard is demonstrated and proved on: `packages/db/src/tenant.typecheck.ts`
// compiles against it, `apps/api/src/routes/projects.ts` reads it through `forTenant`,
// and the A/B isolation check in the QA script inserts one row per organization and
// asserts each caller sees one.
//
// Delete it once your own scoped tables exist. Nothing outside this module imports it,
// and `remove multitenant` names it in the warning.

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

export const projects = sqliteTable(
  "projects",
  {
    createdAt: timestampMs("created_at")
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // The tenant column convention, from `../tenant-column`. Copy these two lines into
    // every table a request reads on behalf of one organization.
    organizationId: tenantColumn(),
  },
  (table) => [tenantIndex(table, "projects")]
);
