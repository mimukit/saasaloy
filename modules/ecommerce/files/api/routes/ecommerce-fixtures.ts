import { AUDIENCE_HEADER } from "@repo/auth/server";
import type { TestDatabase } from "@repo/db/testing";
import { payment } from "@repo/payment";
import type { PaymentProvider } from "@repo/payment";
import { manual } from "@repo/payment/providers/manual";
import { env as workerEnv } from "cloudflare:workers";
import { afterAll, beforeAll, expect } from "vitest";
import app from "../index";

// What the shop's route tests share: an env, sign-in helpers for both sessions, and the
// payment methods the tests pay with.
//
// The project's own `manual()` registration may switch no method on, so `shopPayments()`
// swaps in one with `cod` and `bkash` for the test file and puts the project's back
// afterwards. `console` stays as registered and takes `card`. The descriptor ships these
// tests only when `payment-manual` and `payment-console` are installed.

export const ORIGIN = { origin: "http://localhost:3000" };
export const PASSWORD = "saasaloy-dev-password";

/** The seeded phone account that signs in with the dev password, its phone verified. */
export const VERIFIED_PHONE = "+12025550101";

/** The Worker's env, this test's database, and the provider keys the shop tests use. */
export function shopEnv(database: TestDatabase): object {
  return {
    ...(workerEnv as object),
    ...database.env,
    PAYMENT_PROVIDER: "manual,console",
    SMS_PROVIDER: "console",
    STORAGE_PROVIDER: "memory",
    STORAGE_PUBLIC_URL: "http://localhost:4000/files/public",
    STORAGE_URL_SECRET: "test-storage-secret-test-storage-32",
  };
}

/** Swap in a manual provider with `cod` and `bkash` on, for the whole test file. */
export function shopPayments(): void {
  let saved: PaymentProvider[] = [];
  beforeAll(() => {
    saved = [...payment.providers];
    const configured = manual({
      methods: { bkash: { account: "01712345678", kind: "personal" }, cod: {} },
    });
    const at = payment.providers.findIndex((p) => p.name === "manual");
    if (at === -1) {
      payment.providers.push(configured);
    } else {
      payment.providers[at] = configured;
    }
  });
  afterAll(() => {
    payment.providers.splice(0, payment.providers.length, ...saved);
  });
}

function cookieOf(res: Response, name: string): string {
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  expect(line, `the response sets ${name}`).toBeDefined();
  return (line ?? "").split(";")[0] ?? "";
}

async function post(
  database: TestDatabase,
  path: string,
  body: unknown
): Promise<Response> {
  return await app.request(
    path,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    shopEnv(database)
  );
}

/** Sign a seeded user in on the client session by email; the cookie pair. */
export async function clientByEmail(
  database: TestDatabase,
  email: string
): Promise<string> {
  const res = await post(database, "/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  return cookieOf(res, "client.session_token");
}

/** Sign the seeded phone account in on the client session; the cookie pair. */
export async function clientByPhone(
  database: TestDatabase,
  phoneNumber = VERIFIED_PHONE
): Promise<string> {
  const res = await post(database, "/auth/sign-in/phone-number", {
    password: PASSWORD,
    phoneNumber,
  });
  expect(res.status).toBe(200);
  return cookieOf(res, "client.session_token");
}

/** Sign a seeded staff account in on the admin session; the cookie pair. */
export async function adminSession(
  database: TestDatabase,
  email = "admin@example.test"
): Promise<string> {
  const res = await post(database, "/admin/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  return cookieOf(res, "admin.session_token");
}

/** A request with a cookie and a JSON body. `admin` sends the admin audience header. */
export async function call(
  database: TestDatabase,
  path: string,
  options: {
    cookie?: string;
    method?: string;
    body?: unknown;
    admin?: boolean;
  } = {}
): Promise<Response> {
  return await app.request(
    path,
    {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        "content-type": "application/json",
        ...ORIGIN,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.admin ? { [AUDIENCE_HEADER]: "admin" } : {}),
      },
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    },
    shopEnv(database)
  );
}

/** A response's status and parsed body, so one assertion reads both. */
export async function answer(
  res: Response
): Promise<{ status: number; body: unknown }> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: keep the text, so a failed assertion still shows it.
  }
  return { body, status: res.status };
}

/** A Dhaka address, as checkout and the "New order" page take one. */
export const ADDRESS = {
  city: "Dhaka",
  line1: "House 12, Road 7",
  name: "Rahim Uddin",
  phone: "+8801712345678",
};
