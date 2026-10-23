import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs the base template's `packages/tooling` tests, which are Vitest tests, from the
// saasaloy repo. In a generated project the root `vitest.config.ts` collects them as
// the `packages/tooling` project and pnpm links `@repo/env` as a workspace. Here the
// template is not a workspace, so nothing links it, and the alias below points each
// `@repo/env/<name>` subpath at the template's `packages/env/src/<name>.ts`, which is
// the same file its exports map names.
//
// The root `test:base` script runs the template's `node:test` files and skips
// `packages/tooling`, so each file runs on the one runner it imports.
const base = fileURLToPath(new URL("templates/base/", import.meta.url));

export default defineConfig({
  root: `${base}packages/tooling`,
  // The template's tsconfig extends `@repo/tsconfig`, which nothing links here either.
  // The transform needs nothing from it to strip types, so it skips the lookup.
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
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
