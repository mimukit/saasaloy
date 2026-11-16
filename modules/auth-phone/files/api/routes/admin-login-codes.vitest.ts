import { config } from "@repo/config";
import { users } from "@repo/db/schema/auth";
import { smsMessages } from "@repo/db/schema/sms-messages";
import { PHONE_WITH_PASSWORD } from "@repo/db/seed/phone-accounts";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import app from "../index";

// `GET /admin/login-codes`, the list behind the admin login codes screen. The codes go
// out through the real `/auth` endpoints and the `console` SMS provider, and the test
// reads each code back from the console log, as `auth-phone.test.ts` does. `auth-phone`
// ships this test only when testing is on and `admin` is installed, the same condition
// as the route.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };
const NEW_PHONE = "+12025550160";

interface LoginCodesBody {
  codes: {
    account: { email: string } | null;
    error: string | null;
    phone: string;
    purpose: string;
    sendStatus: string;
    state: string;
    triesLeft: number | null;
  }[];
}

let log: MockInstance<typeof console.log>;
let env: Record<string, unknown>;

function post(path: string, body: Record<string, unknown>) {
  return app.request(
    path,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env
  );
}

/** The cookie pair a sign-in set, under the instance's cookie name. */
async function signIn(path: string, email: string, prefix: string) {
  const res = await post(path, { email, password: "saasaloy-dev-password" });
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${prefix}session_token=`));
  return (line ?? "").split(";")[0] ?? "";
}

function adminCookie() {
  return signIn("/admin/auth/sign-in/email", "admin@example.test", "admin.");
}

function list(cookie?: string) {
  return app.request(
    "/admin/login-codes",
    { headers: cookie === undefined ? ORIGIN : { cookie, ...ORIGIN } },
    env
  );
}

/** The code in the last console text sent to `phone`. */
function codeSentTo(phone: string): string {
  const digits = config["auth-phone"].codeLength;
  const text = log.mock.calls
    .map((call) => String(call[0]))
    .findLast((block) => block.includes(`to:         ${phone}\n`));
  const match = new RegExp(`(\\d{${digits}}) is your `).exec(text ?? "");
  expect(match, `a code went to ${phone}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** Ask for a sign-up code for `NEW_PHONE` and return it. */
async function sendSignUpCode(): Promise<string> {
  const res = await post("/auth/phone-number/send-otp", {
    phoneNumber: NEW_PHONE,
  });
  expect(res.status).toBe(200);
  return codeSentTo(NEW_PHONE);
}

/** The list as an admin sees it, and the raw body text. */
async function adminList(): Promise<{ body: LoginCodesBody; raw: string }> {
  const res = await list(await adminCookie());
  expect(res.status).toBe(200);
  const raw = await res.text();
  return { body: JSON.parse(raw) as LoginCodesBody, raw };
}

describe("GET /admin/login-codes", () => {
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockReturnValue();
    env = {
      ...database.env,
      KV_KEY_PREFIX: `${crypto.randomUUID()}:`,
      KV_PROVIDER: "memory",
      SMS_PROVIDER: "console",
    };
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("answers 401 with no session, and to a client session", async () => {
    const client = await signIn(
      "/auth/sign-in/email",
      "member@example.test",
      "client."
    );

    const anonymous = await list();
    const signedIn = await list(client);

    expect(anonymous.status).toBe(401);
    expect(signedIn.status).toBe(401);
  });

  it("answers 403 to an admin session whose account lost the admin role", async () => {
    const cookie = await adminCookie();
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.email, "admin@example.test"));

    const res = await list(cookie);

    expect(res.status).toBe(403);
  });

  it("lists a sent sign-up code as live with every try left, and never the code", async () => {
    const code = await sendSignUpCode();

    const { body, raw } = await adminList();

    expect(body.codes).toHaveLength(1);
    expect(body.codes[0]).toMatchObject({
      account: null,
      phone: NEW_PHONE,
      purpose: "sign_up",
      sendStatus: "sent",
      state: "live",
      triesLeft: config["auth-phone"].codeAttempts,
    });
    expect(raw).not.toContain(code);
  });

  it("lowers the tries left after a wrong try", async () => {
    const code = await sendSignUpCode();
    const wrong = code.startsWith("0")
      ? code.replace("0", "1")
      : `0${code.slice(1)}`;
    const res = await post("/auth/phone-number/verify", {
      code: wrong,
      phoneNumber: NEW_PHONE,
    });
    expect(res.status).toBe(400);

    const { body, raw } = await adminList();

    expect(body.codes[0]).toMatchObject({
      state: "live",
      triesLeft: config["auth-phone"].codeAttempts - 1,
    });
    expect(raw).not.toContain(code);
  });

  it("lists a used code as ended, under the account it made", async () => {
    const code = await sendSignUpCode();
    const res = await post("/auth/phone-number/verify", {
      code,
      phoneNumber: NEW_PHONE,
    });
    expect(res.status).toBe(200);

    const { body, raw } = await adminList();

    expect(body.codes[0]).toMatchObject({
      account: { email: "12025550160@phone.invalid" },
      state: "ended",
      triesLeft: null,
    });
    expect(raw).not.toContain(code);
  });

  it("lists a reset code under its purpose, and an older code as ended", async () => {
    const send = () =>
      post("/auth/phone-number/request-password-reset", {
        phoneNumber: PHONE_WITH_PASSWORD,
      });
    const sentFirst = await send();
    const first = codeSentTo(PHONE_WITH_PASSWORD);
    const sentSecond = await send();
    const second = codeSentTo(PHONE_WITH_PASSWORD);
    expect([sentFirst.status, sentSecond.status]).toStrictEqual([200, 200]);

    const { body, raw } = await adminList();

    expect(
      body.codes.map((row) => [row.purpose, row.state, row.triesLeft])
    ).toStrictEqual([
      ["password_reset", "live", config["auth-phone"].codeAttempts],
      ["password_reset", "ended", null],
    ]);
    expect(raw).not.toContain(first);
    expect(raw).not.toContain(second);
  });

  it("masks a code in the error of a failed send", async () => {
    await database.db.insert(smsMessages).values({
      error: 'provider refused "482913 is your verification code"',
      provider: "console",
      purpose: "login_code",
      status: "failed",
      template: "verification-code",
      toPhone: NEW_PHONE,
    });

    const { body, raw } = await adminList();

    expect(body.codes[0]).toMatchObject({
      error: 'provider refused "•••••• is your verification code"',
      sendStatus: "failed",
    });
    expect(raw).not.toContain("482913");
  });
});
