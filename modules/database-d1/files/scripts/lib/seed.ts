import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type * as SeedModule from "../../src/seed/index.ts";

// What `db:seed` and the route test harness share on D1: the guard, the local D1 opener,
// the loader for the seed entry, and the one batch that writes the whole plan.

/** The seed entry's exports: `packages/db/src/seed/index.ts`. */
export type SeedEntry = typeof SeedModule;

export interface SeedResult {
  counts: { table: string; rows: number }[];
  messages: string[];
}

/** The local state `vite dev` and `db:migrate:local` share. `persist.path` takes the `v3` folder itself. */
export const DEV_STATE = "apps/api/.wrangler/state/v3";

/** How often a batch that met `SQLITE_BUSY` is sent again, and the first wait. */
const BUSY_RETRIES = 3;
const BUSY_BACKOFF_MS = 250;

/**
 * Refuse `--remote`, any other flag, and `NODE_ENV=production`, before anything opens.
 * The seed writes example rows, and only to the local database under `apps/api/.wrangler`.
 */
export function refuseTarget(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. db:seed writes example rows, and only to the local D1 database."
    );
  }
  if (argv.includes("--remote")) {
    throw new Error(
      "Refusing to seed a remote D1 database. db:seed only writes to the local one under apps/api/.wrangler/state."
    );
  }
  const [flag] = argv;
  if (flag !== undefined) {
    throw new Error(`Unknown flag ${flag}. This command takes no flags.`);
  }
}

/** The repo root, two levels above `packages/db`, where every db script runs. */
export function repoRoot(): string {
  return resolve(process.cwd(), "../..");
}

/**
 * Open the local D1 database whose state lives in `persistPath` (a `v3` folder), through the
 * same `wrangler.jsonc` the api uses. `remoteBindings: false`, because wrangler otherwise
 * connects any binding marked remote, and a seed must never reach Cloudflare.
 */
export async function openLocalD1(root: string, persistPath: string) {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve(root, "apps/api/wrangler.jsonc"),
    persist: { path: persistPath },
    remoteBindings: false,
  });
  return { d1: proxy.env.DB, dispose: () => proxy.dispose() };
}

/**
 * Load the seed entry. It uses Vite's `import.meta.glob`, so plain Node cannot import it;
 * `runnerImport` runs it through Vite with no config file and loads `drizzle-orm` natively.
 */
export async function loadSeedEntry(root: string): Promise<SeedEntry> {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport<SeedEntry>(
    resolve(root, "packages/db/src/seed/index.ts"),
    { logLevel: "error", root: resolve(root, "packages/db") }
  );
  return module;
}

function isBusy(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String(error.cause)}`
      : String(error);
  return /SQLITE_BUSY|database is locked/i.test(text);
}

/**
 * Write the whole plan as one `db.batch`, which D1 runs atomically: every row lands or none
 * does.
 *
 * Local D1 runs in WAL mode, so a seed beside an idle `pnpm dev` goes through. A request
 * that writes at the same moment fails the batch with `SQLITE_BUSY`, and nothing is
 * written; the batch is sent again up to three times, waiting longer each time.
 */
export async function writeSeed(
  d1: D1Database,
  entry: SeedEntry
): Promise<SeedResult> {
  const plan = entry.seedPlan();
  const { drizzle } = await import("drizzle-orm/d1");
  const db = drizzle(d1);
  // `statementsFor` serves both drivers, so it returns `unknown[]`; these are D1 inserts.
  const statements = entry.statementsFor(db, plan) as unknown as Parameters<
    typeof db.batch
  >[0];

  if (statements.length > 0) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await db.batch(statements);
        break;
      } catch (error) {
        if (!isBusy(error) || attempt >= BUSY_RETRIES) {
          throw isBusy(error)
            ? new Error(
                "The local D1 database stayed busy, so nothing was written. Stop the api (pnpm dev), or run pnpm db:seed again.",
                { cause: error }
              )
            : error;
        }
        await sleep(BUSY_BACKOFF_MS * 2 ** attempt);
      }
    }
  }
  return { counts: entry.countsFor(plan), messages: entry.messagesFor(plan) };
}
