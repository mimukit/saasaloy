import { config } from "@repo/config";
import { users as usersTable } from "../../schema/auth";
import { defineSlice } from "../slice";
import type { SliceOptions } from "../slice";

// Seed users, one for each way the admin app shows a user: the superadmin, an admin, a
// plain user and a banned one. Each signs in with the dev password in `./accounts.ts`.
//
// Seeding a superadmin means the first sign-up on a seeded database is not the first user,
// so it gets the plain `user` role. Sign in as `superadmin@example.test` instead.
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

// Rows another module adds to this slice, such as `auth-phone`'s phone accounts. A
// `plugin-array` patch appends the module's factory call to the array, and `remove` takes
// it back out. Keep the shape `export const <name> = <fn>({ rows: [...] })`.
export const extraUsers = moreRows({ rows: [] });

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
