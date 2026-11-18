import { members, organizationRoles } from "@repo/db/schema/teams";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// `GET /projects`, the one worked-example route an agent may call. Its statement names
// `project:read`, and that scope limits a key only: a signed-in member reads the list
// whatever their role holds, exactly as `requireTenant` let them before the agent module
// gave the route a scope word. The scope never narrows a person (plan 0110, "Migration
// and rollback": the change is additive).
//
// It runs on the seeded test database: `member@example.test` is a `member` of Acme, which
// owns two projects.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/** Sign a seeded user in, make Acme active, and return the session cookie pair. */
async function signInToAcme(email: string): Promise<string> {
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
  const cookie =
    res.headers
      .getSetCookie()
      .find((header) => header.startsWith("client.session_token="))
      ?.split(";")[0] ?? "";
  const active = await app.request(
    "/auth/organization/set-active",
    {
      body: JSON.stringify({ organizationSlug: "acme" }),
      headers: { "content-type": "application/json", cookie, ...ORIGIN },
      method: "POST",
    },
    database.env
  );
  expect(active.status).toBe(200);
  return cookie;
}

function listProjects(cookie: string) {
  return app.request(
    "/projects",
    { headers: { cookie, ...ORIGIN } },
    database.env
  );
}

/** Give Acme's `member` a custom role that holds no `project:read`. */
async function demoteMemberToNoRead(): Promise<void> {
  const acme = seedId("organizations", "acme");
  await database.db.insert(organizationRoles).values({
    id: crypto.randomUUID(),
    organizationId: acme,
    permission: JSON.stringify({ ac: ["read"] }),
    role: "auditor",
  });
  await database.db
    .update(members)
    .set({ role: "auditor" })
    .where(
      and(
        eq(members.organizationId, acme),
        eq(members.userId, seedId("users", "member"))
      )
    );
}

describe("GET /projects", () => {
  it("lists the organization's projects for a member", async () => {
    const res = await listProjects(await signInToAcme("member@example.test"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects.length).toBeGreaterThan(0);
  });

  it("still lists them for a member whose role holds no project:read", async () => {
    await demoteMemberToNoRead();
    const res = await listProjects(await signInToAcme("member@example.test"));
    expect(res.status).toBe(200);
  });

  it("refuses a caller with no session", async () => {
    const res = await app.request(
      "/projects",
      { headers: ORIGIN },
      database.env
    );
    expect(res.status).toBe(401);
  });
});
