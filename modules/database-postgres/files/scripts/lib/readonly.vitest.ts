import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupLocked, testDatabaseUrl } from "../test-setup.ts";
import { loadContext } from "./context.ts";
import { AUTH_TRACE } from "./query.ts";
import { applyReadonlyGrants, loadColumnClasses } from "./readonly-grants.ts";
import { quoteIdent, readonlyRoleName } from "./readonly.ts";
import type { GrantPlan } from "./readonly.ts";
import { swapDatabase } from "./url.ts";

// The read-only role on a real server: the grants `pnpm db:prod:readonly-grants` applies,
// run on this checkout's test database, `<database>_test`. `beforeAll` prepares it with the
// route tests' global setup (create, migrate, seed), then grants a role of this run's own,
// `<project>_ro_t<suffix>`, sets it a password, and connects as it. The server, not a
// script, is what refuses each write and each secret column here.
//
// `afterAll` drops the role. With no test database, or a test user that cannot create
// roles, the file is skipped.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it, and ships
// it only when `auth` is installed: it reads `users` and `accounts`.

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const CONTEXT = loadContext(ROOT);
const URL_OF_TEST_DATABASE = testDatabaseUrl(CONTEXT);

/** Whether the test user may create a role. Asked on the maintenance database. */
async function canCreateRoles(url: string): Promise<boolean> {
  const sql = postgres(swapDatabase(url, "postgres"), {
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await sql<{ allowed: boolean }[]>`
      select rolsuper or rolcreaterole as allowed
      from pg_roles where rolname = current_user`;
    return row?.allowed === true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const SKIP_REASON = URL_OF_TEST_DATABASE
  ? (await canCreateRoles(URL_OF_TEST_DATABASE))
    ? undefined
    : "the test user cannot create roles"
  : "there is no test database: run pnpm db:setup, or set TEST_DATABASE_URL";
if (SKIP_REASON) {
  process.stderr.write(`readonly.test.ts: skipped, ${SKIP_REASON}.\n`);
}

const SUFFIX = randomBytes(4).toString("hex");
const ROLE = `${readonlyRoleName(CONTEXT.prefix)}_t${SUFFIX}`;
const SEED_EMAIL = "superadmin@example.test";

describe.skipIf(SKIP_REASON !== undefined)(applyReadonlyGrants, () => {
  let admin: ReturnType<typeof postgres>;
  let readonly: ReturnType<typeof postgres>;
  let plan: GrantPlan;

  beforeAll(async () => {
    await setupLocked();
    const url = URL_OF_TEST_DATABASE ?? "";
    admin = postgres(url, { max: 1, onnotice: () => {} });
    plan = await applyReadonlyGrants(url, {
      role: ROLE,
      classes: await loadColumnClasses(ROOT),
    });
    // The test sets the password only here. The grant plan never sets one.
    const password = randomBytes(24).toString("hex");
    await admin.unsafe(`ALTER ROLE ${quoteIdent(ROLE)} PASSWORD '${password}'`);
    const roleUrl = new URL(url);
    roleUrl.username = ROLE;
    roleUrl.password = password;
    readonly = postgres(roleUrl.toString(), { max: 1, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    if (readonly) {
      await readonly.end();
    }
    if (admin) {
      await admin.unsafe(`DROP OWNED BY ${quoteIdent(ROLE)}`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdent(ROLE)}`);
      await admin.end();
    }
  });

  it("grants no secret column, and withholds none for want of a class", () => {
    const accounts = plan.tables.find(({ table }) => table === "accounts");

    expect(accounts?.secret).toContain("password");
    expect(accounts?.granted).not.toContain("password");
    expect(
      plan.tables.flatMap(({ unclassified }) => unclassified)
    ).toStrictEqual([]);
  });

  it("connects read-only by default", async () => {
    const [row] = await readonly<{ current_user: string; ro: string }[]>`
      select current_user, current_setting('default_transaction_read_only') as ro`;

    expect(row).toStrictEqual({ current_user: ROLE, ro: "on" });
  });

  it("refuses an insert", async () => {
    await expect(readonly`
      insert into users (id, name, email, email_verified)
      values (${`ro-${SUFFIX}`}, 'Read Only', ${`ro-${SUFFIX}@example.com`}, false)
    `).rejects.toThrow(/read-only transaction/);
  });

  it("refuses an update after set transaction read write", async () => {
    await expect(
      readonly.begin(async (tx) => {
        await tx`set transaction read write`;
        await tx`update users set name = name`;
      })
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a delete", async () => {
    await expect(readonly`delete from users`).rejects.toThrow(
      /read-only transaction|permission denied/
    );
  });

  it("refuses a secret column", async () => {
    await expect(readonly`select password from accounts`).rejects.toThrow(
      /permission denied/
    );
  });

  it("counts the users", async () => {
    const [row] = await readonly<{ count: string }[]>`
      select count(*) from users`;

    expect(Number(row?.count)).toBeGreaterThan(0);
  });

  it.each(AUTH_TRACE.map((query) => [query.title, query.sql]))(
    "runs the --auth-trace query %s",
    async (_title, text) => {
      const rows = await readonly.unsafe(text, [SEED_EMAIL]);

      expect(Array.isArray(rows)).toBeTruthy();
    }
  );

  it("finds the seed superadmin with the --auth-trace user query", async () => {
    const [users] = AUTH_TRACE;
    const rows = await readonly.unsafe(users?.sql ?? "", [SEED_EMAIL]);

    expect(rows.map((row) => row.email)).toStrictEqual([SEED_EMAIL]);
  });
});
