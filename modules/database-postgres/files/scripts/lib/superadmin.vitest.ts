import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestProject } from "vitest/node";
import { setup, testDatabaseUrl } from "../test-setup.ts";
import { loadContext } from "./context.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { ensureSuperadmin, loadSuperadminRole, newId } from "./superadmin.ts";

// Tests for ./superadmin.ts, the write behind `pnpm db:prod:superadmin`, on this
// checkout's test database: `<database>_test`, the one the route tests use. `beforeAll`
// prepares it with the route tests' global setup (create, migrate, seed), so this file
// runs on its own too.
//
// Every account it writes has an address ending in this run's suffix, and `afterAll`
// deletes them. The seed's own superadmin stays, so "other superadmins" names it as well.
//
// With no DATABASE_URL in `apps/api/.env` and no TEST_DATABASE_URL, the file is skipped.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it, and ships
// it only when `auth` is installed.

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const URL_OF_TEST_DATABASE = testDatabaseUrl(loadContext(ROOT));
if (!URL_OF_TEST_DATABASE) {
  process.stderr.write(
    "superadmin.test.ts: skipped. There is no test database: run pnpm db:setup, or set TEST_DATABASE_URL.\n"
  );
}

const SUFFIX = randomBytes(4).toString("hex");
const emailFor = (name: string) => `${name}-${SUFFIX}@example.com`;

describe.skipIf(!URL_OF_TEST_DATABASE)(ensureSuperadmin, () => {
  let sql: ReturnType<typeof postgres>;
  let role: string;

  beforeAll(async () => {
    await setup({ provide: () => {} } as unknown as TestProject);
    sql = postgres(URL_OF_TEST_DATABASE ?? "", { max: 1, onnotice: () => {} });
    role = await loadSuperadminRole(ROOT);
  }, 120_000);

  afterAll(async () => {
    if (sql) {
      await sql`delete from users where email like ${`%-${SUFFIX}@example.com`}`;
      await sql.end();
    }
  });

  async function roleOf(email: string): Promise<string | null | undefined> {
    const [row] = await sql<{ role: string | null }[]>`
      select role from users where email = ${email}
    `;
    return row?.role;
  }

  async function passwordOf(
    userId: string
  ): Promise<string | null | undefined> {
    const [row] = await sql<{ password: string | null }[]>`
      select password from accounts
      where user_id = ${userId} and provider_id = 'credential'
    `;
    return row?.password;
  }

  it("creates a superadmin with a credential account", async () => {
    const email = emailFor("create");
    const passwordHash = await hashPassword("a long enough password");

    const result = await ensureSuperadmin(sql, {
      email,
      name: "Create",
      role,
      passwordHash,
    });

    expect(result).toMatchObject({ action: "created", passwordSet: true });
    expect(result.previousRole).toBeUndefined();
    await expect(roleOf(email)).resolves.toBe(role);
    await expect(passwordOf(result.userId)).resolves.toBe(passwordHash);
    await expect(
      verifyPassword(passwordHash, "a long enough password")
    ).resolves.toBeTruthy();
  });

  it("keeps a superadmin on a second run, and says so", async () => {
    const email = emailFor("again");
    const passwordHash = await hashPassword("the first password");
    const first = await ensureSuperadmin(sql, {
      email,
      name: "Again",
      role,
      passwordHash,
    });

    const kept = await ensureSuperadmin(sql, { email, name: "Again", role });

    expect(kept).toMatchObject({
      action: "promoted",
      userId: first.userId,
      previousRole: role,
      passwordSet: false,
      sessionsEnded: 0,
    });
    await expect(passwordOf(first.userId)).resolves.toBe(passwordHash);
  });

  it("sets a new password on a second run and ends the account's sessions", async () => {
    const email = emailFor("reset");
    const first = await ensureSuperadmin(sql, {
      email,
      name: "Reset",
      role,
      passwordHash: await hashPassword("the first password"),
    });
    await sql`
      insert into sessions (id, token, user_id, expires_at)
      values (${newId()}, ${newId()}, ${first.userId}, now() + interval '1 day')
    `;
    const passwordHash = await hashPassword("the second password");

    const second = await ensureSuperadmin(sql, {
      email,
      name: "Reset",
      role,
      passwordHash,
    });

    expect(second).toMatchObject({
      action: "promoted",
      userId: first.userId,
      passwordSet: true,
      sessionsEnded: 1,
    });
    await expect(passwordOf(first.userId)).resolves.toBe(passwordHash);
  });

  it("promotes a plain user and reports the role it held", async () => {
    const email = emailFor("promote");
    const userId = newId();
    await sql`
      insert into users (id, name, email, email_verified, role)
      values (${userId}, 'Promote', ${email}, false, 'user')
    `;

    const result = await ensureSuperadmin(sql, {
      email,
      name: "Promote",
      role,
      passwordHash: await hashPassword("a long enough password"),
    });

    expect(result).toMatchObject({
      action: "promoted",
      previousRole: "user",
      userId,
    });
    await expect(roleOf(email)).resolves.toBe(role);
  });

  it("lists every other superadmin", async () => {
    const one = emailFor("one");
    const two = emailFor("two");
    await ensureSuperadmin(sql, {
      email: one,
      name: "One",
      role,
      passwordHash: await hashPassword("a long enough password"),
    });

    const result = await ensureSuperadmin(sql, {
      email: two,
      name: "Two",
      role,
      passwordHash: await hashPassword("a long enough password"),
    });

    expect(result.otherSuperadmins).toContain(one);
    expect(result.otherSuperadmins).not.toContain(two);
  });

  it("refuses --keep-password on an account with no password, and writes nothing", async () => {
    const email = emailFor("nopassword");
    await sql`
      insert into users (id, name, email, email_verified, role)
      values (${newId()}, 'No Password', ${email}, false, 'user')
    `;

    await expect(
      ensureSuperadmin(sql, { email, name: "No Password", role })
    ).rejects.toThrow(/has no password yet/);
    await expect(roleOf(email)).resolves.toBe("user");
  });
});
