// Prepares the test database once before the first test file: creates `<database>_test`
// (this checkout's development database plus `_test`) when it is missing, migrates it and
// seeds it. `../../vitest.config.ts` runs every file in this folder as a Vitest global
// setup. Written by `database-postgres`; see its skill, "Route tests".
export { setup } from "@repo/db/test-setup";
