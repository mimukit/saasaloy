import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rimraf } from "rimraf";
import type { TestProject } from "vitest/node";
import { openLocalD1, refuseTarget, writeSeed } from "./lib/seed.ts";

// The Vitest global setup for route tests on D1. `apps/api/test/setup/database.ts`
// re-exports `setup`, and Vitest runs it once before the first test file.
//
// It builds a template database under `apps/api/.wrangler/test-state`, apart from the
// development one in `apps/api/.wrangler/state`, so a test run never touches the rows a
// developer works with:
//
// 1. Delete the previous template, so every run starts from the current migrations.
// 2. Apply every migration.
// 3. Run the seed, which also proves the slices still fit the schema.
//
// Each test file then copies the template and opens its own local D1 on the copy, through
// `testDatabase()` in `src/testing.ts`. D1 has no transaction a test could hold open and
// roll back, so the copy is reset to the seed before every test instead.
//
// A test file opens its copy through `test-state/wrangler.json`, which this setup writes:
// the api's `d1_databases` and nothing else. The api's own `wrangler.jsonc` also declares
// the KV namespace, the R2 bucket, the queues and the rate limiters other modules patch in,
// and wrangler starts every one of them for each file, then watches the shared dev registry
// for the queues. No test reads them. Under a loaded CI runner that start-up made a test
// file's `beforeAll` pass 10 seconds (issue #358).

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The template's state. `persist.path` takes the `v3` folder itself. */
const TEST_STATE = resolve(ROOT, "apps/api/.wrangler/test-state");

/** The api's wrangler config, the one `vite dev` and `wrangler deploy` read. */
const API_CONFIG = resolve(ROOT, "apps/api/wrangler.jsonc");

async function migrate(d1: D1Database): Promise<void> {
  const migrations = resolve(ROOT, "packages/db/migrations");
  if (!existsSync(resolve(migrations, "meta/_journal.json"))) {
    return;
  }
  const { drizzle } = await import("drizzle-orm/d1");
  const { migrate: apply } = await import("drizzle-orm/d1/migrator");
  await apply(drizzle(d1), { migrationsFolder: migrations });
}

export async function setup(project: TestProject): Promise<void> {
  refuseTarget([], process.env);
  await rimraf(TEST_STATE);

  const state = resolve(TEST_STATE, "v3");
  const { d1, dispose } = await openLocalD1(ROOT, state);
  try {
    await migrate(d1);
    await writeSeed(d1, await import("../src/seed/index.ts"));
  } finally {
    await dispose();
  }

  project.provide("testD1State", state);
  project.provide("testWranglerConfig", await writeTestConfig());
}

/** The fields of a `d1_databases` entry that name its database. */
interface D1Binding {
  binding: string;
  database_name?: string;
  database_id?: string;
  preview_database_id?: string;
}

/**
 * Write a wrangler config that holds only the api's D1 bindings, and answer its path. Each
 * binding keeps its `database_name` and ids, which name the database file in the state
 * folder, so a copy of the template opens the same rows. The `-test` suffix keeps a test
 * file out of the dev registry entry a running `pnpm dev` holds for the api.
 */
async function writeTestConfig(): Promise<string> {
  const { unstable_readConfig } = await import("wrangler");
  const api = unstable_readConfig({ config: API_CONFIG });
  const file = resolve(TEST_STATE, "wrangler.json");
  const config = {
    name: `${api.name ?? "api"}-test`,
    compatibility_date: api.compatibility_date,
    d1_databases: api.d1_databases.map((database: D1Binding) => ({
      binding: database.binding,
      database_name: database.database_name,
      database_id: database.database_id,
      preview_database_id: database.preview_database_id,
    })),
  };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}
