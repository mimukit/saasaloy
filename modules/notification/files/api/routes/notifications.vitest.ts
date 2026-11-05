import { notifications } from "@repo/db/schema/notifications";
import { testDatabase } from "@repo/db/testing";
import { seedId } from "@repo/db/seed/id";
import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../index";

// The scoping the `notification` module promises, proved through the routes. It runs on
// the test database the database driver prepares, seeded from
// `packages/db/src/seed/slices/`, so every test starts from the same rows: four for
// `member@example.test` (two unread, one of each category read) and one unread row for
// `admin@example.test`.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/** The Worker's own environment, then this file's database. */
function env(): object {
  return { ...(workerEnv as object), ...database.env };
}

/** Sign a seeded user in as a client and return the session cookie pair. */
async function signIn(email: string): Promise<string> {
  const res = await app.request(
    "/auth/sign-in/email",
    {
      body: JSON.stringify({ email, password: "saasaloy-dev-password" }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env()
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("client.session_token="));
  expect(line, "the sign-in sets the client cookie").toBeDefined();
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
    env()
  );
}

interface Page {
  notifications: { id: string; read: boolean }[];
  nextCursor: string | null;
}

async function page(cookie: string, cursor?: string): Promise<Page> {
  const query =
    cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  const res = await call(`/notifications${query}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

async function unread(cookie: string): Promise<number> {
  const res = await call("/notifications/unread-count", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { count: number }).count;
}

const memberRow = seedId("notifications", "member-account-unread");
const adminRow = seedId("notifications", "admin-account-unread");

describe("own rows only", () => {
  it("lists only the caller's rows, newest first", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");

    const mine = await page(member);
    const theirs = await page(admin);

    expect(mine.notifications.map((row) => row.id)).toStrictEqual([
      seedId("notifications", "member-account-unread"),
      seedId("notifications", "member-product-unread"),
      seedId("notifications", "member-account-read"),
      seedId("notifications", "member-product-read"),
    ]);
    expect(theirs.notifications.map((row) => row.id)).toStrictEqual([adminRow]);
  });

  it("refuses to mark another user's row read, and the row stays unread", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");

    const res = await call(`/notifications/${adminRow}/read`, member, {
      method: "POST",
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toStrictEqual({
      error: { code: "not_found", message: "No such notification." },
    });
    await expect(unread(admin)).resolves.toBe(1);
  });

  it("answers 401 with no session", async () => {
    const res = await call("/notifications", "");

    expect(res.status).toBe(401);
  });
});

describe("unread count", () => {
  it("counts the caller's unread rows", async () => {
    const member = await signIn("member@example.test");

    await expect(unread(member)).resolves.toBe(2);
  });

  it("still counts an opted-out category's old rows", async () => {
    const member = await signIn("member@example.test");
    const off = await call("/notifications/preferences", member, {
      body: JSON.stringify({ categories: { product: false } }),
      method: "PUT",
    });
    expect(off.status).toBe(200);

    await expect(unread(member)).resolves.toBe(2);
  });
});

describe("mark read", () => {
  it("marks one row read, and a second call changes nothing", async () => {
    const member = await signIn("member@example.test");

    const first = await call(`/notifications/${memberRow}/read`, member, {
      method: "POST",
    });
    const before = await page(member);
    const second = await call(`/notifications/${memberRow}/read`, member, {
      method: "POST",
    });
    const after = await page(member);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(unread(member)).resolves.toBe(1);
    expect(after).toStrictEqual(before);
  });

  it("marks every unread row of the caller read, and no one else's", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");

    const res = await call("/notifications/read-all", member, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toStrictEqual({ marked: 2, ok: true });
    await expect(unread(member)).resolves.toBe(0);
    await expect(unread(admin)).resolves.toBe(1);
  });
});

describe("cursor paging", () => {
  it("walks every row once, across pages, newest first", async () => {
    const member = await signIn("member@example.test");
    const userId = seedId("users", "member");
    // 21 more rows makes 25, so a page of 20 leaves 5 for the second page. All 21 share
    // one `createdAt`, so the page boundary falls inside a tie and only the id can order
    // the rows across it.
    const createdAt = new Date("2026-02-01T09:00:00.000Z");
    const rows = Array.from({ length: 21 }, (_, index) => ({
      category: "product",
      createdAt,
      id: crypto.randomUUID(),
      title: `Row ${index}`,
      userId,
    }));
    // Two inserts, because D1 binds at most 100 values to one statement and 21 rows of
    // five values is 105.
    await database.db.insert(notifications).values(rows.slice(0, 11));
    await database.db.insert(notifications).values(rows.slice(11));

    const first = await page(member);
    expect(first.notifications).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(member, first.nextCursor ?? "");
    const ids = [...first.notifications, ...second.notifications].map(
      (row) => row.id
    );

    expect(second.notifications).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set(ids).size).toBe(25);
  });
});

describe("preferences", () => {
  it("lists each category with its copy and whether it is on", async () => {
    const member = await signIn("member@example.test");

    const res = await call("/notifications/preferences", member);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toStrictEqual({
      categories: [
        {
          description: "Sign-in, security, billing and membership changes.",
          enabled: true,
          id: "account",
          label: "Account",
          required: true,
        },
        {
          description: "New features, finished exports and project activity.",
          enabled: true,
          id: "product",
          label: "Product",
          required: false,
        },
      ],
    });
  });

  it("turns an optional category off for the caller only", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");

    await call("/notifications/preferences", member, {
      body: JSON.stringify({ categories: { product: false } }),
      method: "PUT",
    });
    const mine = await call("/notifications/preferences", member);
    const theirs = await call("/notifications/preferences", admin);

    const enabled = async (res: Response) =>
      (
        (await res.json()) as { categories: { id: string; enabled: boolean }[] }
      ).categories.find((category) => category.id === "product")?.enabled;
    await expect(enabled(mine)).resolves.toBeFalsy();
    await expect(enabled(theirs)).resolves.toBeTruthy();
  });

  it("refuses to turn a required category off with 400", async () => {
    const member = await signIn("member@example.test");

    const res = await call("/notifications/preferences", member, {
      body: JSON.stringify({ categories: { account: false, product: false } }),
      method: "PUT",
    });
    const after = await call("/notifications/preferences", member);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_input" },
    });
    // The refused body wrote nothing, its valid half included.
    expect(
      (
        (await after.json()) as { categories: { enabled: boolean }[] }
      ).categories.every((category) => category.enabled)
    ).toBeTruthy();
  });

  it("refuses an unknown category with 400", async () => {
    const member = await signIn("member@example.test");

    const res = await call("/notifications/preferences", member, {
      body: JSON.stringify({ categories: { marketing: false } }),
      method: "PUT",
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "invalid_input" },
    });
  });
});
