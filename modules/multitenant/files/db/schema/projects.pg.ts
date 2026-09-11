import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantColumn, tenantIndex } from "../tenant-column";

// The Postgres half of the worked example, selected by
// `onlyWith: "database-postgres"`. Its SQLite twin sits beside it as
// `projects.sqlite.ts`, and exactly one of the two lands as
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

// `timestamptz`, for the reason `auth.pg.ts` spells out: a bare `timestamp` drops the
// offset postgres.js sends, and a JS `Date` then reads it back in the server's own zone.
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const projects = pgTable(
  "projects",
  {
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // The tenant column convention, from `../tenant-column`. Copy these two lines into
    // every table a request reads on behalf of one organization.
    organizationId: tenantColumn(),
  },
  (table) => [tenantIndex(table, "projects")]
);
