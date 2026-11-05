import { assertManagedDatabase } from "./lib/branch-name.ts";
import { loadContext, run, say, withSql } from "./lib/context.ts";
import { hashPassword, passwordProblem } from "./lib/password.ts";
import { assertProductionTarget } from "./lib/production.ts";
import { readNewPassword } from "./lib/prompt.ts";
import { defaultName, parseSuperadminArgs } from "./lib/superadmin-args.ts";
import { ensureSuperadmin, loadSuperadminRole } from "./lib/superadmin.ts";
import { databaseOf, hostOf } from "./lib/url.ts";

// `pnpm db:prod:superadmin --email <address> [--name <name>] [--keep-password]`: create the
// first superadmin in production, or promote an existing account, with a password typed at
// run time. The password is hashed here the way Better Auth hashes it, and neither the
// password nor the hash is printed or saved anywhere but the `accounts` row.
//
// No sign-up promotes an account, so on Postgres this is how production gets its first
// superadmin. The seed makes development's, and production never runs the seed.
//
// The pnpm script runs this under `env-deploy --run api`, so DATABASE_URL is the production
// value. Run directly (`node scripts/superadmin.ts` from packages/db, with DATABASE_URL
// exported) it also accepts this project's development databases, which is how it is tried
// before a launch. Every other database is refused before a connection opens.
//
// `database-postgres` ships this file only when `auth` is installed: it writes the auth
// module's `users` and `accounts` tables.

await run(async () => {
  const args = parseSuperadminArgs(process.argv.slice(2));
  const context = loadContext();
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is empty. Run pnpm db:prod:superadmin, which loads the production value with env-deploy --run api."
    );
  }

  let database: string;
  try {
    database = databaseOf(url);
  } catch {
    throw new Error("DATABASE_URL is not a postgres:// URL.");
  }
  let isDev = false;
  try {
    assertManagedDatabase(context.prefix, database);
    isDev = true;
  } catch {
    assertProductionTarget({
      url,
      devPrefix: context.prefix,
      devUrl: context.env.values.get("DATABASE_URL"),
    });
  }

  say(
    `Target: ${database} on ${hostOf(url)}${isDev ? " (a development database)" : ""}.`
  );
  say(`Account: ${args.email}.`);
  const role = await loadSuperadminRole(context.root);

  let passwordHash: string | undefined;
  if (!args.keepPassword) {
    const password = await readNewPassword();
    const problem = passwordProblem(password);
    if (problem !== undefined) {
      throw new Error(`${problem} Nothing was written.`);
    }
    passwordHash = await hashPassword(password);
  }

  const result = await withSql(
    url,
    `Could not reach ${database}`,
    async (sql) =>
      await ensureSuperadmin(sql, {
        email: args.email,
        name: args.name ?? defaultName(args.email),
        role,
        ...(passwordHash === undefined ? {} : { passwordHash }),
      })
  );

  if (result.action === "created") {
    say(`Created ${args.email} as ${role}.`);
  } else if (result.previousRole === role) {
    say(`${args.email} is a ${role} already.`);
  } else {
    say(
      `Promoted ${args.email} from ${result.previousRole ?? "no role"} to ${role}.`
    );
  }
  if (result.passwordSet) {
    say(
      result.sessionsEnded > 0
        ? `Set the password and ended ${String(result.sessionsEnded)} session(s).`
        : "Set the password."
    );
  } else {
    say("Kept the password on file.");
  }
  if (result.otherSuperadmins.length > 0) {
    say(
      `Other ${role} accounts: ${result.otherSuperadmins.join(", ")}. Check that each one should hold it.`
    );
  }
  say("Sign in on the admin app with this email.");
});
