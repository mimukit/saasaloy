import { withDb } from "@repo/db/client";
import type { DbBindings } from "@repo/db/client";
import type { LoggerVariables } from "@repo/logger";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { declare } from "../contract";

// `GET /health/db`: one `select 1` through this request's database client. A 200 means the
// Worker reached its database with the credentials it holds now. `pnpm deploy:production`
// asks it after every deploy, as a smoke check the database module adds to
// `packages/tooling/src/targets.ts`.
//
// It is separate from `GET /health`, which the api module owns and which proves only that
// the Worker answers. The database module mounts this file at `/health/db` with an
// `api.routes` row, so `get("/")` serves `GET /health/db`.
//
// `withDb` is the call shape the driver exports, and the query goes through Drizzle's
// builder: `select 1 from (select 1) as health_db`. Drizzle's builder has no `select`
// without a `from`, so the subquery gives it one.
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
}>().get(
  "/",
  declare({
    name: "health_db_read",
    description: "Answers ok when the api reaches its database.",
    agent: { callable: false, reason: "A deploy probe, not a product action." },
  }),
  async (c) => {
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
  }
);
