import { createClient } from "@repo/auth/client";
import { toE164 } from "@repo/auth/phone-rules";
import { config } from "@repo/config";
import { webEnv } from "@web/env";

// The shop's sign-in on `apps/web` (plan 0106, Q22): the client-group Better Auth client
// over `PUBLIC_API_URL`, and the phone steps checkout and the orders page run through it.
// `apps/web` had no auth client before `ecommerce`; this file is it.
//
// The session cookie is set by the api. It reaches the api from this site because the
// client sends `credentials: "include"`, and the api's CORS list names this origin. In
// production the web and api hosts must share a parent domain (`crossSubDomainCookies` in
// `packages/auth/src/auth.ts`), or the browser keeps the cookie from the shop.
//
// Every phone call goes through `$fetch`, not the typed `auth.phoneNumber.*`: the typed
// client drops the `signIn` key a code sign-in needs.

export const auth = createClient(webEnv().PUBLIC_API_URL);

/** The `auth-phone` config section: code length, resend wait, country code, code sign-in. */
export const phoneRules = config["auth-phone"];

/** The fields of the client session checkout reads. `auth-phone` adds the phone pair. */
export interface ShopSessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
}

/** The signed-in buyer, or null. A failed read counts as signed out. */
export async function currentBuyer(): Promise<ShopSessionUser | null> {
  try {
    const { data } = await auth.getSession();
    return (data?.user as ShopSessionUser | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * How the buyer's identity stands for checkout: a verified phone, a verified email the
 * shop accepts in place of one, or nothing yet (plan 0106, "Checkout identity").
 */
export function verifiedContact(
  user: ShopSessionUser | null,
  requirePhoneOtp: boolean
): { kind: "phone"; phone: string } | { kind: "email"; email: string } | null {
  if (!user) {
    return null;
  }
  if (user.phoneNumberVerified === true && user.phoneNumber) {
    return { kind: "phone", phone: user.phoneNumber };
  }
  if (!requirePhoneOtp && user.emailVerified) {
    return { kind: "email", email: user.email };
  }
  return null;
}

/** The typed number as E.164, by the same rule the server checks, or `null`. */
export function toPhone(typed: string): string | null {
  return toE164(typed, phoneRules.defaultCountryCode);
}

export function typedPhoneProblem(): string {
  return phoneRules.defaultCountryCode === undefined
    ? "Enter the number with + and the country code."
    : `Enter the number with 0 or with ${phoneRules.defaultCountryCode} in front.`;
}

/** What a phone call answered, `ok` or the reason it refused. */
export type PhoneAnswer =
  | "ok"
  | "exists"
  | "banned"
  | "rate_limited"
  | "wrong_code"
  | "code_expired"
  | "too_many_tries"
  | "wrong_password"
  | "no_password"
  | "password_too_short"
  | "invalid_phone"
  | "unreachable"
  | "failed";

const BY_CODE: Readonly<Record<string, PhoneAnswer>> = {
  BANNED_USER: "banned",
  INVALID_OTP: "wrong_code",
  INVALID_PHONE_NUMBER: "invalid_phone",
  INVALID_PHONE_NUMBER_OR_PASSWORD: "wrong_password",
  OTP_EXPIRED: "code_expired",
  OTP_NOT_FOUND: "code_expired",
  PASSWORD_TOO_SHORT: "password_too_short",
  PHONE_NUMBER_EXIST: "exists",
  TOO_MANY_ATTEMPTS: "too_many_tries",
  no_password: "no_password",
  rate_limited: "rate_limited",
};

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const envelope = record.error as Record<string, unknown> | undefined;
  if (envelope && typeof envelope.code === "string") {
    return envelope.code;
  }
  return typeof record.code === "string" ? record.code : undefined;
}

/** POST one phone endpoint. Resolves to `ok` or the refusal, never throws. */
async function phonePost(
  path: string,
  body: Record<string, unknown>
): Promise<PhoneAnswer> {
  try {
    const { error } = await auth.$fetch(path, { body, method: "POST" });
    if (error === null || error === undefined) {
      return "ok";
    }
    const code = codeOf(error);
    const known = code === undefined ? undefined : BY_CODE[code];
    if (known) {
      return known;
    }
    return (error as { status?: number }).status === 429
      ? "rate_limited"
      : "failed";
  } catch {
    return "unreachable";
  }
}

/** Ask for a code. `signIn` asks for a sign-in code for a known number (Q18). */
export function sendCode(phone: string, signIn = false): Promise<PhoneAnswer> {
  return phonePost("/phone-number/send-otp", {
    phoneNumber: phone,
    ...(signIn ? { signIn: true } : {}),
  });
}

/**
 * Check a code. It opens a session: a new account for a new number, the owner's for a
 * known one with `signIn`. `addToSession` puts a new number on the signed-in account.
 */
export function checkCode(
  phone: string,
  code: string,
  options: { signIn?: boolean; addToSession?: boolean } = {}
): Promise<PhoneAnswer> {
  return phonePost("/phone-number/verify", {
    code,
    phoneNumber: phone,
    ...(options.signIn ? { signIn: true } : {}),
    ...(options.addToSession ? { updatePhoneNumber: true } : {}),
  });
}

/** Sign in with the number and its password (checkout with `codeSignIn: false`, Q32). */
export function signInWithPassword(
  phone: string,
  password: string
): Promise<PhoneAnswer> {
  return phonePost("/sign-in/phone-number", { password, phoneNumber: phone });
}

/** Send a reset code to a known number. */
export function sendResetCode(phone: string): Promise<PhoneAnswer> {
  return phonePost("/phone-number/request-password-reset", {
    phoneNumber: phone,
  });
}

/** Set a new password with a reset code. The number counts as verified after it. */
export function resetPassword(
  phone: string,
  code: string,
  newPassword: string
): Promise<PhoneAnswer> {
  return phonePost("/phone-number/reset-password", {
    newPassword,
    otp: code,
    phoneNumber: phone,
  });
}

/** Give a new account the name the buyer typed. A failure keeps the default name. */
export async function setBuyerName(name: string): Promise<void> {
  try {
    await auth.updateUser({ name });
  } catch {
    // The order keeps the typed name on its own; the account name is a convenience.
  }
}

export async function signOut(): Promise<void> {
  try {
    await auth.signOut();
  } catch {
    // Signed out already, or the api is down: the page reloads either way.
  }
}

/** The words for a refusal. */
export function answerText(answer: PhoneAnswer): string {
  switch (answer) {
    case "exists": {
      return "This number already has an account.";
    }
    case "banned": {
      return "This account is suspended, so it cannot sign in.";
    }
    case "rate_limited": {
      return "Too many codes for this number. Wait a minute and try again.";
    }
    case "wrong_code": {
      return "That code is not right. Check the SMS and try again.";
    }
    case "code_expired": {
      return "That code has expired. Send a new one.";
    }
    case "too_many_tries": {
      return "Too many wrong codes. Send a new one.";
    }
    case "wrong_password": {
      return "That number and password do not match.";
    }
    case "no_password": {
      return "This account has no password yet. Get a code to set one.";
    }
    case "password_too_short": {
      return "Use a password of 12 characters or more.";
    }
    case "invalid_phone": {
      return typedPhoneProblem();
    }
    case "unreachable": {
      return "The shop cannot be reached. Check your connection and try again.";
    }
    default: {
      return "Something went wrong. Try again.";
    }
  }
}
