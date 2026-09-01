import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The SQLite half of the waitlist table, selected by `onlyWith: "database-d1"`. Its pg twin
// sits beside it as `waitlist.pg.ts`, and exactly one of the two lands as
// `packages/db/src/schema/waitlist.ts`. Change one and change the other: they are the same
// table, and the route, the repositories and the validators are written against both.
//
// The table declarations are the only part of this module that knows the dialect. Drizzle's
// query builder is neutral at call time, so `files/api/routes/waitlist.ts` is one file.
export const waitlist = sqliteTable("waitlist", {
  // `timestamp_ms`, not `timestamp`. Drizzle's `timestamp` mode stores whole seconds, so two
  // signups inside the same second sort arbitrarily and a `Date` loses its milliseconds on
  // the round trip. Postgres `timestamptz` keeps sub-second precision natively, and storing
  // milliseconds here is what makes the two dialects agree.
  //
  // `unixepoch('subsecond')` returns a float, and a float that lands in an INTEGER column
  // keeps REAL affinity unless it is exact, so the CAST is not decoration. It needs SQLite
  // 3.42 or newer, which D1 is.
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(CAST(unixepoch('subsecond') * 1000 AS INTEGER))`),
  email: text("email").notNull().unique(),
  id: integer("id").primaryKey({ autoIncrement: true }),
});
