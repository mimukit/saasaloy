import { users, verifications } from "@repo/db/schema/auth";
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

// `auth-phone`'s guards on `/auth`, through the real endpoints: the send limits, the clear
// sign-in and reset results, the `strict` sign-in budgets and the masked `auth result`
// log lines.
//
// The send limits are off under `SMS_PROVIDER=console`, and the console provider is the
// only one a fresh project holds. So a limit test hands the request `SMS_PROVIDER=gateway`,
// a name only the guard reads. The code itself still goes out through the console
// provider: `@repo/auth` sends with the env from `cloudflare:workers`, which reads
// `apps/api/.env`. No fake provider ships.
//
// `allowedPrefixes` is `+1202` for this file, so the seed numbers pass and a London
// number does not. `FAILING_PHONE` makes the send throw, as a gateway outage would.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const FAILING_PHONE = "+12025550199";

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

vi.mock(import("@repo/sms"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createSms: (smsEnv) => {
      const sender = original.createSms(smsEnv);
      return {
        ...sender,
        provider: sender.provider,
        send: (message) =>
          message.to === FAILING_PHONE
            ? Promise.reject(new Error("gateway down"))
            : sender.send(message),
      };
    },
  };
});

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };
const NEW_PHONE = "+12025550150";
const LONDON_PHONE = "+447700900123";
const WRONG_PASSWORD = "not-the-dev-password";

/** Every `console` call the test makes, by method. The logger and the SMS print here. */
let output: MockInstance<(...args: unknown[]) => void>[];

/** The bindings each request sees. The kv prefix is new for each test. */
let env: Record<string, unknown>;

function post(
  path: string,
  body: Record<string, unknown>,
  options: { ip?: string; smsProvider?: string } = {}
) {
  return app.request(
    `/auth${path}`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...ORIGIN,
        ...(options.ip ? { "cf-connecting-ip": options.ip } : {}),
      },
      method: "POST",
    },
    { ...env, SMS_PROVIDER: options.smsProvider ?? "console" }
  );
}

function sendCode(phone: string, smsProvider = "gateway") {
  return post(
    "/phone-number/send-otp",
    { phoneNumber: phone },
    { smsProvider }
  );
}

function resetCode(phone: string, smsProvider = "gateway") {
  return post(
    "/phone-number/request-password-reset",
    { phoneNumber: phone },
    { smsProvider }
  );
}

function signIn(
  phone: string,
  password = "saasaloy-dev-password",
  ip?: string
) {
  return post(
    "/sign-in/phone-number",
    { password, phoneNumber: phone },
    { ip }
  );
}

/** The console provider's texts to `phone`. */
function textsTo(phone: string): string[] {
  return output
    .flatMap((spy) => spy.mock.calls.map((call) => call[0]))
    .filter(
      (text): text is string =>
        typeof text === "string" && text.includes(`to:         ${phone}\n`)
    );
}

/** The logger's events: the structured objects, not the console provider's texts. */
function logEvents(): Record<string, unknown>[] {
  return output.flatMap((spy) =>
    spy.mock.calls
      .map((call) => call[0])
      .filter(
        (event): event is Record<string, unknown> =>
          typeof event === "object" && event !== null
      )
  );
}

/** The `auth result` events' fields, in the order they were written. */
function authResults(): Record<string, unknown>[] {
  return logEvents()
    .filter((event) => event.message === "auth result")
    .toSorted((a, b) => String(a.time).localeCompare(String(b.time)))
    .map((event) => event.fields as Record<string, unknown>);
}

/** Write `count` sent codes to `phone`, the newest `minutesAgo` minutes old. */
async function codesSent(phone: string, count: number, minutesAgo: number) {
  for (let i = 0; i < count; i += 1) {
    await database.db.insert(smsMessages).values({
      createdAt: new Date(Date.now() - (minutesAgo + i) * 60_000),
      provider: "gateway",
      purpose: "login_code",
      status: "sent",
      template: "verification-code",
      toPhone: phone,
    });
  }
}

