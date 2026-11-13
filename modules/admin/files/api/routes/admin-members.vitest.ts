import { AUDIENCE_HEADER } from "@repo/auth/server";
import { config } from "@repo/config";
import { auditEvents } from "@repo/db/schema/audit";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The members routes, end to end, on the seeded `superadmin`, `admin` and `member`
// accounts. Each write is checked for its answer and for the audit row it leaves, and each
// refusal for the row it does not leave.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const SUPERADMIN = seedId("users", "superadmin");
const ADMIN = seedId("users", "admin");

const PASSWORD = "saasaloy-dev-password";

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/** Sign a seeded account in on `/admin/auth` and return the session cookie pair. */
async function cookieOf(email: string, password = PASSWORD): Promise<string> {
  const res = await signIn(email, password);
  expect(res.status).toBe(200);
  const name = "admin.session_token";
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  return `${name}=${(line ?? "").slice(name.length + 1).split(";")[0] ?? ""}`;
}

function signIn(email: string, password: string) {
  return app.request(
    "/admin/auth/sign-in/email",
    {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    database.env
  );
}

function call(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>
) {
  return app.request(
    path,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        [AUDIENCE_HEADER]: "admin",
        cookie,
        ...ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
    },
    database.env
  );
}

function rowsOf(action: string) {
  return database.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, action));
}

interface MembersBody {
  me: { id: string; role: string };
  members: { id: string; email: string; addedBy: string | null }[];
  removed: {
    id: string;
    removedAt: string;
    removedBy: string | null;
  }[];
}

async function listMembers(cookie: string): Promise<MembersBody> {
  const res = await call("GET", "/admin/members", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as MembersBody;
}

const NEWCOMER = {
  email: "farhan@example.test",
  name: "Farhan Kabir",
  password: "a-new-password",
};

describe("GET /admin/members", () => {
  it("lists the admin group, with who is asking", async () => {
    const body = await listMembers(await cookieOf("admin@example.test"));

    expect(body.me).toStrictEqual({ id: ADMIN, role: config.auth.adminRole });
    expect(body.members.map((member) => member.id).toSorted()).toStrictEqual(
      [ADMIN, SUPERADMIN].toSorted()
    );
    expect(body.removed).toStrictEqual([]);
    // The seed's `member.add` row names the superadmin as the one who added the admin.
    expect(body.members.find((member) => member.id === ADMIN)?.addedBy).toBe(
      "Ada Superadmin"
    );
  });
});

describe("POST /admin/members", () => {
  it("lets a superadmin add an admin, and writes member.add without the password", async () => {
    const cookie = await cookieOf("superadmin@example.test");

    const res = await call("POST", "/admin/members", cookie, {
      ...NEWCOMER,
      role: config.auth.adminRole,
    });

    expect(res.status).toBe(201);
    const { member } = (await res.json()) as { member: { id: string } };
    const rows = await rowsOf("member.add");
    const row = rows.find((candidate) => candidate.targetId === member.id);
    expect(row).toMatchObject({
      actorUserId: SUPERADMIN,
      after: {
        email: NEWCOMER.email,
        name: NEWCOMER.name,
        role: config.auth.adminRole,
      },
      before: null,
      targetLabel: NEWCOMER.email,
      targetType: "member",
    });
    expect(JSON.stringify(row)).not.toContain(NEWCOMER.password);
    await expect(
      signIn(NEWCOMER.email, NEWCOMER.password)
    ).resolves.toHaveProperty("status", 200);
  });

  it("refuses an admin a superadmin role with 403, and writes no row", async () => {
    const existing = await rowsOf("member.add");
    const before = existing.length;

    const res = await call(
      "POST",
      "/admin/members",
      await cookieOf("admin@example.test"),
      { ...NEWCOMER, role: config.auth.superadminRole }
    );

    expect(res.status).toBe(403);
    // The route's own refusal, ahead of the rank guard's.
    await expect(res.json()).resolves.toMatchObject({
      error: { message: "Only a superadmin can add a superadmin." },
    });
    await expect(rowsOf("member.add")).resolves.toHaveLength(before);
  });

  it("refuses a password shorter than the auth rule with 400, and adds no account", async () => {
    const cookie = await cookieOf("superadmin@example.test");

    const res = await call("POST", "/admin/members", cookie, {
      ...NEWCOMER,
      password: "11-chars-pw",
      role: config.auth.adminRole,
    });

    expect(res.status).toBe(400);
    const body = await listMembers(cookie);
    expect(body.members.map((member) => member.email)).not.toContain(
      NEWCOMER.email
    );
  });

  it("answers 409 member_removed for the email of a removed member", async () => {
    const cookie = await cookieOf("superadmin@example.test");
    const removal = await call("DELETE", `/admin/members/${ADMIN}`, cookie);
    expect(removal.status).toBe(200);

    const res = await call("POST", "/admin/members", cookie, {
      ...NEWCOMER,
      email: "admin@example.test",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string };
      member: { id: string };
    };
    expect(body.error.code).toBe("member_removed");
    expect(body.member.id).toBe(ADMIN);
  });
});

describe("DELETE /admin/members/:id and POST /admin/members/:id/restore", () => {
  it("removes a member with a ban, and writes member.remove", async () => {
    const cookie = await cookieOf("superadmin@example.test");

    const removed = await call("DELETE", `/admin/members/${ADMIN}`, cookie);

    expect(removed.status).toBe(200);
    await expect(rowsOf("member.remove")).resolves.toStrictEqual([
      expect.objectContaining({
        actorUserId: SUPERADMIN,
        after: { removed: true },
        before: { removed: false },
        targetId: ADMIN,
      }),
    ]);
    // A removed member cannot sign in.
    await expect(
      signIn("admin@example.test", PASSWORD)
    ).resolves.not.toHaveProperty("status", 200);
  });

  it("lists a removed member with the member.remove row's date and person", async () => {
    const cookie = await cookieOf("superadmin@example.test");
    await call("DELETE", `/admin/members/${ADMIN}`, cookie);
    const [removal] = await rowsOf("member.remove");

    const listed = await listMembers(cookie);

    expect(listed.members.map((member) => member.id)).not.toContain(ADMIN);
    expect(listed.removed).toStrictEqual([
      expect.objectContaining({
        id: ADMIN,
        removedAt: removal?.createdAt.toISOString(),
        removedBy: "Ada Superadmin",
      }),
    ]);
  });

  it("restores a removed member, and writes member.restore", async () => {
    const cookie = await cookieOf("superadmin@example.test");
    await call("DELETE", `/admin/members/${ADMIN}`, cookie);

    const restored = await call(
      "POST",
      `/admin/members/${ADMIN}/restore`,
      cookie
    );

    expect(restored.status).toBe(200);
    await expect(rowsOf("member.restore")).resolves.toStrictEqual([
      expect.objectContaining({
        actorUserId: SUPERADMIN,
        after: { removed: false },
        before: { removed: true },
        targetId: ADMIN,
      }),
    ]);
    const after = await listMembers(cookie);
    expect(after.removed).toStrictEqual([]);
    await expect(
      signIn("admin@example.test", PASSWORD)
    ).resolves.toHaveProperty("status", 200);
  });

  it("refuses an admin a removal with 403, and writes no row", async () => {
    const res = await call(
      "DELETE",
      `/admin/members/${SUPERADMIN}`,
      await cookieOf("admin@example.test")
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { message: "Only a superadmin can remove a member." },
    });
    await expect(rowsOf("member.remove")).resolves.toHaveLength(0);
  });

  it("refuses an admin a restore with 403", async () => {
    const res = await call(
      "POST",
      `/admin/members/${SUPERADMIN}/restore`,
      await cookieOf("admin@example.test")
    );

    expect(res.status).toBe(403);
    await expect(rowsOf("member.restore")).resolves.toHaveLength(0);
  });

  it("answers 400 to a member removing themselves", async () => {
    const res = await call(
      "DELETE",
      `/admin/members/${SUPERADMIN}`,
      await cookieOf("superadmin@example.test")
    );

    expect(res.status).toBe(400);
    await expect(rowsOf("member.remove")).resolves.toHaveLength(0);
  });
});

