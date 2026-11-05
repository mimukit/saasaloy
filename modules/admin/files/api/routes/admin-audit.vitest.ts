import { AUDIENCE_HEADER, SUPERADMIN_ROLE } from "@repo/auth/server";
import { insertAuditEvents } from "@repo/db/repositories/audit";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// The Activity page's api: paging, the filters, the chip counts, and a cursor the api did
// not hand out. The seed holds two rows from 2026-01-01; each test adds its own on top.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const SUPERADMIN = seedId("users", "superadmin");
const ADMIN = seedId("users", "admin");

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

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
  const name = "admin.session_token";
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  return `${name}=${(line ?? "").slice(name.length + 1).split(";")[0] ?? ""}`;
}

function get(path: string, cookie?: string) {
  return app.request(
    path,
    {
      headers: {
        [AUDIENCE_HEADER]: "admin",
        ...ORIGIN,
        ...(cookie === undefined ? {} : { cookie }),
      },
    },
    database.env
  );
}

interface Page {
  events: {
    id: string;
    action: string;
    label: string;
    area: string | null;
    actor: { id: string };
    target: { label: string };
    createdAt: string;
  }[];
  counts: Record<string, number>;
  areas: { id: string; label: string }[];
  nextCursor: string | null;
}

async function page(path: string, cookie: string): Promise<Page> {
  const res = await get(path, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** 55 `member.add` rows by the superadmin, one a minute, newest first from `newest`. */
async function addRows(newest: Date) {
  await insertAuditEvents(
    database.db,
    Array.from({ length: 55 }, (_, index) => ({
      action: "member.add",
      actorRole: SUPERADMIN_ROLE,
      actorUserId: SUPERADMIN,
      after: { email: `user-${index}@example.test` },
      before: null,
      createdAt: new Date(newest.getTime() - index * 60_000),
      targetId: `user-${index}`,
      targetLabel: `user-${index}@example.test`,
      targetType: "member",
    }))
  );
}

describe("GET /admin/audit-events", () => {
  it("answers the first page of 50, newest first, with a cursor", async () => {
    await addRows(new Date("2026-06-01T12:00:00.000Z"));

    const first = await page("/admin/audit-events", await adminCookie());

    expect(first.events).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(first.events[0]?.target.label).toBe("user-0@example.test");
    // 55 added plus the seed's two.
    expect(first.counts.all).toBe(57);
  });

  it("pages on by the cursor, with no row twice and none lost", async () => {
    await addRows(new Date("2026-06-01T12:00:00.000Z"));
    const cookie = await adminCookie();
    const first = await page("/admin/audit-events", cookie);

    const second = await page(
      `/admin/audit-events?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      cookie
    );

    expect(second.events).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(ids).size).toBe(57);
  });

  it("sends each row's words and every area's words", async () => {
    const body = await page("/admin/audit-events", await adminCookie());

    expect(body.events[0]).toMatchObject({
      action: "member.profile.update",
      area: "members",
      label: "Changed a name",
    });
    expect(body.areas).toContainEqual({ id: "members", label: "Members" });
  });

  it("filters by person, range and target search", async () => {
    await addRows(new Date("2026-06-01T12:00:00.000Z"));
    const cookie = await adminCookie();

    const byAdmin = await page(`/admin/audit-events?actor=${ADMIN}`, cookie);
    const fromJune = await page(
      `/admin/audit-events?from=${encodeURIComponent("2026-06-01T11:55:00.000Z")}`,
      cookie
    );
    const searched = await page("/admin/audit-events?q=USER-1%40", cookie);

    expect(byAdmin.events.map((event) => event.action)).toStrictEqual([
      "member.profile.update",
    ]);
    expect(fromJune.events).toHaveLength(6);
    expect(searched.events.map((event) => event.target.label)).toStrictEqual([
      "user-1@example.test",
    ]);
  });

  it("filters by area and a limit, and counts the chips without the area", async () => {
    await addRows(new Date("2026-06-01T12:00:00.000Z"));
    const cookie = await adminCookie();

    const noArea = await page("/admin/audit-events?area=nothing-here", cookie);
    const limited = await page("/admin/audit-events?limit=3", cookie);

    expect(noArea.events).toStrictEqual([]);
    expect(noArea.counts.members).toBe(57);
    expect(limited.events).toHaveLength(3);
  });

  it.each(["nonsense", "2026~", "1~abc", "2026-06-01T12:00:00Z~a~b"])(
    "answers 400 to the cursor %s, which it did not hand out",
    async (cursor) => {
      const res = await get(
        `/admin/audit-events?cursor=${encodeURIComponent(cursor)}`,
        await adminCookie()
      );

      expect(res.status).toBe(400);
    }
  );

  it("answers 401 to a signed-out caller, even with a bad cursor", async () => {
    const res = await get("/admin/audit-events?cursor=nonsense&limit=0");

    expect(res.status).toBe(401);
  });
});

describe("GET /admin/audit-events/people", () => {
  it("lists the admin group", async () => {
    const res = await get("/admin/audit-events/people", await adminCookie());

    expect(res.status).toBe(200);
    const { people } = (await res.json()) as { people: { id: string }[] };
    expect(people.map((person) => person.id)).toStrictEqual(
      expect.arrayContaining([ADMIN, SUPERADMIN])
    );
  });
});
