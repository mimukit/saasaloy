import { adminAuth, withAuthScope } from "@repo/auth/server";
import { config } from "@repo/config";
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
//
// The rest pin the client/admin split (ADR 0050): two instances, two cookies, a session
// that counts only on its own side, and the rank guard on the admin instance. They talk
// to Better Auth's own endpoints, so they need no route from another module.
//
// The `admin()` plugin's endpoints answer 404 over HTTP on both forwards' admin paths
// (`/admin/auth/admin/*`, issue #310), so the rank guard cases call them the way an api
// route does: `adminAuth.api.*` with the caller's headers, inside `withAuthScope`. The
// rank guard runs on that call too.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const SUPERADMIN = seedId("users", "superadmin");
const ADMIN = seedId("users", "admin");
const MEMBER = seedId("users", "member");

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/** Sign a seeded user in on one instance: `/auth` for a client, `/admin/auth` for admin. */
function signIn(
  env: object,
  email = "superadmin@example.test",
  base: "/auth" | "/admin/auth" = "/auth"
) {
  return app.request(
    `${base}/sign-in/email`,
    {
      body: JSON.stringify({ email, password: "saasaloy-dev-password" }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env
  );
}

/** The value of one cookie a response set, still signed, as a browser would send it. */
function cookieValue(res: Response, name: string): string {
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  expect(line, `the response sets ${name}`).toBeDefined();
  return (line ?? "").slice(name.length + 1).split(";")[0] ?? "";
}

/** Sign in and return the `name=value` pair for the session cookie. */
async function sessionCookie(
  env: object,
  email: string,
  base: "/auth" | "/admin/auth"
): Promise<string> {
  const res = await signIn(env, email, base);
  expect(res.status).toBe(200);
  const name =
    base === "/auth" ? "client.session_token" : "admin.session_token";
  return `${name}=${cookieValue(res, name)}`;
}

/** Call a Better Auth endpoint with the given cookies. */
function call(
  env: object,
  path: string,
  cookie: string,
  body?: Record<string, unknown>
) {
  return app.request(
    path,
    body
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", cookie, ...ORIGIN },
          method: "POST",
        }
      : { headers: { cookie, ...ORIGIN } },
    env
  );
}

/**
 * Run one `adminAuth.api.*` call as the holder of `cookie`, the way an api route calls it,
 * and answer its status: 200 when it returns, the `APIError`'s status when it throws.
 */
async function adminApiStatus(
  env: object,
  cookie: string,
  body: (headers: Headers) => Promise<unknown>
): Promise<number> {
  const headers = new Headers({ cookie, ...ORIGIN });
  try {
    await withAuthScope(
      {
        env: env as Parameters<typeof withAuthScope>[0]["env"],
        executionCtx: {
          waitUntil: () => {
            // The test's client stays open; nothing to hold.
          },
        },
      },
      () => body(headers)
    );
    return 200;
  } catch (error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") {
      return status;
    }
    throw error;
  }
}

