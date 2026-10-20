import { sessions } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// The example route test. It runs in Node against the test database the database driver
// prepares, seeded from `packages/db/src/seed/slices/`, and it is written once for both
// drivers: `testDatabase()` from `@repo/db/testing` hands it an `env` for `app.request` and
// a `db` to look behind the route with, and starts every test from the seed.
//
// The first test reads seed rows through a route (the superadmin's user and credential
// account) and writes one (the session sign-in creates). The second proves that write did
// not outlive its test. Copy this shape for a route of your own.

const SUPERADMIN = seedId("users", "superadmin");

const database = testDatabase();

function signIn(env: object) {
  return app.request(
    "/auth/sign-in/email",
    {
      body: JSON.stringify({
        email: "superadmin@example.test",
        password: "saasaloy-dev-password",
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    },
    env
  );
}

describe("POST /auth/sign-in/email", () => {
  it("signs the seeded superadmin in and writes a session", async () => {
    const res = await signIn(database.env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(SUPERADMIN);
    const rows = await database.db.select().from(sessions);
    expect(rows.filter((row) => row.userId === SUPERADMIN)).toHaveLength(1);
  });

  it("starts from the seed, without the last test's session", async () => {
    const rows = await database.db.select().from(sessions);

    expect(rows).toHaveLength(0);
  });
});
