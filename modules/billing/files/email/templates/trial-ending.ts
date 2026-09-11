import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// Sent once per subscription, from the `billing.event` consumer, when the payment provider
// says a trial is about to convert (Stripe sends `customer.subscription.trial_will_end`
// three days out). `applyEvent` stamps `reminderSentAt` after this goes, so a second
// delivery sends nothing — see packages/billing/src/subscription.ts.
//
// The one job of this email is to remove the surprise from the first charge. It names the
// plan, the date and the amount if the project has one, and links to the billing page where
// the subject can cancel. Nothing here asks them to do anything, because the default —
// letting the trial convert — is the outcome the project wants.

export interface TrialEndingProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /** The plan the trial converts to, by its display name from `plans.ts`. */
  planName: string;
  /** When the trial ends, already formatted for the reader's locale by the caller. */
  endsOn: string;
  /**
   * Absolute `https:` URL of the project's billing page — a relative one has nothing to
   * resolve against in an inbox. Checked by `safeUrl`, which throws rather than render a
   * link it can't vouch for.
   */
  billingUrl: string;
}

export const trialEnding: EmailTemplate<TrialEndingProps> = ({
  name,
  appName,
  planName,
  endsOn,
  billingUrl,
}) => {
  const href = safeUrl(billingUrl);

  return {
    subject: `Your ${appName} trial ends ${endsOn}`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          Your trial ends ${endsOn}.
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name} — your ${appName} trial of ${planName} finishes on
          ${endsOn}. After that your subscription starts and we'll charge the
          card on file. You don't have to do anything to keep going.
        </p>
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Review your plan</a
          >
        </p>
        <p style="margin:0;">
          Changed your mind? Cancel from that page before ${endsOn} and you
          won't be charged.
        </p>
      `,
      footer: html`You're receiving this because you started a ${planName} trial
      on ${appName}.`,
      preheader: `Your ${planName} trial converts on ${endsOn}.`,
      title: `Your ${appName} trial ends ${endsOn}`,
    }),
  };
};
