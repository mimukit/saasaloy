import { config } from "@repo/config";
import { accounts, sessions, users, verifications } from "@repo/db/schema/auth";
import { smsMessages } from "@repo/db/schema/sms-messages";
import {
  PHONE_WITHOUT_PASSWORD,
  PHONE_WITH_PASSWORD,
} from "@repo/db/seed/phone-accounts";
import { testDatabase } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import app from "../index";

// Phone sign-up and the reset code, through the real `/auth` endpoints. The code goes out
// through the real `@repo/sms` with the `console` provider, which `apps/api/.env` selects
// (`SMS_PROVIDER=console`), and the test reads it back from the console log, as a
// developer reads it in the terminal.
//
// `allowedPrefixes` is set to `+1202` for this file, so the seed numbers pass and a
// London number does not.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

vi.mock(import("@repo/config"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    config: {
      ...original.config,
      "auth-phone": {
        ...original.config["auth-phone"],
        allowedPrefixes: ["+1202"],
      },
    },
  };
});

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };
const NEW_PHONE = "+12025550150";
const NEW_PASSWORD = "a-new-phone-password";
const RESET_IDENTIFIER = `${PHONE_WITH_PASSWORD}-request-password-reset`;

let log: MockInstance<typeof console.log>;

/**
 * The bindings a request sees: this file's database, the console SMS provider, so the
 * send limits stay off, and the memory store under a prefix of its own for each test, so
 * the `strict` sign-in budgets never carry from one test to the next.
 */
let env: Record<string, unknown>;

function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return app.request(
    `/auth${path}`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...ORIGIN, ...headers },
      method: "POST",
    },
    env
  );
}

