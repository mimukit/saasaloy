import { spawnSync } from "node:child_process";

// `pnpm db:setup`: apply every migration to the local D1 database. On this driver the
// command is a thin wrapper, and that is the whole design.
//
// D1's local database is a SQLite file under `apps/api/.wrangler/state`, which is
// gitignored and therefore already one per worktree. There is nothing to create, no server
// to reach and no branch to name, so the three lifecycle commands carry no backend flag and
// no state block. The Postgres driver needs all three; see its scripts/ folder.

const result = spawnSync("pnpm", ["run", "db:migrate:local"], {
  stdio: "inherit",
});
if (result.status === 0) {
  process.stdout.write(
    "Local D1 database is migrated. It lives in apps/api/.wrangler/state, which git ignores.\n"
  );
} else {
  process.stderr.write(
    "db:migrate:local failed. Fix the cause, then run pnpm db:setup again.\n"
  );
  process.exitCode = 1;
}
