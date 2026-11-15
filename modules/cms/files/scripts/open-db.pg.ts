import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "../../db/src/client";

// The Postgres half of `cms:rerender`'s database handle, selected by
// `onlyWith: "database-postgres"`. Its D1 twin is `open-db.d1.ts`; exactly one lands as
// `scripts/open-db.ts`.
//
// It connects to `DATABASE_URL`, which the package script loads from `apps/api/.env`: the
// branch database `pnpm db:setup` made for this checkout.

export async function openDb(_root: string) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is not set. Run pnpm db:setup, which writes it to apps/api/.env."
    );
  }
  const sql = postgres(url, { max: 1 });
  return {
    // The repository uses only the query builder, never the relational API, so a client
    // built without the schema barrel serves it.
    db: drizzle(sql) as unknown as Db,
    dispose: () => sql.end({ timeout: 5 }),
    target: new URL(url).pathname.slice(1) || "the database",
  };
}
