import { defineConfig } from "vitest/config";

// The project's unit runner. One vitest, pinned once in the root `devDependencies`, and
// one config here. `pnpm test` runs it from the repo root.
//
// `projects` is a glob, not a list, so a workspace `saasaloy add` drops in is picked up
// with no edit here. A workspace with no test file contributes nothing and costs nothing.
//
// `vitest` is a ROOT devDependency and every workspace resolves it by walking up to the
// root `node_modules`, so a test file writes `import { expect, test } from "vitest"` in
// any workspace without that workspace pinning its own copy. Keep it that way: a second
// pin is a second version to keep in step for no gain.
//
// `packages/e2e` is excluded on purpose. That workspace belongs to Playwright, whose
// `*.spec.ts` files call a `test` from `@playwright/test`. Collecting one here would
// start a browser inside the unit run. The two runners never see each other's files.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "!packages/e2e"],
  },
});