describe("POST /admin/members/:id/password", () => {
  it("refuses a wrong current password with 400, and writes no row", async () => {
    const res = await call(
      "POST",
      `/admin/members/${ADMIN}/password`,
      await cookieOf("admin@example.test"),
      { currentPassword: "not-the-password", newPassword: "a-new-password" }
    );

    expect(res.status).toBe(400);
    await expect(rowsOf("member.password.set")).resolves.toHaveLength(0);
    await expect(
      signIn("admin@example.test", PASSWORD)
    ).resolves.toHaveProperty("status", 200);
  });

  it("changes your own password, keeps you signed in, and logs only that it was set", async () => {
    const res = await call(
      "POST",
      `/admin/members/${ADMIN}/password`,
      await cookieOf("admin@example.test"),
      {
        currentPassword: PASSWORD,
        newPassword: "a-new-password",
        revokeOtherSessions: true,
      }
    );

    expect(res.status).toBe(200);
    // Signing out the other sessions deletes this one too; the fresh cookie replaces it.
    expect(
      res.headers
        .getSetCookie()
        .some((line) => line.startsWith("admin.session_token="))
    ).toBeTruthy();
    await expect(rowsOf("member.password.set")).resolves.toStrictEqual([
      expect.objectContaining({ after: null, before: null, targetId: ADMIN }),
    ]);
    await expect(
      signIn("admin@example.test", "a-new-password")
    ).resolves.toHaveProperty("status", 200);
  });

  it("refuses a superadmin a reset shorter than the auth rule with 400, not 500", async () => {
    const res = await call(
      "POST",
      `/admin/members/${ADMIN}/password`,
      await cookieOf("superadmin@example.test"),
      { newPassword: "11-chars-pw" }
    );

    expect(res.status).toBe(400);
    await expect(rowsOf("member.password.set")).resolves.toHaveLength(0);
    await expect(
      signIn("admin@example.test", PASSWORD)
    ).resolves.toHaveProperty("status", 200);
  });

  it("refuses an admin another member's password with 403", async () => {
    const res = await call(
      "POST",
      `/admin/members/${SUPERADMIN}/password`,
      await cookieOf("admin@example.test"),
      { newPassword: "a-new-password" }
    );

    expect(res.status).toBe(403);
    await expect(rowsOf("member.password.set")).resolves.toHaveLength(0);
  });
});
