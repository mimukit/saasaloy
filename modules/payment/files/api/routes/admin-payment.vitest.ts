import { users } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `/admin/payment`, the staff payment queue. It runs against the test
// database the database driver prepares, seeded from `packages/db/src/seed/slices/`, and
// covers the success path, `401` with no admin session, `403` for the wrong role, and `400`
// for a status filter that is not one.
//
// `requireAdmin` reads the role from the user row on every request, so the `403` case signs
// the seeded admin in and then demotes the row behind the session. The admin instance
// refuses a `user` at sign-in, so no other path brings that role here.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3001" };

/** Sign the seeded admin in on the admin instance and return the session cookie pair. */
async function adminCookie(): Promise<string> {
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
    database.env
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("admin.session_token="));
  return (line ?? "").split(";")[0] ?? "";
}

function listPayments(cookie: string, query = "") {
  return app.request(
    `/admin/payment/payments${query}`,
    { headers: { cookie, "x-auth-audience": "admin", ...ORIGIN } },
    database.env
  );
}

describe("/admin/payment", () => {
  it("lists the payments, with the counts by status, for an admin", async () => {
    const res = await listPayments(await adminCookie());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      counts: Record<string, number>;
      payments: unknown[];
    };
    expect(body.payments.length).toBeGreaterThan(0);
    expect(body.counts.submitted).toBeGreaterThan(0);
  });

  it("answers 401 with no admin session", async () => {
    const res = await listPayments("");

    expect(res.status).toBe(401);
  });

  it("answers 403 when the session's role is not an admin role", async () => {
    const cookie = await adminCookie();
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.id, seedId("users", "admin")));

    const res = await listPayments(cookie);

    expect(res.status).toBe(403);
  });

  it("answers 400 for a status filter that is not a payment status", async () => {
    const res = await listPayments(await adminCookie(), "?status=lost");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });
});
