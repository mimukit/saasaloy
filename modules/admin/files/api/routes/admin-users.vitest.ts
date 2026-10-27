import { users } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `GET /admin/users`, the admin panel's user list. It runs against the
// test database the database driver prepares, seeded from `packages/db/src/seed/slices/`,
// and covers the success path, `401` with no admin session and `403` for the wrong role.
// The route reads no input, so it has no `400` case.
//
// `requireAdmin` reads the role from the user row on every request, so the `403` case signs
// the seeded admin in and then demotes the row behind the session. That is the one way a
// session with a non-admin role reaches this route: the admin instance refuses a `user` at
// sign-in.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3001" };

/** Sign a seeded user in on the admin instance and return the session cookie pair. */
async function adminCookie(email: string): Promise<string> {
  const res = await app.request(
    "/admin/auth/sign-in/email",
    {
      body: JSON.stringify({ email, password: "saasaloy-dev-password" }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    database.env
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("admin.session_token="));
  return (line ?? "").split(";")[0] ?? "";
}

function listUsers(cookie: string, query = "") {
  return app.request(
    `/admin/users${query}`,
    { headers: { cookie, "x-auth-audience": "admin", ...ORIGIN } },
    database.env
  );
}

describe("GET /admin/users", () => {
  it("lists the seeded users for an admin", async () => {
    const res = await listUsers(await adminCookie("admin@example.test"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: { email: string }[];
      total: number;
    };
    expect(body.users.map((user) => user.email)).toContain(
      "member@example.test"
    );
    expect(body.total).toBe(body.users.length);
  });

  it("answers 401 with no admin session", async () => {
    const res = await listUsers("");

    expect(res.status).toBe(401);
  });

  it("answers 403 when the session's role is not an admin role", async () => {
    const cookie = await adminCookie("admin@example.test");
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.id, seedId("users", "admin")));

    const res = await listUsers(cookie);

    expect(res.status).toBe(403);
  });
});
