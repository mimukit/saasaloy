import { defineConfig } from "vitest/config";

// `fsModuleCache` is off because `src/schema.ts` and `src/seed/index.ts` expand an
// `import.meta.glob`. Vitest keys its on-disk transform cache on the importing file's own
// content, so a new file under `src/schema/` or `src/seed/slices/` leaves the cached
// expansion stale and the completeness test checks the old list. The root config cannot
// turn it off for a project: Vitest passes only CLI options down to projects.
export default defineConfig({
  test: { fsModuleCache: false },
});
