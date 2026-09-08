import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// Sent from the `billing.event` consumer on every distinct `payment.failed` event, which is
// once per refused charge rather than once per subscription: dunning is a sequence, and the
// vendor retries a failed card two or three times before giving up.
//
// It says what happens if nothing changes, and by when. That date is what makes the email
// act-on-able instead of alarming — the plan is still live until the lockout job runs
// (packages/billing/src/jobs/past-due-lockout.ts), and the reader needs to know that.

export interface PaymentFailedProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /** The plan still in force while the grace period runs. */
  planName: string;
  /**
   * When the grace period ends, already formatted by the caller. `BILLING_LOCKOUT_DAYS`
   * after the failure; the lockout job uses the same number.
   */
  lockoutOn: string;
  /** Absolute `https:` URL of the billing page, where the card is updated. */
  billingUrl: string;
}

export const paymentFailed: EmailTemplate<PaymentFailedProps> = ({
  name,
  appName,
  planName,
  lockoutOn,
  billingUrl,
}) => {
  const href = safeUrl(billingUrl);

  return {
    subject: `We couldn't charge your card for ${appName}`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          Your payment didn't go through.
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name} — the card on your ${appName} account was declined, so we
          couldn't renew ${planName}. This is usually an expired card or a
          changed billing address.
        </p>
        <p style="margin:0 0 24px;">
          Nothing has changed yet: ${planName} stays active while we retry. If
          the payment still hasn't gone through by ${lockoutOn}, the account
          drops to the free plan.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Update your payment method</a
          >
        </p>
        <p style="margin:0;">
          Already fixed it? Then the next retry will go through and you can
          ignore this.
        </p>
      `,
      footer: html`You're receiving this because you have a paid ${appName}
      subscription.`,
      preheader: `${planName} stays active until ${lockoutOn}.`,
      title: `We couldn't charge your card for ${appName}`,
    }),
  };
};
