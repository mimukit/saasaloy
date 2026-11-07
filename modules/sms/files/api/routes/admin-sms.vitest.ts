import { smsMessages } from "@repo/db/schema/sms-messages";
import { testDatabase } from "@repo/db/testing";
import { describe, expect, it } from "vitest";
import app from "../index";

// `GET /admin/sms`, the SMS log behind the admin screen. It runs against the seed: one
// sent text and one failed text whose error echoes a code. `sms` ships this test only when
// testing is on and `admin` and `database` are installed, the same condition as the route.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

interface SmsPage {
  messages: { id: string; error: string | null; status: string }[];
  total: number;
}

/** Sign the seeded admin in on the admin instance and return its cookie pair. */
async function adminCookie(env: object): Promise<string> {
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
    env
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("admin.session_token="));
  return (line ?? "").split(";")[0] ?? "";
}

async function list(env: object, query = "", cookie?: string) {
  return app.request(
    `/admin/sms${query}`,
    { headers: cookie === undefined ? ORIGIN : { cookie, ...ORIGIN } },
    env
  );
}

describe("GET /admin/sms", () => {
  it("refuses a caller with no admin session", async () => {
    const res = await list(database.env);

    expect(res.status).toBe(401);
  });

  it("masks a code in a provider error", async () => {
    const cookie = await adminCookie(database.env);

    const res = await list(database.env, "?status=failed", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SmsPage;
    expect(body.messages.map((row) => row.error)).toStrictEqual([
      'provider refused "•••••• is your verification code"',
    ]);
  });

  it("filters by status", async () => {
    const cookie = await adminCookie(database.env);

    const res = await list(database.env, "?status=sent", cookie);
    const body = (await res.json()) as SmsPage;
    expect(body.total).toBe(1);
    expect(body.messages.map((row) => row.status)).toStrictEqual(["sent"]);
  });

  it("lists the newest text first", async () => {
    await database.db.insert(smsMessages).values({
      createdAt: new Date(Date.now() + 60_000),
      id: "newest",
      provider: "console",
      purpose: "sign_up",
      status: "sent",
      template: "verification-code",
      toPhone: "+15555550102",
    });
    const cookie = await adminCookie(database.env);

    const res = await list(database.env, "", cookie);
    const body = (await res.json()) as SmsPage;
    expect(body.messages[0]?.id).toBe("newest");
    expect(body.total).toBe(3);
  });

  it("refuses a page that is not a whole number from 1", async () => {
    const cookie = await adminCookie(database.env);

    const res = await list(database.env, "?page=0", cookie);
    expect(res.status).toBe(400);
  });
});
