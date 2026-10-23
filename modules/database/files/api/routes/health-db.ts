import { withDb } from "@repo/db/client";
import type { DbBindings } from "@repo/db/client";
import type { LoggerVariables } from "@repo/logger";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

// `GET /health/db`: one `select 1` through this request's database client. A 200 means the
// Worker reached its database with the credentials it holds now. `pnpm deploy:production`
// asks it after every deploy, as a smoke check the database module adds to
// `packages/tooling/src/targets.ts`.
//
// It is separate from `GET /health`, which the api module owns and which proves only that
// the Worker answers. The database module mounts this file at `/health/db` with a
// `chained-route` patch, so `get("/")` serves `GET /health/db`.
//
// One file serves both drivers. `withDb` is the call shape `database-d1` and
// `database-postgres` both export, and the query goes through Drizzle's builder, which is
// the same under either: `select 1 from (select 1) as health_db`. Drizzle's builder has no
// `select` without a `from`, and the two drivers name their raw-SQL call differently
// (`run` on D1, `execute` on Postgres), so the subquery is what keeps the file single.
//
// A failure answers 503 with a fixed message. The driver's error can carry a host, a user
// name or a query, so it goes to the request's logger and never into the body.
//
// No rate limit. The query costs about what a 404 costs. A project that wants one puts a
// WAF rate-limiting rule on the path; see the `saasaloy-database` skill.

const UNAVAILABLE = "The api could not reach its database.";

export const healthDb = new Hono<{
  Bindings: DbBindings;
  Variables: LoggerVariables;
}>().get("/", async (c) => {
  try {
    await withDb(c, async (db) => {
      await db
        .select({ ok: sql<number>`1` })
        .from(sql`(select 1) as health_db`);
    });
  } catch (error) {
    c.get("log").error("database health check failed", { err: error });
    return c.json(
      { error: { code: "database_unavailable", message: UNAVAILABLE } },
      503
    );
  }
  return c.json({ status: "ok" }, 200);
});
