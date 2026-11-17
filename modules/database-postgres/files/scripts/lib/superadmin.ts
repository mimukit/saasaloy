import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import type postgres from "postgres";

// The one write `pnpm db:prod:superadmin` makes, in one transaction: a superadmin row in
// `users` and a Better Auth credential account in `accounts`, created or brought up to date.
//
// It writes the two rows the way Better Auth's email sign-up writes them.
// `accounts.account_id` is the user's id and `provider_id` is `credential`, which is where
// the email-and-password sign-in looks for the hash. The `id` columns have no database
// default, because Better Auth makes its ids in code, so `newId()` makes them here the
// same way.

type Sql = ReturnType<typeof postgres>;

export interface SuperadminInput {
  email: string;
  name: string;
  /** The superadmin role string, `config.auth.superadminRole`. */
  role: string;
  /** The new password's Better Auth hash, or `undefined` to keep the one on file. */
  passwordHash?: string;
}

export interface SuperadminResult {
  /** `created` for a new account, `promoted` for an existing one. */
  action: "created" | "promoted";
  userId: string;
  /** The role the account held before, when it existed. */
  previousRole?: string | null;
  passwordSet: boolean;
  /** Sessions ended because the password changed. */
  sessionsEnded: number;
  /** Every other superadmin's email, so a stray one is seen at once. */
  otherSuperadmins: string[];
}

interface UserRow {
  id: string;
  role: string | null;
}

const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A 32-character alphanumeric id, the shape Better Auth's default `generateId` makes. */
export function newId(): string {
  let id = "";
  for (let index = 0; index < 32; index += 1) {
    id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return id;
}

/**
 * The superadmin role string from `@repo/config`, so a project that renames it in
 * `packages/config/src/project.ts` gets the name its guards admit. The config package
 * imports without file extensions, which plain Node cannot resolve, so it loads through
 * Vite's `runnerImport`, as the seed does.
 */
export async function loadSuperadminRole(root: string): Promise<string> {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport<{
    config: { auth?: { superadminRole?: string } };
  }>(resolve(root, "packages/config/src/index.ts"), {
    logLevel: "error",
    root: resolve(root, "packages/config"),
  });
  const role = module.config.auth?.superadminRole;
  if (!role) {
    throw new Error(
      "packages/config has no auth.superadminRole. Is the auth module installed?"
    );
  }
  return role;
}

/**
 * Create or promote the superadmin for `input.email`. Refuses an existing account with no
 * password when `passwordHash` is absent, because nobody could sign in to it.
 */
export async function ensureSuperadmin(
  sql: Sql,
  input: SuperadminInput
): Promise<SuperadminResult> {
  return await sql.begin(async (tx) => {
    const [existing] = await tx<UserRow[]>`
      select id, role from users where email = ${input.email} for update
    `;

    let userId: string;
    let action: SuperadminResult["action"];
    if (existing) {
      await tx`
        update users
        set role = ${input.role}, email_verified = true, banned = false,
            ban_reason = null, ban_expires = null, updated_at = now()
        where id = ${existing.id}
      `;
      userId = existing.id;
      action = "promoted";
    } else {
      userId = newId();
      await tx`
        insert into users (id, name, email, email_verified, role)
        values (${userId}, ${input.name}, ${input.email}, true, ${input.role})
      `;
      action = "created";
    }

    const [account] = await tx<{ id: string; password: string | null }[]>`
      select id, password from accounts
      where user_id = ${userId} and provider_id = 'credential'
      for update
    `;
    let sessionsEnded = 0;
    if (input.passwordHash === undefined) {
      if (!account?.password) {
        throw new Error(
          `${input.email} has no password yet, so --keep-password would leave an account nobody can sign in to. Nothing was written.`
        );
      }
    } else if (account) {
      await tx`
        update accounts set password = ${input.passwordHash}, updated_at = now()
        where id = ${account.id}
      `;
      const ended = await tx`delete from sessions where user_id = ${userId}`;
      sessionsEnded = ended.count;
    } else {
      await tx`
        insert into accounts (id, user_id, account_id, provider_id, password)
        values (${newId()}, ${userId}, ${userId}, 'credential', ${input.passwordHash})
      `;
    }

    const others = await tx<{ email: string }[]>`
      select email from users
      where role = ${input.role} and id <> ${userId}
      order by email
    `;

    return {
      action,
      userId,
      ...(existing ? { previousRole: existing.role } : {}),
      passwordSet: input.passwordHash !== undefined,
      sessionsEnded,
      otherSuperadmins: others.map((row) => row.email),
    };
  });
}
