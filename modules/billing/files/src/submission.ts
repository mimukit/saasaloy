import { BillingError } from "./provider";
import type { PaymentSubmission, SubmissionField } from "./provider";

// The vendor-blind half of manual settlement: what a submitted form has to satisfy, how a
// transaction reference is normalized for the duplicate check, and what the subject's last
// submission pre-fills.
//
// Everything here is pure. The rules a *payment method* owns — what a bKash TrxID looks
// like, what a Bangladeshi mobile number looks like — live in the provider's own
// `submissionFields`, and this file only ever calls them. That is the whole split: the core
// owns the queue, the provider owns the words (ADR 0040).

/**
 * The one field the duplicate check runs on, or a refusal naming the provider.
 *
 * Exactly one, never zero and never two. Zero leaves `transaction_ref_normalized` null on
 * every row, which turns the partial unique index off and lets one transaction be claimed
 * twice. Two makes "the reference" ambiguous, and the core would have to pick.
 */
export function referenceField(
  provider: string,
  fields: SubmissionField[]
): SubmissionField {
  const marked = fields.filter((field) => field.reference === true);

  if (marked.length !== 1) {
    throw new BillingError(
      "invalid_request",
      `Provider "${provider}" declares ${marked.length} submission fields with reference: true, and a manual provider owes exactly one. It is the value the duplicate check runs on.`
    );
  }

  return marked[0] as SubmissionField;
}

/**
 * Trim and upper-case a transaction reference.
 *
 * The stored `transaction_ref` keeps what the subject typed, so an admin comparing it
 * against an SMS sees the same characters. This is the form the partial unique index sits
 * on, so `8n7a…` and `8N7A…` are one claim rather than two.
 */
export function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Run every declared field over the submitted body.
 *
 * Each value goes through the provider's own `normalize`, which is where the method-specific
 * rule lives, and the result is what gets stored. A missing value and an unreadable one are
 * the same refusal: `invalid_request` naming the field, so the form can put the message
 * under the input it belongs to.
 *
 * Anything the provider did not ask for is dropped rather than refused. The form is the
 * provider's, and a stray key is the browser's business, not a reason to lose a payment the
 * subject has already made.
 */
export function normalizeFields(
  fields: SubmissionField[],
  body: Record<string, unknown>
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of fields) {
    const raw = body[field.id];

    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new BillingError(
        "invalid_request",
        `"${field.id}" is required. ${field.label} has to be a non-empty string.`,
        { providerCode: field.id }
      );
    }

    values[field.id] = field.normalize(raw);
  }

  return values;
}

/**
 * What the form starts with, read off the subject's most recent submission.
 *
 * Only the fields marked `remembered` carry over. A transaction reference never does: it is
 * different every time, and pre-filling the last one is how a subject resubmits a reference
 * that is already spent.
 */
export function prefillFrom(
  fields: SubmissionField[],
  previous: PaymentSubmission | undefined
): Record<string, string> {
  if (!previous) {
    return {};
  }

  const values: Record<string, string> = {};

  for (const field of fields) {
    const carried = previous.fields[field.id];
    if (field.remembered === true && typeof carried === "string") {
      values[field.id] = carried;
    }
  }

  return values;
}

/**
 * Whether a remembered value on this submission differs from the one before it.
 *
 * Advisory, and the admin queue's whole fraud signal. A subject paying from a spouse's or an
 * agent's wallet is ordinary here, so a change is something to look at rather than something
 * to refuse — see the claim-jacking note in the module's skill.
 */
export function rememberedChanged(
  fields: SubmissionField[],
  submission: PaymentSubmission,
  previous: PaymentSubmission | undefined
): boolean {
  if (!previous) {
    return false;
  }

  return fields.some(
    (field) =>
      field.remembered === true &&
      previous.fields[field.id] !== undefined &&
      previous.fields[field.id] !== submission.fields[field.id]
  );
}
