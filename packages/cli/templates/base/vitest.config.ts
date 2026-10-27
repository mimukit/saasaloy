import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The one Vitest run for the whole repo: `pnpm test` runs it after `turbo run test`.
//
// Every workspace under apps/ and packages/ is a project. A workspace with a
// `vitest.config.ts` of its own uses it, so a module that needs a setup step (the
// database drivers' route test harness in `apps/api`) ships that file and nothing here
// changes. A workspace without one runs with the settings below.
//
// `packages/env` is left out on purpose. Its tests run on `node:test`, through its own
// `test` script, because the base shipped no test runner when they were written. Vitest
// would collect those files and fail each one with "No test suite found".
//
// `packages/e2e` is left out too, once `saasaloy add e2e` writes it. It holds Playwright
// specs, named `*.spec.ts`, which Vitest's default glob also matches. Playwright runs them
// through `pnpm e2e`, against the running apps.
//
// `cloudflare:workers` exists only inside workerd. A package test that imports a barrel
// whose code reads it (`packages/billing` with a Stripe provider, say) would fail on the
// import, so every project without a config of its own resolves it to the api's stand-in,
// which reads `apps/api/.env`. The api module ships that file (issue #243).
//
// `passWithNoTests` keeps a fresh project green: the base ships no Vitest test, and a
// run that finds none would otherwise exit 1.
const SKIPPED = new Set(["packages/env", "packages/e2e"]);
const WORKER_STAND_IN = resolve("apps/api/test/cloudflare-workers.ts");

const workspaces = globSync("{apps,packages}/*/package.json")
  .map((manifest) => dirname(manifest).replaceAll("\\", "/"))
  .filter((dir) => !SKIPPED.has(dir))
  .toSorted();

/** The workspace's package name, which Vitest prints beside each of its tests. */
function nameOf(dir: string): string {
  const manifest = JSON.parse(readFileSync(`${dir}/package.json`, "utf-8")) as {
    name?: string;
  };
  return manifest.name ?? dir;
}

export default defineConfig({
  resolve: existsSync(WORKER_STAND_IN)
    ? { alias: { "cloudflare:workers": WORKER_STAND_IN } }
    : {},
  test: {
    passWithNoTests: true,
    projects: workspaces.map((dir) =>
      existsSync(`${dir}/vitest.config.ts`)
        ? dir
        : { extends: true, test: { name: nameOf(dir), root: dir } }
    ),
  },
});
