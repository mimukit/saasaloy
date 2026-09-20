import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The base template's own unit tests, run from this repo as `pnpm test:base`. A generated
// project runs the same files through its root `vitest.config.ts`; this config exists
// because the template is not installed here.
//
// Vite loads a tsconfig for every file it transforms, and every template workspace
// extends `@repo/tsconfig/base.json`, which resolves only inside a scaffolded project.
// Without the switch below each file fails with `TSCONFIG_ERROR` before an assertion
// runs. The tests need nothing from a tsconfig: Oxc strips the types either way.
//
// Vite's `OxcOptions` type omits `tsconfig`, but the transform still reads it. Passing it
// through a variable, not an object literal, skips the excess-property check. If a Vite
// upgrade brings `TSCONFIG_ERROR` back, this is the line that stopped working.
const oxc = { tsconfig: false };

export default defineConfig({
  oxc,
  root: fileURLToPath(new URL("templates/base", import.meta.url)),
  test: {
    environment: "node",
    include: ["{apps,packages}/*/src/**/*.test.ts"],
  },
});
