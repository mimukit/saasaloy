import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { migrationFiles } from "./lib/migrations.ts";

// `pnpm db:setup`: apply every migration to the local D1 database. On this driver the
// command is a thin wrapper, and that is the whole design.
//
// D1's local database is a SQLite file under `apps/api/.wrangler/state`, which is
// gitignored and therefore already one per worktree. There is nothing to create, no server
// to reach and no branch to name, so the three lifecycle commands carry no backend flag and
// no state block. The Postgres driver needs all three; see its scripts/ folder.

// A project with no table yet has no migration, and wrangler fails on a missing folder.
// That is a fresh project, not an error, so setup says so and exits 0.
const MIGRATIONS = resolve(import.meta.dirname, "../migrations");

if (migrationFiles(MIGRATIONS).length === 0) {
  process.stdout.write(
    "No migration exists yet, so there is nothing to apply.\n" +
      "Add a table under packages/db/src/schema/, run pnpm --filter @repo/db db:generate, then run pnpm db:setup again.\n"
  );
} else {
  const result = spawnSync("pnpm", ["run", "db:migrate:local"], {
    stdio: "inherit",
  });
  if (result.status === 0) {
    process.stdout.write(
      "Local D1 database is migrated. It lives in apps/api/.wrangler/state, which git ignores.\n" +
        // Setup never writes rows, so the database holds what the developer last put in it.
        "Run pnpm db:seed to fill it with the rows in packages/db/src/seed/slices/.\n"
    );
  } else {
    process.stderr.write(
      "db:migrate:local failed. Fix the cause, then run pnpm db:setup again.\n"
    );
    process.exitCode = 1;
  }
}
