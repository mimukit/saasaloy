import { AUDIENCE_HEADER } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { TRANSACTION_IS_ATOMIC } from "@repo/db/client";
import { auditEvents } from "@repo/db/schema/audit";
import { users } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import app from "../index";
import { adminWrite } from "../lib/admin-write";
import type { AuditAction } from "../lib/audit-actions";

// The `adminWrite` test. It mounts one route of its own on a tiny Hono app, so it needs no
// write route from another module, and checks what the wrapper promises:
//
// - A body that succeeds keeps its change and leaves exactly one `audit_events` row.
// - A body that throws, or answers 4xx, leaves no row. Under `database-postgres` it also
//   keeps no change, because the wrapper's transaction rolls it back. Under `database-d1`
//   there is no transaction to roll back, so the change the body made before it failed
//   stands. The test names say which driver ran.
//
// The route renames the seeded member, a row every scaffold with `auth` has. Its action is
// registered here through `vi.mock`, because no installed module needs to own it.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

// `vi.hoisted`, because `vi.mock` runs before the file's own top-level lines.
const { TEST_ACTION } = vi.hoisted(() => ({
  TEST_ACTION: "test.member.rename",
}));

vi.mock(import("../lib/audit-actions"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    AUDIT_ACTIONS: {
      ...actual.AUDIT_ACTIONS,
      [TEST_ACTION]: {
        area: "members",
        route: "POST /admin/test/rename/:mode",
        target: "member",
      },
    },
  };
});

const MEMBER = seedId("users", "member");
const ADMIN = seedId("users", "admin");
const NEW_NAME = "Grace Renamed";

const database = testDatabase();

/** How the route body ends after it has renamed the member. */
type Mode = "ok" | "throws" | "answers-422";

const route = new Hono<{ Bindings: AuthDbBindings }>().post(
  "/admin/test/rename/:mode",
  (c) =>
    adminWrite(c, async ({ db, audit }) => {
      const [before] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, MEMBER));
      await db
        .update(users)
        .set({ name: NEW_NAME })
        .where(eq(users.id, MEMBER));
      audit({
        action: TEST_ACTION as AuditAction,
        after: { name: NEW_NAME },
        before: { name: before?.name },
        target: { id: MEMBER, label: "member@example.test" },
      });
      const mode = c.req.param("mode") as Mode;
      if (mode === "throws") {
        throw new Error("the body failed after its write");
      }
      if (mode === "answers-422") {
        return c.json({ error: { code: "invalid_request" } }, 422);
      }
      return c.json({ ok: true }, 200);
    })
);

const ORIGIN = { origin: "http://localhost:3000" };

/** Sign the seeded admin in on `/admin/auth` and return the session cookie pair. */
async function adminCookie(env: object): Promise<string> {
  const res = await app.request(
    "/admin/auth/sign-in/email",
    {
      body: JSON.stringify({
        email: "admin@example.test",
        password: "saasaloy-dev-password",
      }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env
  );
  expect(res.status).toBe(200);
  const name = "admin.session_token";
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  return `${name}=${(line ?? "").slice(name.length + 1).split(";")[0] ?? ""}`;
}

function rename(env: object, mode: Mode, cookie?: string) {
  return route.request(
    `/admin/test/rename/${mode}`,
    {
      headers: {
        [AUDIENCE_HEADER]: "admin",
        ...ORIGIN,
        ...(cookie === undefined ? {} : { cookie }),
      },
      method: "POST",
    },
    env
  );
}

async function memberName(): Promise<string | undefined> {
  const [row] = await database.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, MEMBER));
  return row?.name;
}

function testRows() {
  return database.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, TEST_ACTION));
}

const failedChange = TRANSACTION_IS_ATOMIC
  ? "rolls the change back (Postgres)"
  : "keeps the change, with no transaction to roll back (D1)";

describe(adminWrite, () => {
  it("keeps the change and writes one audit_events row when the body succeeds", async () => {
    const res = await rename(
      database.env,
      "ok",
      await adminCookie(database.env)
    );

    expect(res.status).toBe(200);
    await expect(memberName()).resolves.toBe(NEW_NAME);
    const rows = await testRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorRole: "admin",
      actorUserId: ADMIN,
      after: { name: NEW_NAME },
      before: { name: "Grace Member" },
      targetId: MEMBER,
      targetType: "member",
    });
  });

  it.each([
    ["throws", 500],
    ["answers-422", 422],
  ] as const)(
    `writes no audit_events row when the body %s, and ${failedChange}`,
    async (mode, status) => {
      const res = await rename(
        database.env,
        mode,
        await adminCookie(database.env)
      );

      expect(res.status).toBe(status);
      await expect(testRows()).resolves.toHaveLength(0);
      await expect(memberName()).resolves.toBe(
        TRANSACTION_IS_ATOMIC ? "Grace Member" : NEW_NAME
      );
    }
  );

  it("answers 401 with no session and runs no body", async () => {
    const res = await rename(database.env, "ok");

    expect(res.status).toBe(401);
    await expect(memberName()).resolves.toBe("Grace Member");
    await expect(testRows()).resolves.toHaveLength(0);
  });
});
