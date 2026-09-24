import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `pnpm db:status`: what wrangler says about the local D1 database — which migrations are
// applied and which are pending. It is a report, not a gate: it exits 0 normally and 1 only
// when wrangler cannot read the database.
//
// The state directory is the one `db:migrate:local` writes, so the two commands always talk
// about the same file.

const STATE_DIR = resolve(process.cwd(), "../../apps/api/.wrangler/state");

if (existsSync(STATE_DIR)) {
  process.stdout.write(`State     ${STATE_DIR}\n`);
  const result = spawnSync(
    "wrangler",
    [
      "d1",
      "migrations",
      "list",
      "DB",
      "--local",
      "--config",
      "../../apps/api/wrangler.jsonc",
      "--persist-to",
      "../../apps/api/.wrangler/state",
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    process.stderr.write(
      "Status    unreachable. wrangler could not read the local D1 database.\n"
    );
    process.exitCode = 1;
  }
} else {
  process.stdout.write(
    "No local D1 database yet. Run pnpm db:setup to create and migrate it.\n"
  );
}
