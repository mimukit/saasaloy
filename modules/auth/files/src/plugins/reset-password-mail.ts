import { env } from "cloudflare:workers";
import type { BetterAuthPlugin } from "better-auth";
import { config } from "@repo/config";
import { createEmail } from "@repo/email";
import type { EmailEnv } from "@repo/email";
import { resetPassword } from "@repo/email/templates/reset-password";

// The password reset mail, through `@repo/email`. `auth` ships this file, and the patch
// that pushes `resetPasswordMail()` into the client instance's `plugins`, only when `email`
// is installed (`when: { installed: ["email"] }`, ADR 0054). `saasaloy add email` in a
// project that already has `auth` writes both; `saasaloy remove email` takes both away.
//
// It is a plugin rather than a line in `auth.ts` because no patch kind edits an options
// object, and a plugin can: Better Auth merges what `init()` returns into the instance's
// options before the first request (`runPluginInit`, better-auth 1.7.7), so this sets
// `emailAndPassword.sendResetPassword` and `auth.ts` names no email code at all.
//
// Only the client instance carries it. `adminAuth` reads the same `accounts` table, so a
// password reset here counts on the admin side too, and the admin app has no reset link.
//
// `env` comes from `cloudflare:workers`, as in `auth.ts`: Better Auth calls the sender with
// the user and the request, not a Hono context, so there is no `c.env` to hand
// `createEmail`. A missing `EMAIL_PROVIDER` throws inside the sender; Better Auth logs it
// and still answers the request with its usual "check your email", so the endpoint never
// tells a caller whether an address has an account.

/** Better Auth's default lifetime for a reset token, which this module does not change. */
const RESET_TOKEN_MINUTES = 60;

export function resetPasswordMail() {
  return {
    id: "reset-password-mail",
    init: () => ({
      options: {
        emailAndPassword: {
          enabled: true,
          sendResetPassword: async ({
            user,
            url,
          }: {
            user: { email: string; name: string };
            url: string;
          }) => {
            await createEmail(env as unknown as EmailEnv).send({
              to: user.email,
              ...resetPassword({
                name: user.name,
                appName: config.app.name,
                resetUrl: url,
                expiresInMinutes: RESET_TOKEN_MINUTES,
              }),
            });
          },
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}
