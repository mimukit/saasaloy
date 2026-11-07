import { authDb } from "@repo/auth/server";
import {
  PHONE_RESET_REQUEST_PATH,
  PHONE_SEND_PATH,
  PHONE_SIGN_IN_PATH,
  isAllowedPhone,
} from "@repo/auth/phone-rules";
import { LOGIN_CODE_PURPOSE } from "@repo/auth/phone";
import { config } from "@repo/config";
import { findPhoneLogin } from "@repo/db/repositories/phone-logins";
import { countSmsSince } from "@repo/db/repositories/sms-messages";
import { createKv } from "@repo/kv";
import type { KvEnv } from "@repo/kv";
import type { LoggerVariables } from "@repo/logger";
import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { createMiddleware } from "hono/factory";
import {
  LOGIN_CODE_WINDOW_SECONDS,
  loginCodeLimitApplies,
  loginCodeRefusal,
  maskPhone,
  phoneKeyPart,
} from "./auth-phone-rules";
import { CLIENT_IP_HEADER, RATE_LIMIT_NAMESPACE, rateLimit } from "./ratelimit";

// `auth-phone`'s guards on `/auth`. This module's two `plugin-array` patches add
// `phoneSendGuard()` and `phoneSignInGuard()` to `authGuards` in `../routes/auth.ts`, so
// both run ahead of Better Auth, inside `withAuthScope`. Each owns a few POST paths and
// calls `next()` on every other one.
//
// They fill the gaps Better Auth's `phoneNumber()` plugin leaves open:
//
// - The send limits. One code per number per `resendSeconds`, and `codesPerHour` per
//   number in a rolling hour, sign-up and reset in one budget. They count `sms_messages`
//   rows, not a `ratelimit` budget, because `kv-cloudflare` counts in 10 s or 60 s
//   windows only. They are off under `SMS_PROVIDER=console`.
// - A reset for a number with no account. Better Auth answers success and sends nothing,
//   so the customer waits for a code that never comes. This answers 404 `no_account`.
// - A password sign-in. Better Auth answers a wrong password, an unknown number and an
//   account with no password the same way. This tells the last two apart, after the
//   `strict` limits, so the two answers give no extra guesses. A wrong password keeps
//   Better Auth's generic answer, and a banned account keeps `BANNED_USER`.
//
// The number is not secret here: a sign-up send already answers 409 for a number that
// has an account. A number that fails `isAllowedPhone` goes on to Better Auth, which
// answers its own 400.
//
// Every refusal writes one `auth result` line through `c.var.log`, with the phone masked
// to its last 4 digits.

interface GuardEnv {
  Bindings: KvEnv & { SMS_PROVIDER?: string };
  Variables: LoggerVariables;
}
type GuardContext = Context<GuardEnv>;

/** The refusals a support question needs, one log line each. */
type AuthResult = "no_account" | "no_password" | "rate_limited" | "send_failed";

function logResult(
  c: GuardContext,
  result: AuthResult,
  phone: string | null
): void {
  const fields = {
    path: c.req.path,
    phone: phone === null ? null : maskPhone(phone),
    result,
  };
  if (result === "send_failed") {
    c.var.log.error("auth result", fields);
  } else if (result === "rate_limited") {
    c.var.log.warn("auth result", fields);
  } else {
    c.var.log.info("auth result", fields);
  }
}

/** The api's error envelope. */
function refusal(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * Whether this is a POST to `path`, a Better Auth path with no base path. `c.req.path`
 * carries the mount prefix (`/auth/phone-number/send-otp`), so the match is on the end.
 */
function isPostTo(c: Context, path: string): boolean {
  return c.req.method === "POST" && c.req.path.endsWith(path);
}

/** The `phoneNumber` field of a JSON body, or `null` when there is none. */
async function requestedPhone(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "phoneNumber" in body &&
      typeof body.phoneNumber === "string"
    ) {
      return body.phoneNumber;
    }
  } catch {
    // Not JSON: Better Auth answers it with its own 400.
  }
  return null;
}

/** A number the server takes, or `null`, so Better Auth answers the rest itself. */
async function allowedPhone(request: Request): Promise<string | null> {
  const phone = await requestedPhone(request);
  return phone !== null &&
    isAllowedPhone(phone, config["auth-phone"].allowedPrefixes)
    ? phone
    : null;
}

