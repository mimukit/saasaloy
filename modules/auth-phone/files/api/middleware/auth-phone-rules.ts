// The pure rules behind `./auth-phone.ts`, with zero imports: the code-send limit and the
// phone mask a log line carries. `auth-phone` ships this file beside the guards, and
// `./auth-phone-rules.test.ts` runs it under `node --test` in the saasaloy repo, where no
// workspace package resolves. Add a runtime import here and that test stops working.

/** The provider that only prints a code, under which no send limit applies. */
export const UNLIMITED_SMS_PROVIDER = "console";

/**
 * Whether the send limits apply for this `SMS_PROVIDER`. The console provider prints the
 * code to the api log, so a send costs nothing and a limit only blocks a tester. Any
 * other value, and an unset one, keeps the limits on.
 */
export function loginCodeLimitApplies(smsProvider: unknown): boolean {
  return smsProvider !== UNLIMITED_SMS_PROVIDER;
}

/** The rolling window `codesPerHour` counts over, in seconds. */
export const LOGIN_CODE_WINDOW_SECONDS = 60 * 60;

/** The two numbers from the `auth-phone` config section the limit reads. */
export interface LoginCodeLimits {
  /** The wait before a second code to one number, in seconds. */
  resendSeconds: number;
  /** Codes one number may get in `LOGIN_CODE_WINDOW_SECONDS`. */
  codesPerHour: number;
}

/** Why a send is refused, and how long to wait. */
export interface SendRefusal {
  message: string;
  retryAfterSeconds: number;
}

/**
 * Decide from two counts of one number's codes: those sent in the last `resendSeconds`,
 * and those sent in the last hour. `null` lets the send go.
 */
export function loginCodeRefusal(
  sent: { inResendWindow: number; inHour: number },
  limits: LoginCodeLimits
): SendRefusal | null {
  if (sent.inResendWindow > 0) {
    return {
      message: `Wait ${String(limits.resendSeconds)} seconds before you ask for another code.`,
      retryAfterSeconds: limits.resendSeconds,
    };
  }
  if (sent.inHour >= limits.codesPerHour) {
    return {
      message: "Too many codes for this number. Try again in an hour.",
      retryAfterSeconds: LOGIN_CODE_WINDOW_SECONDS,
    };
  }
  return null;
}

/**
 * A phone number as a log line carries it: the last 4 digits only, so a log tells two
 * customers apart without holding their numbers.
 *
 * ```ts
 * maskPhone("+12025550101"); // "…0101"
 * ```
 */
export function maskPhone(phone: string): string {
  return `…${phone.replaceAll(/\D/g, "").slice(-4)}`;
}

/** The digits of `phone`, at most 20, as a rate limit key part. `none` for no digits. */
export function phoneKeyPart(phone: string | null): string {
  return (phone ?? "").replaceAll(/\D/g, "").slice(0, 20) || "none";
}
