import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// This file holds the waitlist table. It lands as `packages/db/src/schema/waitlist.ts`.
// The route, the repositories and the validators are written against it.
//
// Parity here is semantic, not textual. Each column is the idiomatic form for its dialect,
// and what has to match is the shape a row comes back in: an integer key, a unique email,
// and a millisecond-resolution creation time.
export const waitlistEntries = pgTable("waitlist_entries", {
  // `timestamptz`, so the stored instant carries no ambiguity about the server's zone, and
  // `defaultNow()` so the database clock stamps a row the route did not stamp. Postgres
  // keeps microseconds.
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  email: text("email").notNull().unique(),
  // An identity column, not `serial`. `serial` is the legacy spelling: it creates a sequence
  // the table only loosely owns, and it leaves the column writable, so an insert can hand it
  // a value and desynchronise the sequence. `GENERATED ALWAYS AS IDENTITY` is the SQL
  // standard form and refuses that write outright.
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
});
