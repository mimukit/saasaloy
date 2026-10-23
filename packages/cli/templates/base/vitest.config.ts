import { defineConfig } from "vitest/config";

// The one Vitest run for the whole repo: `pnpm test` runs it after `turbo run test`.
//
// Every workspace under apps/ and packages/ is a project. A workspace with a
// `vitest.config.ts` of its own uses it, so a module that needs a setup step (the
// database drivers' route test harness in `apps/api`) ships that file and nothing here
// changes. A workspace without one runs with Vitest's defaults.
//
// `packages/env` is left out on purpose. Its tests run on `node:test`, through its own
// `test` script, because the base shipped no test runner when they were written. Vitest
// would collect those files and fail each one with "No test suite found".
//
// `packages/e2e` is left out too, once `saasaloy add e2e` writes it. It holds Playwright
// specs, named `*.spec.ts`, which Vitest's default glob also matches. Playwright runs them
// through `pnpm e2e`, against the running apps.
//
// `passWithNoTests` keeps a fresh project green: the base ships no Vitest test, and a
// run that finds none would otherwise exit 1.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ["apps/*", "packages/*", "!packages/env", "!packages/e2e"],
  },
});
