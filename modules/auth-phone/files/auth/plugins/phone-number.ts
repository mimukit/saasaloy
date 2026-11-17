import { env } from "cloudflare:workers";
import { phoneNumber } from "better-auth/plugins";
import { config } from "@repo/config";
import type { SmsEnv } from "@repo/sms";
import { isAllowedPhone, placeholderEmail, sendLoginCode } from "../phone";

// Better Auth's `phoneNumber()` plugin with this project's numbers, on the client instance
// only (`auth`, at `/auth`). `auth-phone` adds the call to `auth`'s `plugins` with a
// `plugin-array` patch, and that patch kind appends a call with no arguments, so the
// options live here and not in `auth.ts`. Admins keep email sign-in on `adminAuth`.
//
// The code proves the phone. Sign-up is `send-otp`, then `verify`, which creates the
// account with a placeholder email and opens a session. Sign-in is phone and password on
// the app screens. With `codeSignIn`, `send-otp` and `verify` with `signIn: true` sign a
// known number in by code instead; `./phone-account.ts` holds that rule.
// A reset is `request-password-reset`, then `check-reset-code` from `./phone-account.ts`,
// then `reset-password`.
//
// `env` comes from `cloudflare:workers`, as in `./reset-password-mail.ts`: Better Auth
// calls the senders with the number and the code, not a Hono context.

const smsEnv = env as unknown as SmsEnv;

export function phoneNumberPlugin() {
  const rules = config["auth-phone"];
  return phoneNumber({
    allowedAttempts: rules.codeAttempts,
    expiresIn: rules.codeTtlSeconds,
    otpLength: rules.codeLength,
    phoneNumberValidator: (phone) =>
      isAllowedPhone(phone, rules.allowedPrefixes),
    // `phoneAccount()` lets a known number through only for a sign-in code, so a number
    // that has an account here is a sign-in.
    sendOTP: async ({ phoneNumber: phone, code }, context) => {
      const owner = await context?.context.adapter.findOne({
        model: "user",
        where: [{ field: "phoneNumber", value: phone }],
      });
      await sendLoginCode(smsEnv, phone, code, owner ? "sign_in" : "sign_up");
    },
    sendPasswordResetOTP: ({ phoneNumber: phone, code }) =>
      sendLoginCode(smsEnv, phone, code, "password_reset"),
    signUpOnVerification: {
      getTempEmail: placeholderEmail,
      getTempName: (phone) => phone,
    },
  });
}
