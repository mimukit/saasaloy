import { spawnSync } from "node:child_process";
import process from "node:process";

import { hasModule, readConfig, ROOT } from "./lib/project.ts";

// Throws the development database away after the run, on CI only.
//
// On CI the runner is gone a minute later, so dropping costs nothing and keeps a shared
// Postgres service container from collecting one database per job. Locally the database is
// KEPT on purpose: a drop means a full migration on the next run, for no safety gained.
// Every spec that writes a row writes a row of its own, so a crashed run cannot poison the
// next one, which is what a teardown-based cleanup would have been for.
//
// Drop it yourself with `pnpm db:drop` when you want a clean slate — that is also the fix
// when `auth.setup.ts` reports that the fixture account is not an admin.
export default function globalTeardown(): void {
  if (!process.env.CI) {
    return;
  }
  const config = readConfig();
  if (!hasModule(config, "database")) {
    return;
  }
  // `db:drop` drops what the state block in `apps/api/.dev.vars` names and nothing else, so
  // a URL no block vouches for is never a drop target. A failure here is reported and not
  // thrown: the run's own result is already decided, and turning a green suite red over
  // cleanup would hide it.
  const result = spawnSync("pnpm", ["db:drop"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error("pnpm db:drop failed. The database is still there.");
  }
}