/** The `cookie` header that carries the session a response set. */
function sessionCookie(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Sign `NEW_PHONE` up by code, and the session cookie `verify` set. */
async function signUpByCode(): Promise<string> {
  await post("/phone-number/send-otp", { phoneNumber: NEW_PHONE });
  const res = await post("/phone-number/verify", {
    code: codeSentTo(NEW_PHONE),
    phoneNumber: NEW_PHONE,
  });
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

/** The console provider's blocks sent to `phone`, in send order. */
function textsTo(phone: string): string[] {
  return log.mock.calls
    .map((call) => String(call[0]))
    .filter((text) => text.includes(`to:         ${phone}\n`));
}

/** The code in the last text sent to `phone`. */
function codeSentTo(phone: string): string {
  const digits = config["auth-phone"].codeLength;
  const match = new RegExp(`(\\d{${digits}}) is your `).exec(
    textsTo(phone).at(-1) ?? ""
  );
  expect(match, `a code went to ${phone}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** A code of the right length that is not `code`. */
function wrong(code: string): string {
  return code.startsWith("0") ? code.replace("0", "1") : `0${code.slice(1)}`;
}

async function userByPhone(phone: string) {
  const [row] = await database.db
    .select()
    .from(users)
    .where(eq(users.phoneNumber, phone));
  return row;
}

async function resetCode(phone: string): Promise<string> {
  const res = await post("/phone-number/request-password-reset", {
    phoneNumber: phone,
  });
  expect(res.status).toBe(200);
  return codeSentTo(phone);
}

function checkResetCode(otp: string) {
  return post("/phone-number/check-reset-code", {
    otp,
    phoneNumber: PHONE_WITH_PASSWORD,
  });
}

/** The stored reset code values for the seeded phone account. */
async function storedResetValues(): Promise<string[]> {
  const rows = await database.db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, RESET_IDENTIFIER));
  return rows.map((row) => row.value);
}

describe("phone sign-in", () => {
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

  describe("sign-up", () => {
    it("creates a client with a verified phone and the placeholder email, even as the first user", async () => {
      // An empty users table, where the first-user rule would make an email sign-up a
      // superadmin.
      await database.db.delete(sessions);
      await database.db.delete(accounts);
      await database.db.delete(users);

      const sent = await post("/phone-number/send-otp", {
        phoneNumber: NEW_PHONE,
      });
      expect(sent.status).toBe(200);
      const res = await post("/phone-number/verify", {
        code: codeSentTo(NEW_PHONE),
        phoneNumber: NEW_PHONE,
      });

      expect(res.status).toBe(200);
      await expect(userByPhone(NEW_PHONE)).resolves.toMatchObject({
        email: "12025550150@phone.invalid",
        phoneNumberVerified: true,
        role: "user",
      });
    });

    it("still makes the first email sign-up a superadmin", async () => {
      // The phone skip in `auth.ts`'s first-user hook keys on the path, so an email
      // sign-up on the same empty table keeps the superadmin rule.
      await database.db.delete(sessions);
      await database.db.delete(accounts);
      await database.db.delete(users);

      const res = await post("/sign-up/email", {
        email: "first@example.test",
        name: "First",
        password: NEW_PASSWORD,
      });

      expect(res.status).toBe(200);
      const [row] = await database.db
        .select()
        .from(users)
        .where(eq(users.email, "first@example.test"));
      expect(row).toMatchObject({ role: config.auth.superadminRole });
    });

    it("answers 409 PHONE_NUMBER_EXIST for a number that has an account, and sends nothing", async () => {
      const send = await post("/phone-number/send-otp", {
        phoneNumber: PHONE_WITH_PASSWORD,
      });
      const verify = await post("/phone-number/verify", {
        code: "123456",
        phoneNumber: PHONE_WITH_PASSWORD,
      });

      expect(send.status).toBe(409);
      await expect(send.json()).resolves.toMatchObject({
        code: "PHONE_NUMBER_EXIST",
      });
      expect(verify.status).toBe(409);
      expect(textsTo(PHONE_WITH_PASSWORD)).toHaveLength(0);
    });

    it("refuses a number outside allowedPrefixes, and sends nothing", async () => {
      const res = await post("/phone-number/send-otp", {
        phoneNumber: "+447700900123",
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_PHONE_NUMBER",
      });
      expect(textsTo("+447700900123")).toHaveLength(0);
    });

    it("logs each code in sms_messages without the code", async () => {
      await post("/phone-number/send-otp", { phoneNumber: NEW_PHONE });
      const signUp = codeSentTo(NEW_PHONE);
      const reset = await resetCode(PHONE_WITH_PASSWORD);

      const rows = await database.db.select().from(smsMessages);
      const mine = rows.filter((row) =>
        [NEW_PHONE, PHONE_WITH_PASSWORD].includes(row.toPhone)
      );
      expect(
        mine.map((row) => [row.toPhone, row.template]).toSorted()
      ).toStrictEqual([
        [PHONE_WITH_PASSWORD, "password-reset-code"],
        [NEW_PHONE, "verification-code"],
      ]);
      for (const row of mine) {
        expect(row).toMatchObject({
          provider: "console",
          purpose: "login_code",
          status: "sent",
        });
        expect(JSON.stringify(row)).not.toMatch(
          new RegExp(`${signUp}|${reset}`)
        );
      }
    });
  });

  describe("seed", () => {
    it("signs the seeded phone account in with the dev password", async () => {
      const res = await post("/sign-in/phone-number", {
        password: "saasaloy-dev-password",
        phoneNumber: PHONE_WITH_PASSWORD,
      });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /auth/phone-number/check-reset-code", () => {
    it("keeps a right code, so reset-password takes it and the new password signs in", async () => {
      const code = await resetCode(PHONE_WITH_PASSWORD);

      const check = await checkResetCode(code);
      expect(check.status).toBe(200);
      const reset = await post("/phone-number/reset-password", {
        newPassword: NEW_PASSWORD,
        otp: code,
        phoneNumber: PHONE_WITH_PASSWORD,
      });
      expect(reset.status).toBe(200);
      const signIn = await post("/sign-in/phone-number", {
        password: NEW_PASSWORD,
        phoneNumber: PHONE_WITH_PASSWORD,
      });
      expect(signIn.status).toBe(200);
    });

    it("spends one try on a wrong code", async () => {
      const code = await resetCode(PHONE_WITH_PASSWORD);

      const res = await checkResetCode(wrong(code));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: "INVALID_OTP" });
      await expect(storedResetValues()).resolves.toStrictEqual([`${code}:1`]);
    });

    it("throws the code away after three wrong tries, so the right one fails too", async () => {
      const code = await resetCode(PHONE_WITH_PASSWORD);
      for (let i = 0; i < config["auth-phone"].codeAttempts; i += 1) {
        await checkResetCode(wrong(code));
      }

      const res = await checkResetCode(code);

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "TOO_MANY_ATTEMPTS",
      });
      await expect(storedResetValues()).resolves.toHaveLength(0);
    });
  });

  describe("POST /auth/phone-number/reset-password", () => {
    it("sets a first password and marks the phone verified", async () => {
      await expect(userByPhone(PHONE_WITHOUT_PASSWORD)).resolves.toMatchObject({
        phoneNumberVerified: false,
      });
      const code = await resetCode(PHONE_WITHOUT_PASSWORD);

      const res = await post("/phone-number/reset-password", {
        newPassword: NEW_PASSWORD,
        otp: code,
        phoneNumber: PHONE_WITHOUT_PASSWORD,
      });

      expect(res.status).toBe(200);
      await expect(userByPhone(PHONE_WITHOUT_PASSWORD)).resolves.toMatchObject({
        phoneNumberVerified: true,
      });
    });
  });

  describe("POST /auth/phone-number/set-password", () => {
    it("gives a new phone account its first password, which then signs in", async () => {
      const cookie = await signUpByCode();

      const res = await post(
        "/phone-number/set-password",
        { newPassword: NEW_PASSWORD },
        { cookie }
      );

      expect(res.status).toBe(200);
      const signIn = await post("/sign-in/phone-number", {
        password: NEW_PASSWORD,
        phoneNumber: NEW_PHONE,
      });
      expect(signIn.status).toBe(200);
    });

    it("answers 409 PASSWORD_ALREADY_SET and keeps the first password", async () => {
      const cookie = await signUpByCode();
      await post(
        "/phone-number/set-password",
        { newPassword: NEW_PASSWORD },
        { cookie }
      );

      const res = await post(
        "/phone-number/set-password",
        { newPassword: "a-second-phone-password" },
        { cookie }
      );

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        code: "PASSWORD_ALREADY_SET",
      });
      const signIn = await post("/sign-in/phone-number", {
        password: NEW_PASSWORD,
        phoneNumber: NEW_PHONE,
      });
      expect(signIn.status).toBe(200);
    });

    it("refuses a password under the minimum length", async () => {
      const cookie = await signUpByCode();

      const res = await post(
        "/phone-number/set-password",
        { newPassword: "short" },
        { cookie }
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "PASSWORD_TOO_SHORT",
      });
    });

    it("answers 401 with no session", async () => {
      const res = await post("/phone-number/set-password", {
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(401);
    });
  });
});
