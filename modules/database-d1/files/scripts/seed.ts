import { resolve } from "node:path";
import {
  DEV_STATE,
  loadSeedEntry,
  openLocalD1,
  refuseTarget,
  repoRoot,
  writeSeed,
} from "./lib/seed.ts";

// `pnpm db:seed`: fill the local D1 database with the rows in
// `packages/db/src/seed/slices/`, one file per table.
//
// Every row is an upsert on its conflict key, so a second run prints the same counts, puts
// each seed row back to its slice values and leaves every row a person made by hand alone.
// A row deleted from a slice stays in the database; `pnpm db:drop`, then `pnpm db:setup`,
// starts clean.
//
// It writes to the local database only, the one `vite dev` and `db:migrate:local` use
// under `apps/api/.wrangler/state`. `--remote` and `NODE_ENV=production` are refused
// before anything opens. See the `saasaloy-database-d1` skill.

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

try {
  refuseTarget();
  const root = repoRoot();
  const entry = await loadSeedEntry(root);
  const { d1, dispose } = await openLocalD1(root, resolve(root, DEV_STATE));
  let result: Awaited<ReturnType<typeof writeSeed>>;
  try {
    result = await writeSeed(d1, entry);
  } finally {
    await dispose();
  }

  if (result.counts.length === 0) {
    say(
      "No seed slices yet, so nothing was written. Add one under packages/db/src/seed/slices/."
    );
  } else {
    say("Seeded the local D1 database:");
    const width = Math.max(...result.counts.map((count) => count.table.length));
    for (const count of result.counts) {
      say(
        `  ${count.table.padEnd(width)}  ${count.rows} row${count.rows === 1 ? "" : "s"}`
      );
    }
    for (const message of result.messages) {
      say("");
      say(message);
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
