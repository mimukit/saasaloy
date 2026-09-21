import { html, layout, safeUrl } from "../render";
import type { EmailTemplate } from "../provider";

// Sent when an admin refuses a payment submission under manual settlement
// (apps/api/src/routes/admin-billing.ts), and sent nowhere else.
//
// It is the one review outcome worth an email. An approval lands on a page the subject is
// already watching; a rejection carries a reason they cannot work out for themselves — the
// amount was short, the transaction reference is not on the seller's statement, the money
// went to another number.
//
// The note is the admin's own words and is the whole point of the message, so it is quoted
// rather than paraphrased. Nothing was granted and nothing was charged, and the email says
// both so the subject knows they still owe the period.

export interface PaymentRejectedProps {
  /** Display name of the person receiving this. Escaped by the `html` tag. */
  name: string;
  appName: string;
  /** The plan the refused submission was for, by its display name from `plans.ts`. */
  planName: string;
  /** The transaction reference the subject submitted, verbatim. */
  transactionRef: string;
  /** What the reviewing admin wrote. Empty when they left the note blank. */
  note: string;
  /** Absolute `https:` URL of the billing page, where a new payment starts. */
  billingUrl: string;
}

export const paymentRejected: EmailTemplate<PaymentRejectedProps> = ({
  name,
  appName,
  planName,
  transactionRef,
  note,
  billingUrl,
}) => {
  const href = safeUrl(billingUrl);

  return {
    subject: `Your ${appName} payment was not accepted`,
    html: layout({
      content: html`
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">
          We could not accept that payment.
        </h1>
        <p style="margin:0 0 24px;">
          Hi ${name} — we reviewed the payment you submitted for ${planName} on
          ${appName} and could not accept it. Your ${planName} subscription has
          not started, and nothing has been charged by us.
        </p>
        <p style="margin:0 0 24px;">
          Transaction reference you gave: <strong>${transactionRef}</strong>
        </p>
        ${
          note
            ? html`<p
                style="margin:0 0 24px;padding:12px 16px;border-left:3px solid #d1d5db;"
              >
                ${note}
              </p>`
            : ""
        }
        <p style="margin:0 0 24px;">
          <a
            href="${href}"
            style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;"
            >Try again</a
          >
        </p>
        <p style="margin:0;">
          If you think this is wrong, reply to this email with the transaction
          reference and the number you sent from.
        </p>
      `,
      footer: html`You're receiving this because you submitted a payment on
      ${appName}.`,
      preheader: `We could not accept the payment for ${planName}.`,
      title: `Your ${appName} payment was not accepted`,
    }),
  };
};
