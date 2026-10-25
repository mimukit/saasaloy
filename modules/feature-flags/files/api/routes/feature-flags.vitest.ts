import { users } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { MAINTENANCE_KEY } from "@repo/feature-flags";
import { env as workerEnv } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `/flags`, the admin screen's flag editor. It runs against the test
// database the database driver prepares, seeded from `packages/db/src/seed/slices/`, and
// covers the success path, `401` with no admin session, `403` for the wrong role, and `400`
// for a value that is not one.
//
// The flag document is published to `kv-memory`, so the test needs that provider installed.
// The write sets the maintenance flag to `false`, its default, so the published document
// a later test reads never switches maintenance mode on.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3001" };

/**
 * The Worker's own environment, then this file's database, and `kv-memory` for the
 * published flag document, so the test reaches no real store.
 */
function env(): object {
  return { ...(workerEnv as object), ...database.env, KV_PROVIDER: "memory" };
}

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
    env()
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("admin.session_token="));
  return (line ?? "").split(";")[0] ?? "";
}

function call(path: string, cookie: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie,
        "x-auth-audience": "admin",
        ...ORIGIN,
      },
    },
    env()
  );
}

function setMaintenance(cookie: string, body: unknown) {
  return call(`/flags/${MAINTENANCE_KEY}`, cookie, {
    body: JSON.stringify(body),
    method: "PUT",
  });
}

describe("/flags", () => {
  it("stores a value and serves it back to an admin", async () => {
    const cookie = await adminCookie();

    const res = await setMaintenance(cookie, { enabled: false });

    expect(res.status).toBe(200);
    const read = await call(`/flags/${MAINTENANCE_KEY}`, cookie);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      flag: { enabled: boolean; hasRow: boolean };
    };
    expect(body.flag).toMatchObject({ enabled: false, hasRow: true });
  });

  it("answers 401 with no admin session", async () => {
    const res = await call("/flags", "");

    expect(res.status).toBe(401);
  });

  it("answers 403 when the session's role is not an admin role", async () => {
    const cookie = await adminCookie();
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.id, seedId("users", "admin")));

    const res = await setMaintenance(cookie, { enabled: false });

    expect(res.status).toBe(403);
  });

  it("answers 400 with the shared envelope for a value that is not a boolean", async () => {
    const res = await setMaintenance(await adminCookie(), { enabled: "yes" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_input");
  });
});
