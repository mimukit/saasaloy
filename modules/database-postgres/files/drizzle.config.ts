import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit config for the Postgres driver — used by BOTH `db:generate` (emit SQL under
// ./migrations) and `db:migrate` (apply it). `dialect` is `postgresql` to match table files
// written against `drizzle-orm/pg-core`. Migrations stay fully manual: there is no
// `drizzle-kit push` script and nothing migrates on boot.
//
// The `schema` glob is drizzle-kit's OWN native glob (resolved with esbuild under Node),
// the migration-time twin of the runtime barrel in src/schema.ts. Dropping a
// `src/schema/<name>.ts` table file feeds both with no edit here. It deliberately does NOT
// include the barrel (src/schema.ts sits outside src/schema/), because the barrel uses
// Vite's `import.meta.glob`, which esbuild can't execute.

// drizzle-kit runs under plain Node, where Workers bindings and `.dev.vars` mean nothing,
// so the connection has to come from `process.env`. An explicit `DATABASE_URL` in the
// environment always wins; otherwise fall back to the same `apps/api/.dev.vars` the local
// Worker reads, so one file holds the local URL for both. Paths resolve from `process.cwd()`
// (packages/db, where the script runs), matching `out` below.
const devVars = resolve(process.cwd(), "../../apps/api/.dev.vars");
if (!process.env.DATABASE_URL && existsSync(devVars)) {
  process.loadEnvFile(devVars);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  // `db:generate` never opens a connection and ignores this; `db:migrate` needs it. An
  // empty string here means neither the environment nor `.dev.vars` supplied a URL, and
  // drizzle-kit reports that when it tries to connect.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
