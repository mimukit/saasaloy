import { loadContext, readFlags, run, say } from "./lib/context.ts";
import {
  assertSeedServer,
  assertSeedTarget,
  loadSeedEntry,
  refuseProduction,
  seedUrl,
  writeSeed,
} from "./lib/seed.ts";

// `pnpm db:seed`: fill this checkout's development database with the rows in
// `packages/db/src/seed/slices/`, one file per table.
//
// Every row is an upsert on its conflict key, so a second run prints the same counts, puts
// each seed row back to its slice values and leaves every row a person made by hand alone.
// A row deleted from a slice stays in the database; `pnpm db:setup --reset` starts clean.
//
// The guard runs before any connection opens: `NODE_ENV=production` is refused, and so is
// any database that is not `<prefix>` or `<prefix>_<branch>`, and a `DATABASE_URL` in the
// environment that names another server than `apps/api/.env`. See the
// `saasaloy-database-postgres` skill.

await run(async () => {
  readFlags([]);
  refuseProduction();
  const context = loadContext();
  const url = seedUrl(context);
  assertSeedTarget(context.prefix, url);
  assertSeedServer(context);

  const entry = await loadSeedEntry(context.root);
  const result = await writeSeed(url, entry);

  if (result.counts.length === 0) {
    say(
      `No seed slices yet, so nothing was written to ${result.database}. Add one under packages/db/src/seed/slices/.`
    );
    return;
  }
  say(`Seeded ${result.database}:`);
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
});
