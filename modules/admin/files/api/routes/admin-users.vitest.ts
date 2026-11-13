import { AUDIENCE_HEADER } from "@repo/auth/server";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// `GET /admin/users` and its query, on the seeded accounts. The overview asks for
// `?limit=5&sortBy=createdAt&sortDirection=desc` and renders the answer in order, so the
// sort and the cap are the api's promise, not the screen's.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const PASSWORD = "saasaloy-dev-password";

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/** Sign the seeded superadmin in on `/admin/auth` and return the session cookie pair. */
async function adminCookie(): Promise<string> {
  const res = await app.request(
    "/admin/auth/sign-in/email",
    {
      body: JSON.stringify({
        email: "superadmin@example.test",
        password: PASSWORD,
      }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    database.env
  );
  expect(res.status).toBe(200);
  const name = "admin.session_token";
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  return `${name}=${(line ?? "").slice(name.length + 1).split(";")[0] ?? ""}`;
}

function list(query: string, cookie: string) {
  return app.request(
    `/admin/users${query}`,
    { headers: { [AUDIENCE_HEADER]: "admin", cookie, ...ORIGIN } },
    database.env
  );
}

interface UsersBody {
  users: { id: string; createdAt: string; name: string }[];
  total: number;
}

describe("GET /admin/users", () => {
  it("answers every account up to 100 and the total with no query", async () => {
    const res = await list("", await adminCookie());
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersBody;
    expect(body.users).toHaveLength(Math.min(body.total, 100));
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it("answers the newest accounts first, capped by limit, with the full total", async () => {
    const cookie = await adminCookie();
    const allRes = await list("", cookie);
    const all = (await allRes.json()) as UsersBody;

    const res = await list(
      "?limit=2&sortBy=createdAt&sortDirection=desc",
      cookie
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersBody;

    expect(body.total).toBe(all.total);
    expect(body.users).toHaveLength(2);
    const newest = all.users
      .map((user) => user.createdAt)
      .toSorted()
      .toReversed()
      .slice(0, 2);
    expect(body.users.map((user) => user.createdAt)).toStrictEqual(newest);
  });

  it.each([
    "?limit=0",
    "?limit=101",
    "?limit=two",
    "?sortBy=email",
    "?sortBy=name&sortDirection=up",
  ])("refuses %s with 400", async (query) => {
    const res = await list(query, await adminCookie());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });
});
