import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for `/projects`, the tenant-scoped example resource. It runs against the
// test database the database driver prepares, seeded from `packages/db/src/seed/slices/`,
// where `member` owns Globex and is a plain, read-only member of Acme.
//
// It covers the success path, `401` with no session, `403` for the wrong tenant (a member
// naming another organization in `x-organization-id`), `403` for the wrong role (a read-only
// member creating), and `400` for a project with no name.

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

/** Make `organization` the active organization of the session `cookie` names. */
async function setActive(cookie: string, organization: string): Promise<void> {
  const res = await call("/auth/organization/set-active", cookie, {
    body: JSON.stringify({
      organizationId: seedId("organizations", organization),
    }),
    method: "POST",
  });
  expect(res.status).toBe(200);
}

/** Sign `email` in and make `organization` the session's active organization. */
async function signInTo(email: string, organization: string): Promise<string> {
  const cookie = await signIn(email);
  await setActive(cookie, organization);
  return cookie;
}

function create(
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return call("/projects", cookie, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

describe("/projects", () => {
  it("creates a project in the active organization and lists it there only", async () => {
    const cookie = await signInTo("member@example.test", "globex");

    const res = await create(cookie, { name: "Launch" });

    expect(res.status).toBe(201);
    const { project } = (await res.json()) as {
      project: { id: string; organizationId: string };
    };
    expect(project.organizationId).toBe(seedId("organizations", "globex"));
    const listed = await call("/projects", cookie);
    const body = (await listed.json()) as { projects: { id: string }[] };
    expect(body.projects.map((row) => row.id)).toContain(project.id);
    await setActive(cookie, "acme");
    const other = await call("/projects", cookie);
    const acme = (await other.json()) as { projects: { id: string }[] };
    expect(acme.projects.map((row) => row.id)).not.toContain(project.id);
  });

  it("answers 401 with no session", async () => {
    const res = await create("", { name: "Launch" });

    expect(res.status).toBe(401);
  });

  it("answers 403 when a member names another organization in the header", async () => {
    const cookie = await signInTo("member@example.test", "globex");

    const res = await create(
      cookie,
      { name: "Launch" },
      { "x-organization-id": seedId("organizations", "acme") }
    );

    expect(res.status).toBe(403);
  });

  it("answers 403 when the member's role may not create", async () => {
    const cookie = await signInTo("member@example.test", "acme");

    const res = await create(cookie, { name: "Launch" });

    expect(res.status).toBe(403);
  });

  it("answers 400 for a project with no name", async () => {
    const cookie = await signInTo("member@example.test", "globex");

    const res = await create(cookie, { name: " " });

    expect(res.status).toBe(400);
  });
});
