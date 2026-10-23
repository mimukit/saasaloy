import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { unstable_readConfig } from "wrangler";
import { defaultDumpDirectory, exportArgs, runDump } from "./lib/dump.ts";

// `pnpm db:prod:dump`: export the production D1 database, schema and data, as SQL into a
// new timestamped file.
//
// The `db:prod:dump` script runs this through `env-deploy --run deploy`, which loads the
// Cloudflare credentials from the value source and keeps them in memory. The file lands in
// `~/<project>-backups/` (or `DB_DUMP_DIR`), mode 0700, outside the repository: a dump
// holds production rows, so it must never sit where `git add .` or `git clean` reaches it.
//
// Restore one with `wrangler d1 execute <database_name> --remote --file <dump>`, or roll
// the database back in place with D1 Time Travel (`wrangler d1 time-travel restore`).
//
// `pnpm db:prod:migrate` (`./migrate-prod.ts`) imports `dumpProduction` and runs it before
// any migration, so the file runs a dump only as the entry point.

export const CONFIG = "../../apps/api/wrangler.jsonc";

function projectName(): string {
  try {
    const pkg = JSON.parse(readFileSync("../../package.json", "utf-8")) as {
      name?: string;
    };
    return pkg.name ?? "";
  } catch {
    return "";
  }
}

/** The `database_name` of the DB binding in apps/api/wrangler.jsonc. Throws when it has none. */
export function databaseName(): string {
  // The parameter type is spelled out: wrangler's published types leave it implicit
  // `any` under this tsconfig.
  const binding = unstable_readConfig({ config: CONFIG }).d1_databases.find(
    (entry: { binding: string; database_name?: string }) =>
      entry.binding === "DB"
  );
  const database = binding?.database_name;
  if (!database) {
    throw new Error(
      `${CONFIG} has no d1_databases entry bound as DB with a database_name, so there is no database to export.`
    );
  }
  return database;
}

/** Export `database` into a new file in the dump folder. Answers its path, or throws. */
export function dumpProduction(database: string): string {
  return runDump({
    database,
    dumpDirectory:
      process.env.DB_DUMP_DIR ?? defaultDumpDirectory(homedir(), projectName()),
    now: () => new Date(),
    makeDirectory: (directory) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    },
    exportTo: (file) =>
      spawnSync("wrangler", exportArgs(database, CONFIG, file), {
        stdio: "inherit",
      }).status ?? 1,
    fileSize: (file) => (existsSync(file) ? statSync(file).size : 0),
    removeFile: (file) => {
      rmSync(file, { force: true });
    },
    say: (message) => {
      process.stdout.write(`${message}\n`);
    },
  });
}

if (import.meta.main) {
  try {
    dumpProduction(databaseName());
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
