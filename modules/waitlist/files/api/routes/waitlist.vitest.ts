import { waitlistEntries } from "@repo/db/schema/waitlist";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `POST /waitlist`, the public sign-up form. It runs against the test
// database the database driver prepares, seeded from `packages/db/src/seed/slices/`.
//
// The route is public by design: a visitor joins the list with no account. So it has no
// `401` or `403` case, and this file covers the success path, the duplicate that must not
// leak membership, and the `400` for a bad address.

const database = testDatabase();

function join(body: unknown) {
  return app.request(
    "/waitlist",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    database.env
  );
}

async function entriesFor(email: string) {
  return await database.db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.email, email));
}

describe("POST /waitlist", () => {
  it("adds the address and answers 201", async () => {
    const res = await join({ email: "new@example.test" });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toStrictEqual({ ok: true });
    await expect(entriesFor("new@example.test")).resolves.toHaveLength(1);
  });

  it("answers the same 201 for an address already on the list, and keeps one row", async () => {
    await join({ email: "twice@example.test" });

    const res = await join({ email: "twice@example.test" });

    expect(res.status).toBe(201);
    await expect(entriesFor("twice@example.test")).resolves.toHaveLength(1);
  });

  it("answers 400 with the shared envelope for an address that is not one", async () => {
    const res = await join({ email: "not-an-address" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_input");
  });
});