/** The user id `get-session` answers with, or `null` for no session. */
async function sessionUser(
  env: object,
  base: "/auth" | "/admin/auth",
  cookie: string
): Promise<string | null> {
  const res = await call(env, `${base}/get-session`, cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user?: { id: string } } | null;
  return body?.user?.id ?? null;
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

describe("two instances, two cookies", () => {
  it("writes the client cookie and a client row on /auth", async () => {
    const res = await signIn(database.env, "member@example.test", "/auth");

    expect(res.status).toBe(200);
    cookieValue(res, "client.session_token");
    const rows = await database.db.select().from(sessions);
    expect(rows.map((row) => row.audience)).toStrictEqual(["client"]);
  });

  it("writes the admin cookie and an admin row on /admin/auth", async () => {
    const res = await signIn(database.env, "admin@example.test", "/admin/auth");

    expect(res.status).toBe(200);
    cookieValue(res, "admin.session_token");
    const rows = await database.db.select().from(sessions);
    expect(rows.map((row) => row.audience)).toStrictEqual(["admin"]);
  });

  it("keeps a client and an admin signed in together in one browser", async () => {
    const client = await sessionCookie(
      database.env,
      "member@example.test",
      "/auth"
    );
    const admin = await sessionCookie(
      database.env,
      "admin@example.test",
      "/admin/auth"
    );
    const both = `${client}; ${admin}`;

    await expect(sessionUser(database.env, "/auth", both)).resolves.toBe(
      MEMBER
    );
    await expect(sessionUser(database.env, "/admin/auth", both)).resolves.toBe(
      ADMIN
    );
  });

  it("ends one session on sign-out and leaves the other", async () => {
    const client = await sessionCookie(
      database.env,
      "member@example.test",
      "/auth"
    );
    const admin = await sessionCookie(
      database.env,
      "admin@example.test",
      "/admin/auth"
    );
    const both = `${client}; ${admin}`;

    const out = await call(database.env, "/admin/auth/sign-out", both, {});
    expect(out.status).toBe(200);

    await expect(sessionUser(database.env, "/auth", both)).resolves.toBe(
      MEMBER
    );
    await expect(
      sessionUser(database.env, "/admin/auth", both)
    ).resolves.toBeNull();
  });

  it("finds no session for a token copied into the other cookie", async () => {
    // The superadmin signs in as a client, then sends that same signed value under the
    // admin cookie name. The signature is valid, because both instances share the
    // secret; the scoped adapter is what refuses the row.
    const client = await sessionCookie(
      database.env,
      "superadmin@example.test",
      "/auth"
    );
    const copied = client.replace(
      "client.session_token=",
      "admin.session_token="
    );

    await expect(
      sessionUser(database.env, "/admin/auth", copied)
    ).resolves.toBeNull();
    await expect(
      adminApiStatus(database.env, copied, (headers) =>
        adminAuth.api.listUsers({ headers, query: {} })
      )
    ).resolves.toBe(401);
  });

  it("finds no session for an admin token copied into the client cookie", async () => {
    const admin = await sessionCookie(
      database.env,
      "admin@example.test",
      "/admin/auth"
    );
    const copied = admin.replace(
      "admin.session_token=",
      "client.session_token="
    );

    await expect(
      sessionUser(database.env, "/auth", copied)
    ).resolves.toBeNull();
  });
});

describe("the admin instance", () => {
  it("refuses a client account with the wrong-password answer and writes no session", async () => {
    const res = await signIn(
      database.env,
      "member@example.test",
      "/admin/auth"
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    await expect(database.db.select().from(sessions)).resolves.toHaveLength(0);
  });

  it("has no sign-up", async () => {
    const res = await app.request(
      "/admin/auth/sign-up/email",
      {
        body: JSON.stringify({
          email: "new@example.test",
          name: "New",
          password: "saasaloy-dev-password",
        }),
        headers: { "content-type": "application/json", ...ORIGIN },
        method: "POST",
      },
      database.env
    );

    expect(res.status).toBe(400);
  });

  it("refuses its admin endpoints on the client instance", async () => {
    const client = await sessionCookie(
      database.env,
      "superadmin@example.test",
      "/auth"
    );

    const res = await call(database.env, "/auth/admin/list-users", client);
    expect(res.status).toBe(403);
  });

  it("answers 404 on the admin plugin endpoints, even to a superadmin", async () => {
    const superadmin = await sessionCookie(
      database.env,
      "superadmin@example.test",
      "/admin/auth"
    );

    const setRole = await call(
      database.env,
      "/admin/auth/admin/set-role",
      superadmin,
      { role: "user", userId: MEMBER }
    );
    expect(setRole.status).toBe(404);
    const list = await call(
      database.env,
      "/admin/auth/admin/list-users",
      superadmin
    );
    expect(list.status).toBe(404);
    const encoded = await call(
      database.env,
      "/admin/auth/%61dmin/set-role",
      superadmin,
      { role: "user", userId: MEMBER }
    );
    expect(encoded.status).toBe(404);
    const impersonate = await call(
      database.env,
      "/admin/auth/admin/impersonate-user",
      superadmin,
      { userId: MEMBER }
    );
    expect(impersonate.status).toBe(404);
  });

  it("lets an admin list users and change a client's role", async () => {
    const admin = await sessionCookie(
      database.env,
      "admin@example.test",
      "/admin/auth"
    );

    await expect(
      adminApiStatus(database.env, admin, (headers) =>
        adminAuth.api.listUsers({ headers, query: {} })
      )
    ).resolves.toBe(200);
    await expect(
      adminApiStatus(database.env, admin, (headers) =>
        adminAuth.api.setRole({
          body: { role: "user", userId: MEMBER },
          headers,
        })
      )
    ).resolves.toBe(200);
  });

  it("refuses an admin who changes a superadmin or grants an admin role", async () => {
    const admin = await sessionCookie(
      database.env,
      "admin@example.test",
      "/admin/auth"
    );

    await expect(
      adminApiStatus(database.env, admin, (headers) =>
        adminAuth.api.setRole({
          body: { role: "user", userId: SUPERADMIN },
          headers,
        })
      )
    ).resolves.toBe(403);
    await expect(
      adminApiStatus(database.env, admin, (headers) =>
        adminAuth.api.setRole({
          body: { role: config.auth.adminRole, userId: MEMBER },
          headers,
        })
      )
    ).resolves.toBe(403);
  });

  it("refuses to demote the last superadmin, even for the superadmin", async () => {
    const superadmin = await sessionCookie(
      database.env,
      "superadmin@example.test",
      "/admin/auth"
    );

    await expect(
      adminApiStatus(database.env, superadmin, (headers) =>
        adminAuth.api.setRole({
          body: { role: config.auth.adminRole, userId: SUPERADMIN },
          headers,
        })
      )
    ).resolves.toBe(403);
  });

  it("refuses impersonation", async () => {
    const superadmin = await sessionCookie(
      database.env,
      "superadmin@example.test",
      "/admin/auth"
    );

    await expect(
      adminApiStatus(database.env, superadmin, (headers) =>
        adminAuth.api.impersonateUser({ body: { userId: MEMBER }, headers })
      )
    ).resolves.toBe(403);
  });
});

describe("password length", () => {
  function signUp(env: object, password: string) {
    return app.request(
      "/auth/sign-up/email",
      {
        body: JSON.stringify({
          email: "new@example.test",
          name: "New Person",
          password,
        }),
        headers: { "content-type": "application/json", ...ORIGIN },
        method: "POST",
      },
      env
    );
  }

  it("refuses a sign-up password shorter than 12 characters", async () => {
    const res = await signUp(database.env, "elevenchars");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PASSWORD_TOO_SHORT");
  });

  it("takes a sign-up password of 12 characters", async () => {
    const res = await signUp(database.env, "twelve-chars");

    expect(res.status).toBe(200);
  });
});
