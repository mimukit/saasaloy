import { homedir } from "node:os";
import { loadContext, readFlags, run, say } from "./lib/context.ts";
import { assertProductionTarget } from "./lib/production.ts";
import { READONLY_URL_KEY, readonlyEnvPath } from "./lib/query.ts";
import {
  applyReadonlyGrants,
  loadColumnClasses,
  reportGrants,
} from "./lib/readonly-grants.ts";
import { quoteIdent, readonlyRoleName } from "./lib/readonly.ts";

// `pnpm db:prod:readonly-grants`: create the read-only role `<project>_ro` on production
// when it is missing, and bring its grants to the column classes in
// `packages/db/src/column-classes/`. `pnpm db:prod:migrate` runs the same step after each
// migration.
//
// The pnpm script runs this under `env-deploy --run api`, so DATABASE_URL is the owner's
// production value. It never sets or prints a password: the owner sets the role's password
// by hand with the `ALTER ROLE` line it prints. Safe to run again; each run makes the grants
// match the classes exactly.

await run(async () => {
  readFlags([]);
  const context = loadContext();
  const { url, database, host } = assertProductionTarget({
    url: process.env.DATABASE_URL,
    devPrefix: context.prefix,
    devUrl: context.env.values.get("DATABASE_URL"),
  });
  say(`Target: ${database} on ${host}.`);
  const role = readonlyRoleName(context.prefix);
  const classes = await loadColumnClasses(context.root);
  reportGrants(await applyReadonlyGrants(url, { role, classes }));
  say("");
  say(
    `The role has no password from this script. Set one as the owner, in psql on ${database}:`
  );
  say(`  ALTER ROLE ${quoteIdent(role)} PASSWORD '<a new password>';`);
  say(
    `Then put ${READONLY_URL_KEY}=postgres://${role}:<password>@${host}/${database} in ${readonlyEnvPath(homedir(), context.prefix)}, mode 600, for pnpm db:prod:query.`
  );
});
