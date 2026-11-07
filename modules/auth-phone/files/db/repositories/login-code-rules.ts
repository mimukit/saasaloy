// The login code rules the admin login codes screen reads, as pure functions. No database
// and no clock: `./login-codes.ts` calls them with the rows and the time.
//
// Better Auth's `phoneNumber()` plugin (1.7.7) keeps a code in `verifications`:
//
// - `identifier` is the E.164 phone for a sign-up code and `<phone>-request-password-reset`
//   for a set-or-reset code.
// - `value` is `<code>:<wrong tries>`. A wrong try writes the row again with one more try,
//   and a right code deletes it.
//
// Nothing here hands the code on. `parseLoginCodeValue()` reads the tries and drops the
// digits, so no caller of this file can put a code in a response by mistake.

export const LOGIN_CODE_PURPOSES = ["sign_up", "password_reset"] as const;
export type LoginCodePurpose = (typeof LOGIN_CODE_PURPOSES)[number];

/**
 * The `sms_messages.template` each purpose logs. `sendLoginCode()` in
 * `packages/auth/src/phone.ts` writes these names: change one and change the other.
 */
const TEMPLATES = {
  password_reset: "password-reset-code",
  sign_up: "verification-code",
} as const satisfies Record<LoginCodePurpose, string>;

/** What the plugin appends to the phone for a set-or-reset code. */
const RESET_SUFFIX = "-request-password-reset";

/** A stored value: the code's digits, a colon, and the wrong tries spent. */
const VALUE = /^\d+:(\d{1,3})$/;

/** What a login code came to at a moment. */
export type LoginCodeState = "live" | "expired" | "ended";

/** The purpose an SMS row's template names. Any other template reads as a sign-up. */
export function loginCodePurposeOf(template: string): LoginCodePurpose {
  return template === TEMPLATES.password_reset ? "password_reset" : "sign_up";
}

/** The `verifications.identifier` the plugin keeps a code of `purpose` for `phone` under. */
export function loginCodeIdentifier(
  phone: string,
  purpose: LoginCodePurpose
): string {
  return purpose === "password_reset" ? `${phone}${RESET_SUFFIX}` : phone;
}

/** The phone and purpose an identifier names, or `null` for one no login code uses. */
export function parseLoginCodeIdentifier(
  identifier: string
): { phone: string; purpose: LoginCodePurpose } | null {
  const phone = identifier.endsWith(RESET_SUFFIX)
    ? identifier.slice(0, -RESET_SUFFIX.length)
    : identifier;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return null;
  }
  return {
    phone,
    purpose: phone === identifier ? "sign_up" : "password_reset",
  };
}

/**
 * The wrong tries a stored value holds, or `null` for any other shape. A `null` gives no
 * live row: a later Better Auth that hashes the code reads as no code.
 */
export function parseLoginCodeValue(
  value: string
): { triesUsed: number } | null {
  const match = VALUE.exec(value);
  return match?.[1] === undefined ? null : { triesUsed: Number(match[1]) };
}

/** The plugin settings a code's life depends on, from `config["auth-phone"]`. */
export interface LoginCodeRules {
  /** How long a code lives, in seconds (`codeTtlSeconds`). */
  lifeSeconds: number;
  /** Wrong tries before the plugin throws a code away (`codeAttempts`). */
  attemptsAllowed: number;
}

/**
 * The tries left on the code a `verifications` row holds at `now`, or `null` when it holds
 * none a customer can still enter: the row is past `expiresAt`, its value has another
 * shape, or every try is spent. Pass the newest row for the identifier, the one the plugin
 * checks.
 */
export function liveTriesLeft(
  row: { value: string; expiresAt: Date },
  rules: LoginCodeRules,
  now: Date
): number | null {
  // The plugin's own test: a code is expired once `expiresAt` is before now.
  if (row.expiresAt.getTime() < now.getTime()) {
    return null;
  }
  const parsed = parseLoginCodeValue(row.value);
  if (parsed === null || parsed.triesUsed >= rules.attemptsAllowed) {
    return null;
  }
  return rules.attemptsAllowed - parsed.triesUsed;
}

/**
 * The state of one code request. `triesLeft` is what `liveTriesLeft()` answered for the
 * request's code, or `null` when the request is not the newest for its identifier or the
 * code is gone. A request with no live code is `expired` once its SMS is older than a
 * code's life, and `ended` before that: the code was used, ran out of tries, or a newer
 * request replaced it.
 */
export function loginCodeState(
  sentAt: Date,
  triesLeft: number | null,
  rules: LoginCodeRules,
  now: Date
): LoginCodeState {
  if (triesLeft !== null) {
    return "live";
  }
  return sentAt.getTime() + rules.lifeSeconds * 1000 < now.getTime()
    ? "expired"
    : "ended";
}