/** The send limit's answer for `phone`, or `null` when the code may go. */
async function sendRefusal(phone: string) {
  const { codesPerHour, resendSeconds } = config["auth-phone"];
  const now = Date.now();
  const sentSince = (seconds: number) =>
    countSmsSince(authDb, {
      purpose: LOGIN_CODE_PURPOSE,
      since: new Date(now - seconds * 1000),
      toPhone: phone,
    });
  return loginCodeRefusal(
    {
      inHour: await sentSince(LOGIN_CODE_WINDOW_SECONDS),
      inResendWindow: await sentSince(resendSeconds),
    },
    { codesPerHour, resendSeconds }
  );
}

/**
 * The code sends: `send-otp` for a sign-up and `request-password-reset` for a set or a
 * reset. The reset code is the same SMS, so it spends the same budget.
 */
export function phoneSendGuard(): MiddlewareHandler<GuardEnv> {
  return async function phoneSend(c, next) {
    const reset = isPostTo(c, PHONE_RESET_REQUEST_PATH);
    if (!reset && !isPostTo(c, PHONE_SEND_PATH)) {
      return next();
    }
    const phone = await allowedPhone(c.req.raw);
    if (phone === null) {
      return next();
    }
    if (reset && (await findPhoneLogin(authDb, phone)) === null) {
      logResult(c, "no_account", phone);
      return c.json(refusal("no_account", "No account has this number."), 404);
    }
    if (loginCodeLimitApplies(c.env.SMS_PROVIDER)) {
      const refused = await sendRefusal(phone);
      if (refused) {
        logResult(c, "rate_limited", phone);
        return c.json(refusal("rate_limited", refused.message), 429, {
          "Retry-After": String(refused.retryAfterSeconds),
        });
      }
    }
    // The SMS goes out inside the request, so a provider failure answers 5xx here.
    // oxlint-disable-next-line node/callback-return
    await next();
    if (c.res.status >= 500) {
      logResult(c, "send_failed", phone);
    }
  };
}

/** A `strict` budget's key, built by the kv client so it carries `KV_KEY_PREFIX`. */
function strictKey(c: Context, budget: string, who: string): string {
  return createKv(c.env as KvEnv).key({
    namespace: RATE_LIMIT_NAMESPACE,
    // A `:` is not allowed in a key part, and an IPv6 address holds one.
    parts: ["strict", budget, who.replaceAll(":", "_")],
  });
}

/** Log the 429 a sign-in budget answers. Runs first, so it sees both budgets. */
const logRateLimited = createMiddleware<GuardEnv>(async (c, next) => {
  // oxlint-disable-next-line node/callback-return
  await next();
  if (c.res.status === 429) {
    logResult(c, "rate_limited", await requestedPhone(c.req.raw));
  }
});

/** The first budget: one client address. */
const limitByAddress = rateLimit({
  key: (c) =>
    strictKey(c, "sign-in-ip", c.req.header(CLIENT_IP_HEADER) ?? "unknown"),
  policy: "strict",
});

/**
 * The second budget: the number tried, so one number guessed at from many addresses
 * still meets the `strict` limit. The key keeps the digits only.
 */
const limitByPhone = createMiddleware<GuardEnv>(async (c, next) => {
  const digits = phoneKeyPart(await requestedPhone(c.req.raw));
  return rateLimit({
    key: (ctx) => strictKey(ctx, "sign-in-phone", digits),
    policy: "strict",
  })(c, next);
});

/** `no_account` and `no_password`, ahead of Better Auth's one generic answer. */
const signInResults = createMiddleware<GuardEnv>(async (c, next) => {
  const phone = await allowedPhone(c.req.raw);
  if (phone === null) {
    return next();
  }
  const login = await findPhoneLogin(authDb, phone);
  if (login === null) {
    logResult(c, "no_account", phone);
    return c.json(refusal("no_account", "No account has this number."), 401);
  }
  if (!login.hasPassword) {
    logResult(c, "no_password", phone);
    return c.json(
      refusal("no_password", "This account has no password yet."),
      401
    );
  }
  return next();
});

/** The password sign-in: two `strict` budgets, then the clear results. */
export function phoneSignInGuard(): MiddlewareHandler<GuardEnv> {
  const signIn = every(
    logRateLimited,
    limitByAddress,
    limitByPhone,
    signInResults
  );
  return function phoneSignIn(c, next) {
    return isPostTo(c, PHONE_SIGN_IN_PATH) ? signIn(c, next) : next();
  };
}
