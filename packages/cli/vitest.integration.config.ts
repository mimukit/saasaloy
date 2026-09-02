import { defineConfig } from "vitest/config";

// The suites that need something built or something enumerated off disk, kept out of the
// unit run in `vitest.config.ts`:
//
//   test/e2e/     spawns `dist/index.js` against a temp project — needs a build first
//   test/matrix/  derives every module pair from `modules/` — grows with the registry
//
// Both are slower than a unit test and neither should hold up `pnpm test`. They run as
// `pnpm test:e2e` and `pnpm test:matrix`; the workflows that schedule them belong to
// plan-ship-the-cli-2026-08-01.md.
export default defineConfig({
  test: {
    environment: "node",
    // Each e2e case spawns a subprocess, and one `init` copies the whole base template.
    hookTimeout: 120_000,
    include: ["test/**/*.test.ts"],
    // A temp project per file is fine; two files racing over one `dist/` build is not
    // worth the wall-clock saved.
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
