// Prepares the test database once before the first test file: a migrated, seeded local D1
// under `apps/api/.wrangler/test-state`, which each test file copies. `../../vitest.config.ts`
// runs every file in this folder as a Vitest global setup. Written by `database-d1`; see its
// skill, "Route tests".
export { setup } from "@repo/db/test-setup";
