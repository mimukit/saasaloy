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
// - `base-ui`: the tests for the base template's `packages/ui/src/lib` date modules. Every
//   template file ships to projects, so these tests stay in this repo, in `test/base-ui/`,
//   and import the template source by relative path. The source imports its neighbours as
//   `@repo/ui/<layer>/<name>`, which nothing links here either, so the alias below points
//   each one at the template's `packages/ui/src/<layer>/<name>.ts`.
// - `web`: the base template's `apps/web` tests: the sitemap page list, and the guard that
//   every primitive the site renders has an `@source` line. They import only Vitest, Node
//   and the files beside them, and the guard reads the template's files by path.
// - `module-files`: a module's shipped Vitest tests outside the database drivers, stored as
//   `*.vitest.ts` for the same reason as `db-scripts`, and importing only Vitest and Node.
//
// The root `test:base` script runs the template's `node:test` files and skips
// `packages/tooling` and `packages/config`, so each file runs on the one runner it imports.
const base = fileURLToPath(new URL("templates/base/", import.meta.url));
const modules = fileURLToPath(new URL("../../modules/", import.meta.url));
const baseUi = fileURLToPath(new URL("test/base-ui", import.meta.url));

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
        root: `${base}apps/web`,
        oxc: { tsconfig: false },
        test: {
          name: "web",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        root: modules,
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
          name: "module-files",
          environment: "node",
          include: ["storage-cloudflare/files/**/*.vitest.ts"],
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
      {
        root: baseUi,
        oxc: { tsconfig: false },
        resolve: {
          alias: [
            {
              find: /^@repo\/ui\/(.*)$/,
              replacement: `${base}packages/ui/src/$1.ts`,
            },
          ],
        },
        test: {
          name: "base-ui",
          environment: "node",
          include: ["**/*.test.ts"],
        },
      },
    ],
  },
});
