import { defineConfig } from "vitest/config";

// `fsModuleCache` is off because `src/schema.ts`, `src/seed/index.ts` and
// `src/column-classes.ts` expand an `import.meta.glob`. Vitest keys its on-disk transform
// cache on the importing file's own content, so a new file under `src/schema/`,
// `src/seed/slices/` or `src/column-classes/` leaves the cached expansion stale and the
// completeness and class tests check the old list. The root config cannot turn it off for
// a project: Vitest passes only CLI options down to projects.
export default defineConfig({
  test: { fsModuleCache: false },
});
