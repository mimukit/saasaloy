// What a phone auth call answered, read from the error the Better Auth client returns,
// and the words each answer shows. `auth-phone` ships this file into `apps/app` beside the
// three phone routes under `src/routes/phone/`, which call the client and show these
// words. It has zero imports, so `./phone-results.test.ts` runs it under `node --test`.
//
// The client's error is the response body plus `status`. Better Auth's own refusals carry
// `code` at the top (`BANNED_USER`, `INVALID_OTP`). The api's guards answer with the api
// envelope, so their code sits one level down (`{ error: { code: "no_account" } }`).

/** Every answer a phone screen tells apart. */
export type PhoneResult =
  | "no_account"
  | "no_password"
  | "banned"
  | "rate_limited"
  | "exists"
  | "wrong_password"
  | "wrong_code"
  | "code_expired"
  | "too_many_tries"
  | "password_too_short"
  | "password_set"
  | "invalid_phone"
  | "unreachable"
  | "failed";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The refusal code: the api envelope's first, then Better Auth's own. */
export function errorCodeOf(error: unknown): string | undefined {
  const envelope = field(field(error, "error"), "code");
  if (typeof envelope === "string") {
    return envelope;
  }
  const code = field(error, "code");
  return typeof code === "string" ? code : undefined;
}

const BY_CODE: Readonly<Record<string, PhoneResult>> = {
  BANNED_USER: "banned",
  INVALID_OTP: "wrong_code",
  INVALID_PHONE_NUMBER: "invalid_phone",
  INVALID_PHONE_NUMBER_OR_PASSWORD: "wrong_password",
  OTP_EXPIRED: "code_expired",
  OTP_NOT_FOUND: "code_expired",
  PASSWORD_ALREADY_SET: "password_set",
  PASSWORD_TOO_SHORT: "password_too_short",
  PHONE_NUMBER_EXIST: "exists",
  TOO_MANY_ATTEMPTS: "too_many_tries",
  no_account: "no_account",
  no_password: "no_password",
  rate_limited: "rate_limited",
};

/** What a failed call answered. An answer this file does not know reads as `failed`. */
export function phoneResultOf(error: unknown): PhoneResult {
  const code = errorCodeOf(error);
  const known = code === undefined ? undefined : BY_CODE[code];
  if (known !== undefined) {
    return known;
  }
  return field(error, "status") === 429 ? "rate_limited" : "failed";
}

/**
 * Whole seconds from a `Retry-After` header, or `null` when there is none to read. The
 * api names its wait in seconds. A browser reads the header across origins only because
 * the api's CORS spine exposes it.
 */
export function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null;
  }
  const seconds = Number(header.trim());
  return seconds > 0 ? seconds : null;
}

/** `45` as "45 seconds", `90` as "2 minutes", `1` as "1 second". */
export function waitText(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${String(seconds)} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
}

/**
 * The words a phone screen shows for `result`. `retryAfter` is the wait a 429 named, or
 * `null` when the browser could not read one.
 */
export function phoneResultText(
  result: PhoneResult,
  retryAfter: number | null = null
): string {
  switch (result) {
    case "no_account": {
      return "No account uses this number yet.";
    }
    case "no_password": {
      return "This account has no password yet. Set one with a code by SMS.";
    }
    case "banned": {
      return "This account is suspended, so it cannot sign in.";
    }
    case "rate_limited": {
      return retryAfter === null
        ? "Too many tries. Wait a minute and try again."
        : `Too many tries. Try again in ${waitText(retryAfter)}.`;
    }
    case "exists": {
      return "This number already has an account. Sign in with your password.";
    }
    case "wrong_password": {
      return "That number and password do not match. Check both, or set a new password.";
    }
    case "wrong_code": {
      return "That code is not right. Check the SMS and try again.";
    }
    case "code_expired": {
      return "That code has expired. Ask for a new one.";
    }
    case "too_many_tries": {
      return "Too many wrong codes. Ask for a new one.";
    }
    case "password_too_short": {
      return "Use at least 12 characters.";
    }
    case "password_set": {
      return "This account has a password already. Sign in with it.";
    }
    case "invalid_phone": {
      return "This service does not take that number.";
    }
    case "unreachable": {
      return "Could not reach the server. Check the connection and try again.";
    }
    default: {
      return "Something went wrong. Try again in a minute.";
    }
  }
}
