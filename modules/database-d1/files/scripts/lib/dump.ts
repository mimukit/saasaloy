import { join } from "node:path";

// The order behind `pnpm db:prod:dump` (see `../prod-dump.ts`): export the production D1
// database with `wrangler d1 export --remote` into a new timestamped file, and refuse a
// failed or empty export. `pnpm db:prod:migrate` (see `../migrate-prod.ts`) runs the same
// dump first and applies no migration without it. Every side effect reaches `runDump` and
// `runMigrate` through their deps, so the tests run them with stand-ins and need no
// Cloudflare account.

/**
 * The root `package.json` name as a folder name: `@acme/shop` becomes `acme_shop`. A name
 * that slugifies to nothing falls back to `app`.
 */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return slug || "app";
}

/**
 * The folder dumps land in when `DB_DUMP_DIR` is unset: `~/<project>-backups`, outside the
 * repository, so `git clean` never deletes one and no commit ever carries one.
 */
export function defaultDumpDirectory(
  home: string,
  projectName: string
): string {
  return join(home, `${projectSlug(projectName)}-backups`);
}

/** `app-db-20261022T154501Z.sql`: the database and the UTC time, sortable. */
export function dumpFileName(database: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${database}-${stamp}.sql`;
}

/** wrangler's arguments: the remote database, schema and data, as SQL in `file`. */
export function exportArgs(
  database: string,
  config: string,
  file: string
): string[] {
  return [
    "d1",
    "export",
    database,
    "--remote",
    "--config",
    config,
    "--output",
    file,
  ];
}

/** Everything `runDump` reads or does outside its own memory. */
export interface DumpDeps {
  /** The `database_name` of the DB binding in `apps/api/wrangler.jsonc`. */
  database: string;
  dumpDirectory: string;
  now: () => Date;
  /** Create the dump folder, mode 0700. */
  makeDirectory: (directory: string) => void;
  /** Run `wrangler d1 export` into `file`. Answers the exit code. */
  exportTo: (file: string) => number;
  fileSize: (file: string) => number;
  removeFile: (file: string) => void;
  say: (message: string) => void;
}

/** Export the database and answer with the file's path. Throws on a failed or empty export. */
export function runDump(deps: DumpDeps): string {
  deps.makeDirectory(deps.dumpDirectory);
  const file = join(
    deps.dumpDirectory,
    dumpFileName(deps.database, deps.now())
  );
  const code = deps.exportTo(file);
  const size = deps.fileSize(file);
  if (code !== 0 || size === 0) {
    deps.removeFile(file);
    throw new Error(
      `wrangler d1 export failed (exit ${String(code)}), so there is no dump of ${deps.database}.`
    );
  }
  deps.say(`Dumped ${deps.database} to ${file} (${String(size)} bytes).`);
  return file;
}

/** Everything `runMigrate` reads or does outside its own memory. */
export interface MigrateDeps {
  /**
   * Make sure the production database exists. Answers `created` when this call made it,
   * so it holds nothing yet. Throws when it can neither find nor create it.
   */
  ensureDatabase: () => "existing" | "created";
  /** `runDump` with its own deps. Answers the dump's path, or throws. */
  dump: () => string;
  /** Run `wrangler d1 migrations apply --remote`. Answers the exit code. */
  migrate: () => number;
  say: (message: string) => void;
}

/**
 * Dump the production database, then apply the pending migrations. A failed or empty dump
 * throws before a migration starts, so a migration never runs without a fresh backup
 * beside it. A database this run created holds no rows, so it has nothing to dump.
 */
export function runMigrate(deps: MigrateDeps): void {
  const state = deps.ensureDatabase();
  let file: string | undefined;
  if (state === "created") {
    deps.say("The database is new, so there is nothing to dump.");
  } else {
    try {
      file = deps.dump();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} Nothing was migrated.`, { cause: error });
    }
  }
  deps.say("Applying the pending migrations in packages/db/migrations/.");
  const code = deps.migrate();
  if (code !== 0) {
    const backup =
      file === undefined
        ? "The database was new, so no dump was taken."
        : `${file} holds the database as it was before it started.`;
    throw new Error(
      `wrangler d1 migrations apply failed (exit ${String(code)}). ${backup}`
    );
  }
  deps.say("Migrated the production database.");
}
