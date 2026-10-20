import { existsSync } from "node:fs";
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

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The template's state. `persist.path` takes the `v3` folder itself. */
const TEST_STATE = resolve(ROOT, "apps/api/.wrangler/test-state");

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
  project.provide(
    "testWranglerConfig",
    resolve(ROOT, "apps/api/wrangler.jsonc")
  );
}