/**
 * Hold the clock still. The memory store counts in fixed windows on 10 s boundaries, and
 * eleven password hashes can take long enough to cross one, which would start a second
 * budget halfway through the test.
 */
function inOneWindow() {
  vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
}

async function errorCode(res: Response): Promise<unknown> {
  const body = (await res.json()) as { error?: { code?: unknown } };
  return body.error?.code;
}

describe("auth-phone guards", () => {
  beforeEach(() => {
    output = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) =>
        vi.spyOn(console, method).mockReturnValue() as MockInstance<
          (...args: unknown[]) => void
        >
    );
    env = {
      ...database.env,
      KV_KEY_PREFIX: `${crypto.randomUUID()}:`,
      KV_PROVIDER: "memory",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const spy of output) {
      spy.mockRestore();
    }
  });

  describe("send limits", () => {
    it("answers 429 to a resend inside the wait, and sends nothing", async () => {
      const first = await sendCode(NEW_PHONE);
      expect(first.status).toBe(200);

      const res = await sendCode(NEW_PHONE);

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "rate_limited" },
      });
      expect(textsTo(NEW_PHONE)).toHaveLength(1);
    });

    it("answers 429 to a 6th code in an hour, and lets the 5th go", async () => {
      await codesSent(NEW_PHONE, 4, 2);
      const fifth = await sendCode(NEW_PHONE);
      expect(fifth.status).toBe(200);
      await database.db
        .update(smsMessages)
        .set({ createdAt: new Date(Date.now() - 90_000) })
        .where(eq(smsMessages.toPhone, NEW_PHONE));

      const res = await sendCode(NEW_PHONE);

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(textsTo(NEW_PHONE)).toHaveLength(1);
    });

    it("spends one budget on a reset and a sign-up code", async () => {
      await codesSent(PHONE_WITHOUT_PASSWORD, 5, 2);

      const res = await resetCode(PHONE_WITHOUT_PASSWORD);

      expect(res.status).toBe(429);
      expect(textsTo(PHONE_WITHOUT_PASSWORD)).toHaveLength(0);
    });

    it("lets every send go under the console provider", async () => {
      await codesSent(NEW_PHONE, 5, 0);
      await codesSent(PHONE_WITHOUT_PASSWORD, 5, 0);

      const signUp = await sendCode(NEW_PHONE, "console");
      const reset = await resetCode(PHONE_WITHOUT_PASSWORD, "console");

      expect(signUp.status).toBe(200);
      expect(reset.status).toBe(200);
      expect(textsTo(NEW_PHONE)).toHaveLength(1);
      expect(textsTo(PHONE_WITHOUT_PASSWORD)).toHaveLength(1);
    });
  });

  describe("POST /auth/phone-number/request-password-reset", () => {
    it("answers 404 no_account for an unknown number, and writes and sends nothing", async () => {
      const res = await resetCode(NEW_PHONE, "console");

      expect(res.status).toBe(404);
      await expect(errorCode(res)).resolves.toBe("no_account");
      expect(textsTo(NEW_PHONE)).toHaveLength(0);
      await expect(
        database.db
          .select()
          .from(verifications)
          .where(
            eq(verifications.identifier, `${NEW_PHONE}-request-password-reset`)
          )
      ).resolves.toHaveLength(0);
      await expect(
        database.db
          .select()
          .from(smsMessages)
          .where(eq(smsMessages.toPhone, NEW_PHONE))
      ).resolves.toHaveLength(0);
    });

    it("sends a reset code to a number that has an account", async () => {
      const res = await resetCode(PHONE_WITHOUT_PASSWORD, "console");

      expect(res.status).toBe(200);
      expect(textsTo(PHONE_WITHOUT_PASSWORD)).toHaveLength(1);
    });
  });

  describe("POST /auth/sign-in/phone-number", () => {
    it("answers 401 no_account for an unknown number", async () => {
      const res = await signIn(NEW_PHONE);

      expect(res.status).toBe(401);
      await expect(errorCode(res)).resolves.toBe("no_account");
    });

    it("answers 401 no_password for an account with no password", async () => {
      const res = await signIn(PHONE_WITHOUT_PASSWORD);

      expect(res.status).toBe(401);
      await expect(errorCode(res)).resolves.toBe("no_password");
    });

    it("keeps Better Auth's generic answer for a wrong password", async () => {
      const res = await signIn(PHONE_WITH_PASSWORD, WRONG_PASSWORD);

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_PHONE_NUMBER_OR_PASSWORD",
      });
    });

    it("keeps BANNED_USER for a banned account", async () => {
      await database.db
        .update(users)
        .set({ banned: true })
        .where(eq(users.phoneNumber, PHONE_WITH_PASSWORD));

      const res = await signIn(PHONE_WITH_PASSWORD);

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: "BANNED_USER" });
    });

    it("lets a number outside allowedPrefixes reach Better Auth's own 400", async () => {
      const res = await signIn(LONDON_PHONE);

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_PHONE_NUMBER",
      });
    });

    it("answers 429 after the strict budget from one address", async () => {
      inOneWindow();
      for (let i = 0; i < 10; i += 1) {
        const res = await signIn(
          `+120255502${String(i).padStart(2, "0")}`,
          WRONG_PASSWORD,
          "203.0.113.7"
        );
        expect(res.status).toBe(401);
      }

      const res = await signIn(NEW_PHONE, WRONG_PASSWORD, "203.0.113.7");

      expect(res.status).toBe(429);
      await expect(errorCode(res)).resolves.toBe("rate_limited");
      expect(res.headers.get("Retry-After")).not.toBeNull();
    });

    it("answers 429 after the strict budget on one number from many addresses", async () => {
      inOneWindow();
      for (let i = 0; i < 10; i += 1) {
        const res = await signIn(
          PHONE_WITH_PASSWORD,
          WRONG_PASSWORD,
          `2001:db8::${String(i + 1)}`
        );
        expect(res.status).toBe(401);
      }

      const res = await signIn(
        PHONE_WITH_PASSWORD,
        WRONG_PASSWORD,
        "2001:db8::99"
      );

      expect(res.status).toBe(429);
    });
  });

  describe("auth result log lines", () => {
    it("logs one line per refusal, with the phone masked to its last 4 digits", async () => {
      await resetCode(NEW_PHONE, "console");
      await signIn(PHONE_WITHOUT_PASSWORD);
      await sendCode(FAILING_PHONE);
      await sendCode(FAILING_PHONE);

      expect(authResults()).toStrictEqual([
        expect.objectContaining({ phone: "…0150", result: "no_account" }),
        expect.objectContaining({ phone: "…0102", result: "no_password" }),
        expect.objectContaining({ phone: "…0199", result: "send_failed" }),
        expect.objectContaining({ phone: "…0199", result: "rate_limited" }),
      ]);
    });

    it("never writes a full phone number to a log line", async () => {
      await resetCode(NEW_PHONE, "console");
      await signIn(NEW_PHONE);
      await signIn(PHONE_WITHOUT_PASSWORD);
      await sendCode(FAILING_PHONE);
      await sendCode(FAILING_PHONE);

      // Every console write but the console provider's own texts, which print the
      // number on purpose: they are the SMS, not a log line.
      const lines = output
        .flatMap((spy) => spy.mock.calls)
        .map((call) => JSON.stringify(call))
        .filter((line) => !line.includes("to:         "));
      expect(authResults().length).toBeGreaterThan(0);
      for (const phone of [NEW_PHONE, PHONE_WITHOUT_PASSWORD, FAILING_PHONE]) {
        const digits = phone.slice(1);
        for (const line of lines) {
          expect(line).not.toContain(digits);
        }
      }
    });
  });
});
