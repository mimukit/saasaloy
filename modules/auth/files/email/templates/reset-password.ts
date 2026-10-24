import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// The password reset mail. `auth` ships this file, and only when `email` is installed:
// `@auth/plugins/reset-password-mail.ts` renders it from Better Auth's `sendResetPassword`.
// It is yours to edit like `welcome.ts`. `saasaloy update` sends an edited copy to the
// merge plan rather than overwriting it.

export interface ResetPasswordProps {
  /** Display name of the account holder. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /**
   * The link Better Auth built: the api's `/auth/reset-password/<token>`, which checks the
   * token and redirects to the `redirectTo` the request named. Checked by `safeUrl`, so a
   * misconfigured `BETTER_AUTH_URL` throws here rather than mail a link that cannot work.
   */
  resetUrl: string;
  /** How long the link stays valid, in minutes. Better Auth's default is 60. */
  expiresInMinutes: number;
}

export const resetPassword: EmailTemplate<ResetPasswordProps> = ({
  name,
  appName,
  resetUrl,
  expiresInMinutes,
}) => {
  const href = safeUrl(resetUrl);

  return {
    subject: `Reset your ${appName} password`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          Reset your password
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name}, somebody asked to reset the password of your ${appName}
          account. Choose a new one with the button below.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Choose a new password</a
          >
        </p>
        <p style="margin:0;">
          The link works once and expires in ${expiresInMinutes} minutes. If you
          did not ask for it, ignore this email: your password stays as it is.
        </p>
      `,
      footer: html`You're receiving this because a password reset was requested
      for this address on ${appName}.`,
      preheader: `Choose a new ${appName} password.`,
      title: `Reset your ${appName} password`,
    }),
  };
};
