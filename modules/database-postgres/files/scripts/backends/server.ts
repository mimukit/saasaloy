import { assertManagedDatabase } from "../lib/branch-name.ts";
import { API_ENV, withSql } from "../lib/context.ts";
import { swapDatabase } from "../lib/url.ts";

// The `server` backend, `pnpm db:setup --server`: a database on the Postgres server the
// `DATABASE_URL` in `apps/api/.dev.vars` already names. A shared development box, a VPS on
// a tailnet and a managed instance are all one case, because all three give a host, a role
// and a password, and nothing else here differs.
//
// The role needs `CREATEDB`. Every call connects to the maintenance database rather than to
// the project's own, so a server holding no database of this project still answers.

export const SERVER_UNREACHABLE =
  "Cannot reach the Postgres server. Check that it is up, that DATABASE_URL names the right host, and that any VPN or tunnel it needs is connected.";

/** Every Postgres server has it, so these calls never depend on the project's database existing. */
export const MAINTENANCE_DATABASE = "postgres";

/** The server and role of `url`, pointed at `postgres`. Every server call connects with it. */
export function adminUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      `${API_ENV} has no DATABASE_URL, so there is no server to create a database on. Set it to a connection string with CREATEDB rights, or run pnpm db:setup --docker.`
    );
  }
  return swapDatabase(url, MAINTENANCE_DATABASE);
}

export async function databaseExists(
  admin: string,
  database: string
): Promise<boolean> {
  const rows = await withSql(
    admin,
    SERVER_UNREACHABLE,
    async (sql) => sql`select 1 from pg_database where datname = ${database}`
  );
  return rows.length > 0;
}

/** Create the database unless it already exists. */
export async function createDatabase(
  prefix: string,
  admin: string,
  database: string
): Promise<void> {
  assertManagedDatabase(prefix, database);
  await withSql(admin, SERVER_UNREACHABLE, async (sql) => {
    const rows =
      await sql`select 1 from pg_database where datname = ${database}`;
    if (rows.length === 0) {
      // The name passed `assertManagedDatabase`, so it is `[a-z0-9_]` only and safe to quote.
      await sql.unsafe(`CREATE DATABASE "${database}"`);
    }
  });
}

/** Drop a database this project manages, closing any session still on it. */
export async function dropDatabase(
  prefix: string,
  admin: string,
  database: string
): Promise<void> {
  assertManagedDatabase(prefix, database);
  await withSql(admin, SERVER_UNREACHABLE, async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  });
}
