import { spawnSync } from "node:child_process";
import { unstable_readConfig } from "wrangler";

// `pnpm db:prod:migrate`: apply every migration to the production D1 database, and create
// the database first when the account has none by that name.
//
// Nothing runs this on its own. `pnpm deploy:production --migrate` runs it once, before any
// Worker uploads, so a new migration lands before the code that reads it. A deploy without
// `--migrate` never migrates, and `turbo run deploy` does not run it (ADR 0048). On an
// empty account wrangler creates a missing D1 database only when it deploys the Worker,
// which is after this step, and `d1 migrations apply` then fails with "Couldn't find a D1
// DB named ...". So this script creates the database by its `database_name`, and the
// deploy that follows connects to it by name.
//
// It reads the Cloudflare credentials from its environment. The `db:prod:migrate` script
// runs it through `env-deploy --run deploy`, which loads them from the value source and
// keeps them in memory. A `database_id` in apps/api/wrangler.jsonc means the database
// exists, and only the migrations run.

const CONFIG = "../../apps/api/wrangler.jsonc";

function wrangler(
  args: string[],
  capture = false
): ReturnType<typeof spawnSync> {
  return spawnSync("wrangler", args, {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf-8",
  });
}

/** Say why, and answer with the exit code that says it failed. */
function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

function migrate(): number {
  const binding = unstable_readConfig({ config: CONFIG }).d1_databases.find(
    (database: { binding: string }) => database.binding === "DB"
  );
  if (binding === undefined) {
    return fail(`${CONFIG} has no d1_databases entry bound as DB.`);
  }

  if (!binding.database_id) {
    const name = binding.database_name;
    if (!name) {
      return fail(
        `The DB binding in ${CONFIG} has no database_name, so there is no database to look up.`
      );
    }
    const listed = wrangler(["d1", "list", "--json"], true);
    if (listed.status !== 0) {
      return fail(
        "wrangler d1 list failed, so the production database could not be found."
      );
    }
    const names = (JSON.parse(String(listed.stdout)) as { name: string }[]).map(
      (database) => database.name
    );
    if (!names.includes(name)) {
      process.stdout.write(`No D1 database named ${name} yet. Creating it.\n`);
      if (
        wrangler(["d1", "create", name, "--update-config=false"]).status !== 0
      ) {
        return fail(`wrangler d1 create ${name} failed.`);
      }
    }
  }

  return (
    wrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      CONFIG,
    ]).status ?? 1
  );
}

process.exitCode = migrate();
