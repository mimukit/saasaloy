import { spawnSync } from "node:child_process";
import { unstable_readConfig } from "wrangler";
import { runMigrate } from "./lib/dump.ts";
import { CONFIG, databaseName, dumpProduction } from "./prod-dump.ts";

// `pnpm db:prod:migrate`: dump the production D1 database, then apply every migration to
// it, and create the database first when the account has none by that name.
//
// Nothing runs this on its own. `pnpm deploy:production --migrate` runs it once, before any
// Worker uploads, so a new migration lands before the code that reads it. A deploy without
// `--migrate` never migrates, and `turbo run deploy` does not run it (ADR 0048).
//
// The dump is the same one `pnpm db:prod:dump` takes (`./prod-dump.ts`): a new file in
// `~/<project>-backups/` (or `DB_DUMP_DIR`). A failed or empty dump stops the run before a
// migration starts. A database this run creates holds nothing, so it gets no dump.
//
// On an empty account wrangler creates a missing D1 database only when it deploys the
// Worker, which is after this step, and `d1 migrations apply` then fails with "Couldn't
// find a D1 DB named ...". So this script creates the database by its `database_name`, and
// the deploy that follows connects to it by name. A `database_id` in
// apps/api/wrangler.jsonc means the database exists.
//
// It reads the Cloudflare credentials from its environment. The `db:prod:migrate` script
// runs it through `env-deploy --run deploy`, which loads them from the value source and
// keeps them in memory.

function wrangler(
  args: string[],
  capture = false
): ReturnType<typeof spawnSync> {
  return spawnSync("wrangler", args, {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf-8",
  });
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Find the production database, or create it. Answers `created` when this call made it. */
function ensureDatabase(): "existing" | "created" {
  const binding = unstable_readConfig({ config: CONFIG }).d1_databases.find(
    (database: { binding: string }) => database.binding === "DB"
  );
  if (binding === undefined) {
    throw new Error(`${CONFIG} has no d1_databases entry bound as DB.`);
  }
  if (binding.database_id) {
    return "existing";
  }
  const name = binding.database_name;
  if (!name) {
    throw new Error(
      `The DB binding in ${CONFIG} has no database_name, so there is no database to look up.`
    );
  }
  const listed = wrangler(["d1", "list", "--json"], true);
  if (listed.status !== 0) {
    throw new Error(
      "wrangler d1 list failed, so the production database could not be found."
    );
  }
  const names = (JSON.parse(String(listed.stdout)) as { name: string }[]).map(
    (database) => database.name
  );
  if (names.includes(name)) {
    return "existing";
  }
  say(`No D1 database named ${name} yet. Creating it.`);
  if (wrangler(["d1", "create", name, "--update-config=false"]).status !== 0) {
    throw new Error(`wrangler d1 create ${name} failed.`);
  }
  return "created";
}

try {
  runMigrate({
    ensureDatabase,
    // A config with no database_name throws inside the step, so it stops the run as a
    // failed dump, before any migration.
    dump: () => dumpProduction(databaseName()),
    migrate: () =>
      wrangler([
        "d1",
        "migrations",
        "apply",
        "DB",
        "--remote",
        "--config",
        CONFIG,
      ]).status ?? 1,
    say,
  });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
