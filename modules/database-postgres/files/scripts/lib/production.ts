import { join } from "node:path";
import { databaseOf, hostOf } from "./url.ts";

// The checks and the order behind `pnpm db:prod:dump` and `pnpm db:prod:migrate` (see
// `../prod.ts`). Both run under `env-deploy --run api`, so DATABASE_URL is the production
// value from the value source and never the one in `apps/api/.env`.
//
// The production database is always named `<project>_production`, where `<project>` is
// the slug `databasePrefix` builds from the root `package.json` name. Every side effect
// reaches `runProduction` through `ProductionDeps`, so the tests run it with stand-ins and
// need no Docker, no pg_dump and no database.

export type Mode = "dump" | "migrate";

const USAGE = "Usage: prod.ts dump | prod.ts migrate";

/** The one argument `prod.ts` takes. */
export function readMode(argv: readonly string[]): Mode {
  const [mode, ...rest] = argv;
  if ((mode === "dump" || mode === "migrate") && rest.length === 0) {
    return mode;
  }
  throw new Error(USAGE);
}

/**
 * The production database's name, from the dev prefix `databasePrefix` gives:
 * `acme_shop_dev` becomes `acme_shop_production`.
 */
export function productionDatabaseName(devPrefix: string): string {
  return devPrefix.replace(/_dev$/, "_production");
}

/**
 * The folder dumps land in when `DB_DUMP_DIR` is unset: `~/<project>-backups`, outside the
 * repository, so `git clean` never deletes one and no commit ever carries one.
 */
export function defaultDumpDirectory(home: string, devPrefix: string): string {
  return join(home, `${devPrefix.replace(/_dev$/, "")}-backups`);
}

/**
 * Throw unless `url` names the production database on a server other than the dev one.
 *
 * `devUrl` is the DATABASE_URL in `apps/api/.env`, when there is one. A development server
 * often holds every branch's database, so a production URL pointing at it is a mistake
 * whatever database it names. No message carries the URL, which holds the password.
 */
export function assertProductionTarget(options: {
  url: string | undefined;
  devPrefix: string;
  devUrl?: string | undefined;
}): { url: string; database: string; host: string } {
  const { url, devPrefix, devUrl } = options;
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is empty. Run this through its pnpm script, which loads the production value with env-deploy --run api."
    );
  }
  let database: string;
  let host: string;
  try {
    database = databaseOf(url);
    host = hostOf(url);
  } catch {
    throw new Error("DATABASE_URL is not a postgres:// URL.");
  }
  const expected = productionDatabaseName(devPrefix);
  if (database !== expected) {
    throw new Error(
      `DATABASE_URL names ${database}, not ${expected}. These scripts act on the production database only.`
    );
  }
  if (devUrl) {
    let devHost: string | undefined;
    try {
      devHost = hostOf(devUrl);
    } catch {
      devHost = undefined;
    }
    if (devHost === host) {
      throw new Error(
        `DATABASE_URL points at ${host}, the development server apps/api/.env names. Production runs on its own server.`
      );
    }
  }
  return { url, database, host };
}

/** `acme_shop_production-20261022T154501Z.dump`: the database and the UTC time, sortable. */
export function dumpFileName(database: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${database}-${stamp}.dump`;
}

/**
 * The Postgres major version `compose.yaml` runs, so the Docker pg_dump matches the
 * server's. pg_dump refuses a server newer than itself.
 */
export function postgresMajor(compose: string): string {
  const match = /^\s*image:\s*["']?postgres:(\d+)/m.exec(compose);
  if (!match?.[1]) {
    throw new Error(
      "compose.yaml names no postgres:<major> image, so there is no pg_dump version to match. Set PG_DUMP=local to use the pg_dump on PATH."
    );
  }
  return match[1];
}

const PG_DUMP = 'exec pg_dump --format=custom "$DATABASE_URL"';

/** pg_dump's command line. The URL travels in the environment, never in argv. */
export function dumpCommand(options: { local: boolean; major: string }): {
  command: string;
  args: string[];
} {
  if (options.local) {
    return { command: "sh", args: ["-c", PG_DUMP] };
  }
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      "host",
      "-e",
      "DATABASE_URL",
      `postgres:${options.major}`,
      "sh",
      "-c",
      PG_DUMP,
    ],
  };
}

/** Everything `runProduction` reads or does outside its own memory. */
export interface ProductionDeps {
  /** DATABASE_URL as env-deploy set it. */
  url: string | undefined;
  /** `databasePrefix` of the root `package.json` name, such as `acme_shop_dev`. */
  devPrefix: string;
  /** DATABASE_URL in `apps/api/.env`, when the file has one. */
  devUrl: string | undefined;
  /** True for `PG_DUMP=local`. */
  local: boolean;
  /** The text of the root `compose.yaml`, or an empty string when there is none. */
  compose: string;
  dumpDirectory: string;
  now: () => Date;
  hasDocker: () => boolean;
  /** Create the dump folder, mode 0700. */
  makeDirectory: (directory: string) => void;
  /** Run pg_dump with `url` in its environment and its stdout in `file`. Answers the exit code. */
  dump: (
    command: string,
    args: string[],
    url: string,
    file: string
  ) => Promise<number>;
  fileSize: (file: string) => number;
  removeFile: (file: string) => void;
  /** Run `drizzle-kit migrate` against `url`, and report whether it passed. */
  migrate: (url: string) => boolean;
  say: (message: string) => void;
}

/**
 * Check the target, dump it, and for `migrate` apply the pending migrations. A failed or
 * empty dump throws before a migration starts, so a migration never runs without a fresh
 * backup beside it.
 */
export async function runProduction(
  mode: Mode,
  deps: ProductionDeps
): Promise<void> {
  const { url, database, host } = assertProductionTarget({
    url: deps.url,
    devPrefix: deps.devPrefix,
    devUrl: deps.devUrl,
  });
  deps.say(`Target: ${database} on ${host}.`);

  let command: { command: string; args: string[] };
  if (deps.local) {
    command = dumpCommand({ local: true, major: "" });
  } else {
    const major = postgresMajor(deps.compose);
    if (!deps.hasDocker()) {
      throw new Error(
        `No Docker daemon, so there is no pg_dump ${major} to run. Start one, or set PG_DUMP=local with pg_dump ${major} on PATH. Nothing was dumped or migrated.`
      );
    }
    command = dumpCommand({ local: false, major });
  }

  deps.makeDirectory(deps.dumpDirectory);
  const file = join(deps.dumpDirectory, dumpFileName(database, deps.now()));
  let code: number;
  try {
    code = await deps.dump(command.command, command.args, url, file);
  } catch (error) {
    deps.removeFile(file);
    throw error;
  }
  const size = deps.fileSize(file);
  if (code !== 0 || size === 0) {
    deps.removeFile(file);
    throw new Error(
      `pg_dump failed (exit ${String(code)}), so nothing was migrated.`
    );
  }
  deps.say(`Dumped ${database} to ${file} (${String(size)} bytes).`);
  if (mode === "dump") {
    return;
  }

  deps.say("Applying the pending migrations in packages/db/migrations/.");
  if (!deps.migrate(url)) {
    throw new Error(
      `drizzle-kit migrate failed. ${file} holds the database as it was before it started.`
    );
  }
  deps.say(`Migrated ${database}.`);
}
