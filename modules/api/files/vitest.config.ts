import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { apiTestWorkers } from "./test/workers";

// The api's tests run in Node, not in workerd. The root `vitest.config.ts` treats this
// workspace as a project, and Vitest reads this file instead of `vite.config.ts`, whose
// Cloudflare plugin would boot the whole Worker before the first test.
//
// A test calls the Hono app directly and hands it the bindings itself:
//
//   const res = await app.request("/health", {}, env);
//
// Two conventions let modules extend the setup without editing this file:
//
// - `cloudflare:workers` resolves to `./test/cloudflare-workers.ts`, a Node stand-in that
//   reads `apps/api/.env`, the file wrangler reads in local development. Code that imports
//   `env` from it at module scope (Better Auth's options in `@repo/auth`) loads unchanged.
// - Every file in `./test/setup/` is a Vitest global setup, run once before the first test
//   file. The installed database driver drops one there that prepares the test database.
//   See the driver's skill, "Route tests".
//
// Test files run in parallel, on `maxWorkers` workers. `./test/workers.ts` works the count
// out from the CPUs and the memory, capped at 4, and `API_TEST_WORKERS` overrides it;
// `API_TEST_WORKERS=1` runs the files one at a time. On Postgres the driver's global setup
// copies the seeded test database once per worker, and each worker connects to its own copy
// by `VITEST_POOL_ID`, so two files never wait on each other's row locks.
//
// `maxWorkers` sits at the root of `test`, never in an inline project: Vitest numbers the
// workers of one group from 1 to that group's `maxWorkers`, and a project-level count lets a
// worker number pass the number of copies. `sequence.groupOrder` puts the api in a group of
// its own, after the other workspaces, because Vitest refuses two projects with different
// `maxWorkers` in one group.

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "cloudflare:workers": here("./test/cloudflare-workers.ts") },
  },
  test: {
    environment: "node",
    // Off because `@repo/db` builds its schema and its seed from `import.meta.glob`, and
    // Vitest's on-disk transform cache keeps a stale expansion after a file is added.
    // `packages/db/vitest.config.ts` explains it; the root config cannot set it for us.
    fsModuleCache: false,
    globalSetup: globSync("test/setup/*.ts", { cwd: here(".") })
      .toSorted()
      .map((file) => here(`./${file}`)),
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    maxWorkers: apiTestWorkers(),
    sequence: { groupOrder: 1 },
  },
});
