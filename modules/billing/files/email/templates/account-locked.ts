import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// Sent from the daily lockout job (packages/billing/src/jobs/past-due-lockout.ts) at the
// moment it sets `lockedAt`, which is the moment the subject actually loses the paid plan.
// One per subscription, because a locked row is not picked up by the next sweep.
//
// Deliberately not written as a cut-off notice. The data is untouched, the plan is the free
// one, and one successful payment puts everything back — a `payment.succeeded` event clears
// the lock. Saying so is both true and the thing most likely to get the card updated.

export interface AccountLockedProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /** The plan that just ended, by its display name from `plans.ts`. */
  planName: string;
  /** The plan the account is on now — the default one from `plans.ts`. */
  defaultPlanName: string;
  /** Absolute `https:` URL of the billing page, where the card is updated. */
  billingUrl: string;
}

export const accountLocked: EmailTemplate<AccountLockedProps> = ({
  name,
  appName,
  planName,
  defaultPlanName,
  billingUrl,
}) => {
  const href = safeUrl(billingUrl);

  return {
    subject: `Your ${appName} subscription is on hold`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          ${planName} is on hold.
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name} — we tried the card on your ${appName} account several
          times and it kept being declined, so ${planName} has stopped and the
          account is back on ${defaultPlanName}.
        </p>
        <p style="margin:0 0 24px;">
          Nothing has been deleted. Everything you've made is still there, and
          one successful payment turns ${planName} straight back on.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Update your payment method</a
          >
        </p>
        <p style="margin:0;">
          If you meant to stop paying, there's nothing to do — you're on
          ${defaultPlanName} already.
        </p>
      `,
      footer: html`You're receiving this because your ${appName} subscription
      couldn't be renewed.`,
      preheader: `${planName} stopped; you're on ${defaultPlanName} until the card works.`,
      title: `Your ${appName} subscription is on hold`,
    }),
  };
};
