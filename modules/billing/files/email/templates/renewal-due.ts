import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// Sent once per row by the daily renewal sweep
// (packages/billing/src/jobs/renewal-due.ts), at the moment it moves a manually renewed
// subscription to `past_due`.
//
// It is not the dunning email. Under manual renewal nothing is stored and nothing was
// charged, so "your card was declined" would be untrue for every reader. What happened is
// that a paid period ended, and the only way to start the next one is for the subject to pay
// for it — which is what the button does.
//
// The plan is still live when this goes out. `past_due` entitles it until the lockout job
// runs `BILLING_LOCKOUT_DAYS` later, and naming that date is what makes the email act-on-able.

export interface RenewalDueProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /** The plan whose period just ended, by its display name from `plans.ts`. */
  planName: string;
  /**
   * When the grace period ends, already formatted by the caller. `BILLING_LOCKOUT_DAYS`
   * after this email; the lockout job uses the same number.
   */
  lockoutOn: string;
  /** Absolute `https:` URL of the billing page, where the next period is paid for. */
  billingUrl: string;
}

export const renewalDue: EmailTemplate<RenewalDueProps> = ({
  name,
  appName,
  planName,
  lockoutOn,
  billingUrl,
}) => {
  const href = safeUrl(billingUrl);

  return {
    subject: `Time to renew your ${appName} subscription`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          Your ${planName} period has ended.
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name} — your paid period on ${appName} ran out. We don't keep
          your card, so nothing renews on its own and nothing has been charged.
          Paying for the next period takes a minute.
        </p>
        <p style="margin:0 0 24px;">
          ${planName} stays on until ${lockoutOn}. After that the account drops
          to the free plan until a payment goes through.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Renew ${planName}</a
          >
        </p>
        <p style="margin:0;">Already paid? Then you can ignore this.</p>
      `,
      footer: html`You're receiving this because you have a paid ${appName}
      subscription.`,
      preheader: `${planName} stays on until ${lockoutOn}.`,
      title: `Time to renew your ${appName} subscription`,
    }),
  };
};
