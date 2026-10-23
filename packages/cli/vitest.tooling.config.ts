import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs, from the saasaloy repo, the Vitest tests that ship as project files but cannot run
// on `node --test`:
//
// - `tooling`: the base template's `packages/tooling` tests. In a generated project the
//   root `vitest.config.ts` collects them as the `packages/tooling` project and pnpm links
//   `@repo/env` as a workspace. Here the template is not a workspace, so nothing links it,
//   and the alias below points each `@repo/env/<name>` subpath at the template's
//   `packages/env/src/<name>.ts`, which is the same file its exports map names.
// - `config`: the base template's `packages/config` merge tests. In a generated project the
//   root `vitest.config.ts` collects them as the `packages/config` project. They import
//   only Vitest and the file beside them.
// - `db-scripts`: the database drivers' production script tests. They are stored as
//   `*.vitest.ts`, so `pnpm test:modules` (`node --test` over `*.test.ts`) skips them, and
//   the descriptor ships them as `*.test.ts`. They import only Vitest and the files beside
//   them.
//
// The root `test:base` script runs the template's `node:test` files and skips
// `packages/tooling` and `packages/config`, so each file runs on the one runner it imports.
const base = fileURLToPath(new URL("templates/base/", import.meta.url));
const modules = fileURLToPath(new URL("../../modules/", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        root: `${base}packages/tooling`,
        // The template's tsconfig extends `@repo/tsconfig`, which nothing links here
        // either. The transform needs nothing from it to strip types, so it skips the
        // lookup.
        oxc: { tsconfig: false },
        resolve: {
          alias: [
            {
              find: /^@repo\/env\/(.*)$/,
              replacement: `${base}packages/env/src/$1.ts`,
            },
          ],
        },
        test: {
          name: "tooling",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        root: `${base}packages/config`,
        oxc: { tsconfig: false },
        test: {
          name: "config",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        root: modules,
        oxc: { tsconfig: false },
        test: {
          name: "db-scripts",
          environment: "node",
          include: ["database-*/files/scripts/**/*.vitest.ts"],
        },
      },
    ],
  },
});
