import { config } from "@repo/config";
import { logSms } from "@repo/db/repositories/sms-messages";
import { createSms } from "@repo/sms";
import type { SmsEnv } from "@repo/sms";
import { maskCodes } from "@repo/sms/mask-codes";
import { verificationCode } from "@repo/sms/templates/verification-code";
import { authDb } from "./db-provider";

// Phone sign-in's server half. Better Auth's `phoneNumber()` plugin owns the code: it
// makes the digits, stores them in `verifications` before the send, and counts wrong
// tries. This file owns what the plugin leaves to the project: how the code is sent and
// logged. The number rules live in `./phone-rules.ts`, which a browser bundle can import.
//
// Every function here runs inside a Better Auth endpoint, so inside `withAuthScope`, and
// writes through `authDb`.

export {
  PHONE_RESET_CHECK_PATH,
  PHONE_RESET_PATH,
  PHONE_RESET_REQUEST_PATH,
  PHONE_SEND_PATH,
  PHONE_SET_PASSWORD_PATH,
  PHONE_SIGN_IN_PATH,
  PHONE_VERIFY_PATH,
  isAllowedPhone,
  placeholderEmail,
  toE164,
} from "./phone-rules";

/** The `sms_messages.purpose` of every code this module sends. The send limits count it. */
export const LOGIN_CODE_PURPOSE = "login_code";

/** Why a code went out: to prove a phone at sign-up, or to set or reset a password. */
export type LoginCodeReason = "sign_up" | "password_reset";

/** The template name each reason logs. Both send the same `verification-code` body. */
const TEMPLATES: Record<LoginCodeReason, string> = {
  password_reset: "password-reset-code",
  sign_up: "verification-code",
};

/**
 * Send `code` to `phone` and write its `sms_messages` row, which never holds the code. A
 * failed send writes a `failed` row and throws again, so the customer sees an error
 * rather than waiting for a text that never comes. The row's error text goes through
 * `maskCodes()`, because a provider may echo the body back in it.
 */
export async function sendLoginCode(
  env: SmsEnv,
  phone: string,
  code: string,
  reason: LoginCodeReason
): Promise<void> {
  const sender = createSms(env);
  const entry = {
    provider: sender.provider,
    purpose: LOGIN_CODE_PURPOSE,
    template: TEMPLATES[reason],
    toPhone: phone,
  };
  try {
    const { messageId } = await sender.send({
      to: phone,
      ...verificationCode({
        appName: config.app.name,
        code,
        expiresInMinutes: Math.ceil(config["auth-phone"].codeTtlSeconds / 60),
      }),
    });
    await logSms(authDb, { ...entry, providerRef: messageId, status: "sent" });
  } catch (error) {
    await logSms(authDb, {
      ...entry,
      error: maskCodes(error instanceof Error ? error.message : String(error)),
      status: "failed",
    });
    throw error;
  }
}
