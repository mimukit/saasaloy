import { config } from "@repo/config";
import { users as usersTable } from "../../schema/auth";
import { defineSlice } from "../slice";
import type { SliceOptions } from "../slice";
import { seedUsers } from "./users.generated";

// Seed users, one for each way the admin app shows a user: the superadmin, an admin, a
// plain user and a banned one. Each signs in with the dev password in `./accounts.ts`.
//
// The seed is how development gets its superadmin. No sign-up promotes an account, the
// first one included: every sign-up gets the plain `user` role. Sign in as
// `superadmin@example.test`. Production gets its first superadmin from
// `pnpm db:prod:superadmin`.
//
// The two site-admin roles come from `config.auth`, so a project that renames them in
// `packages/config/src/project.ts` seeds the names its guards admit.

type UserRows = SliceOptions<typeof usersTable>["rows"];

/** Every set of rows in `rows`, merged into one object. */
function moreRows(input: { rows: readonly UserRows[] }): UserRows {
  const all: UserRows = {};
  for (const rows of input.rows) {
    Object.assign(all, rows);
  }
  return all;
}

// Rows another module adds to this slice, such as `auth-phone`'s phone accounts. The
// module adds its factory call as a row of the `seed.users` table, which the CLI writes
// into `./users.generated.ts`, and `remove` takes it back out.
export const extraUsers = moreRows({ rows: [...seedUsers] });

export const users = defineSlice(usersTable, {
  rows: {
    ...extraUsers,
    superadmin: {
      email: "superadmin@example.test",
      emailVerified: true,
      name: "Ada Superadmin",
      role: config.auth.superadminRole,
    },
    admin: {
      email: "admin@example.test",
      emailVerified: true,
      name: "Alan Admin",
      role: config.auth.adminRole,
    },
    member: {
      email: "member@example.test",
      emailVerified: true,
      name: "Grace Member",
      role: "user",
    },
    banned: {
      banReason: "Seeded example of a banned account.",
      banned: true,
      email: "banned@example.test",
      emailVerified: true,
      name: "Bob Banned",
      role: "user",
    },
  },
});
