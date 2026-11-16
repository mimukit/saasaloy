// The number rules of phone sign-in, with zero imports. `auth-phone` ships this file
// beside `./phone.ts`, which sends the code and imports the sms and db packages.
//
// It is split out for two readers. `./phone-rules.test.ts` runs it under `node --test` in
// the saasaloy repo, where `@repo/sms` and `@repo/db` resolve to nothing. And a browser
// bundle reaches it at `@repo/auth/phone-rules` (the subpath is declared up front in
// `packages/auth/package.json`), so an app screen turns what the customer typed into E.164
// with the same rule the server checks. Add a runtime import here and both stop working.

/**
 * The paths Better Auth's `phoneNumber()` plugin and `phoneAccount()` answer on, as a
 * hook's context names them: no `/auth` base path.
 */
export const PHONE_SEND_PATH = "/phone-number/send-otp";
export const PHONE_VERIFY_PATH = "/phone-number/verify";
export const PHONE_RESET_REQUEST_PATH = "/phone-number/request-password-reset";
export const PHONE_RESET_CHECK_PATH = "/phone-number/check-reset-code";
export const PHONE_RESET_PATH = "/phone-number/reset-password";
export const PHONE_SIGN_IN_PATH = "/sign-in/phone-number";
export const PHONE_SET_PASSWORD_PATH = "/phone-number/set-password";

/** E.164: a `+`, a country code that cannot start with 0, 7 to 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** Spaces, dashes, dots and brackets a person types between digit groups. */
const SEPARATORS = /[\s().-]/g;

/**
 * The email a phone sign-up writes. `users.email` stays NOT NULL for Better Auth, and
 * `.invalid` is reserved (RFC 2606), so no mail can ever be delivered to it.
 */
export function placeholderEmail(phone: string): string {
  return `${phone.replaceAll(/\D/g, "")}@phone.invalid`;
}

/**
 * `input` as E.164, or `null` when it cannot be one.
 *
 * A number that starts with `+` or `00` keeps its own country code. A number that starts
 * with a single `0` takes `defaultCountryCode` (for example `"+880"`) in place of that
 * `0`, and only when one is set. Anything else is `null`, so the screen asks for a number
 * that starts with `+`.
 */
export function toE164(
  input: string,
  defaultCountryCode?: string
): string | null {
  const typed = input.trim().replaceAll(SEPARATORS, "");
  let candidate: string | null = null;
  if (typed.startsWith("+")) {
    candidate = typed;
  } else if (typed.startsWith("00")) {
    candidate = `+${typed.slice(2)}`;
  } else if (typed.startsWith("0") && defaultCountryCode) {
    candidate = `${defaultCountryCode}${typed.slice(1)}`;
  }
  return candidate !== null && E164.test(candidate) ? candidate : null;
}

/**
 * Whether the server takes `phone`: E.164, and inside `allowedPrefixes` when the list is
 * not empty. An empty list allows every E.164 number.
 */
export function isAllowedPhone(
  phone: string,
  allowedPrefixes: readonly string[]
): boolean {
  if (!E164.test(phone)) {
    return false;
  }
  return (
    allowedPrefixes.length === 0 ||
    allowedPrefixes.some((prefix) => phone.startsWith(prefix))
  );
}
