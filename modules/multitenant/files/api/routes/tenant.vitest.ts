import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `GET /tenant`, which answers the organization a request acts for. It
// runs against the test database the database driver prepares, seeded from
// `packages/db/src/seed/slices/`, where `member` owns Globex and is a plain member of Acme.
//
// It covers the success path, `401` with no session, and `403` for the wrong tenant: a
// caller who is not a superadmin naming an organization in `x-organization-id`. The route
// reads no input, so it has no `400` case.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3002" };

/** Sign a seeded user in as a client and return the session cookie pair. */
async function signIn(email: string): Promise<string> {
  const res = await app.request(
    "/auth/sign-in/email",
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
    .find((header) => header.startsWith("client.session_token="));
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
        ...ORIGIN,
        ...init.headers,
      },
    },
    database.env
  );
}

/** Sign `email` in and make `organization` the session's active organization. */
async function signInTo(email: string, organization: string): Promise<string> {
  const cookie = await signIn(email);
  const res = await call("/auth/organization/set-active", cookie, {
    body: JSON.stringify({
      organizationId: seedId("organizations", organization),
    }),
    method: "POST",
  });
  expect(res.status).toBe(200);
  return cookie;
}

describe("GET /tenant", () => {
  it("answers the session's active organization", async () => {
    const cookie = await signInTo("member@example.test", "globex");

    const res = await call("/tenant", cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationId: string };
    expect(body.organizationId).toBe(seedId("organizations", "globex"));
  });

  it("answers 401 with no session", async () => {
    const res = await call("/tenant", "");

    expect(res.status).toBe(401);
  });

  it("answers 403 when a member names an organization in the header", async () => {
    const cookie = await signInTo("member@example.test", "globex");

    const res = await call("/tenant", cookie, {
      headers: { "x-organization-id": seedId("organizations", "acme") },
    });

    expect(res.status).toBe(403);
  });

  it("answers 403 for a session with no active organization", async () => {
    const res = await call("/tenant", await signIn("member@example.test"));

    expect(res.status).toBe(403);
  });
});
