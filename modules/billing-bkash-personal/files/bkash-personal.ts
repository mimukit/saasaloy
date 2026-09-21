import { findPlan } from "../define";
import { plans } from "../plans";
import { BillingError } from "../provider";
import type {
  ApproveSubmissionInput,
  BillableSubject,
  BillingEnv,
  BillingEvent,
  BillingProvider,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  ManualInstructions,
  ManualInstructionsInput,
  Plan,
  PlanInterval,
  PortalInput,
  QuantityInput,
  SubjectInput,
  SubmissionField,
  Subscription,
  SubscriptionInput,
} from "../provider";

// A **personal** bKash wallet as a `billing` provider. Not a merchant account, not a
// business account, and not the bKash PGW.
//
// NOTHING HERE IS VERIFIED. bKash publishes no merchant API for a personal wallet: there is
// no IPN, no webhook, no query endpoint and no way to ask whether a transaction id is real.
// Every fact in an approval comes from a person reading their own bKash statement and their
// own SMS. This file calls no network at all, and a project that installs it is buying a
// queue, not an integration. The module's skill says the same thing in its first paragraph.
//
// So the whole file is words and arithmetic. `billing` core owns the submissions table, the
// submit route, the admin queue and the review route (ADR 0040); this provider owns the
// instruction text the subject reads, the two fields they type in, and the event an approval
// is worth. That is what keeps it one runtime file plus a registration patch, and what makes
// a later `billing-nagad-personal` one file too.
//
// The claim-jacking hole is open and is a property of the method. A subject who sees someone
// else's transaction id can submit it first, and the only signal is the sender number, which
// is advisory: paying from a spouse's or an agent's wallet is ordinary in Bangladesh.

/** The value `BILLING_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "bkash-personal";

/** Everything this provider mints carries this prefix, so its rows are obvious in a query. */
const PREFIX = "bkashp_";

/**
 * The only currency this provider takes.
 *
 * A personal bKash wallet holds taka and nothing else. A plan priced in anything else is
 * refused at checkout naming the plan, rather than after a subject has already sent money.
 */
const CURRENCY = "BDT";

/** Days in each interval. The same figures `billing-console` and `billing-sslcommerz` use. */
const INTERVAL_DAYS: Record<PlanInterval, number> = {
  monthly: 30,
  yearly: 365,
};

/**
 * A bKash transaction id: ten characters, letters and digits.
 *
 * The published format is a ten-character alphanumeric string, e.g. `8N7A5D2K1P`. bKash
 * prints it upper case in the SMS, and a subject typing it back may not, so the value is
 * upper-cased before it is stored and before the duplicate check runs.
 */
const TRX_ID = /^[\dA-Z]{10}$/;

/**
 * A Bangladeshi mobile number, normalized to `+8801XXXXXXXXX`.
 *
 * Declared here rather than imported from `@repo/validators/phone` because that module
 * (issue #147) has not landed. It is a two-line rule and a follow-up swaps it; blocking this
 * provider on it would buy nothing.
 *
 * The four shapes a Bangladeshi subject actually types: `01712345678`, `1712345678`,
 * `+8801712345678` and `8801712345678`. The operator prefix is `1[3-9]`, which covers
 * Grameenphone, Robi, Banglalink, Teletalk and Airtel.
 */
const BD_MOBILE = /^(?:\+?880)?0?(1[3-9]\d{8})$/;

export function bkashPersonalBilling(): BillingProvider {
  return {
    /**
     * The event an approved submission is worth: one period of the plan it names.
     *
     * The submission id is the `providerEventId`, so a double-clicked approval conflicts on
     * the `billing_events` primary key and grants one period rather than two. That is the
     * backstop behind the review route's conditional update, not a replacement for it.
     */
    approveSubmission(
      _env: BillingEnv,
      input: ApproveSubmissionInput
    ): BillingEvent {
      const { submission } = input;
      const now = new Date();
      const interval = submission.billingInterval;

      // Days still left on the period the subject is already on, carried over. A renewal
      // submitted early must not throw away what has been paid for; it is the same
      // no-proration rule `changePlan` below uses, and the whole of it.
      const carriedDays = daysLeft(input.current, now);

      return {
        occurredAt: now,
        provider: PROVIDER_NAME,
        providerEventId: submission.id,
        subject: subjectOf(submission),
        subscription: {
          billingInterval: interval === "yearly" ? "year" : "month",
          cancelAtPeriodEnd: false,
          // Kept whole enough for a human to reconcile the payment by hand months later,
          // because there is no gateway record to go back to.
          metadata: {
            carriedDays,
            claimedFields: submission.fields,
            expectedAmount: submission.expectedAmount,
            rawStatus: "approved",
            reviewedBy: submission.reviewedBy ?? null,
            submissionId: submission.id,
            transactionRef: submission.transactionRef ?? null,
          },
          periodEnd: addDays(now, INTERVAL_DAYS[interval] + carriedDays),
          periodStart: now,
          plan: submission.plan,
          providerCustomerId: customerId(subjectOf(submission)),
          // Derived from the subject rather than random, so the next period's approval
          // converges on this row instead of stacking a history row. The column is unique,
          // which is what makes `upsertSubscription` an update here.
          providerSubscriptionId: subscriptionId(subjectOf(submission)),
          seats: 1,
          status: "active",
        },
        type: "payment.succeeded",
      };
    },

    cancel(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      // Nothing recurs, so cancelling is only a promise not to ask for the next period. The
      // event is minted from the row the route read, as `billing-console` does it.
      const current = carried(input);
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...current,
          cancelAt: current.periodEnd ?? null,
          cancelAtPeriodEnd: true,
        }),
        url: "",
      });
    },

    /**
     * Move to another plan by paying for it, at full price, with the days left on the
     * current period added to the new one.
     *
     * There is no credit concept in the core and no gateway to ask for one, so the period
     * extension is the whole of proration. The core opened a fresh submission before this
     * ran; the days are carried at approval time, off the row the approval reads.
     */
    changePlan(
      env: BillingEnv,
      _ctx: HostContext,
      input: ChangePlanInput
    ): Promise<CheckoutResult> {
      return Promise.resolve(payPage(env, input));
    },

    createCheckout(
      env: BillingEnv,
      _ctx: HostContext,
      input: CheckoutInput
    ): Promise<CheckoutResult> {
      return Promise.resolve(payPage(env, input));
    },

    // No vendor portal exists — there is no vendor. The caller goes straight back where it
    // came from; a fabricated url would send a browser somewhere that is not there.
    createPortal(
      _env: BillingEnv,
      _ctx: HostContext,
      input: PortalInput
    ): Promise<{ url: string }> {
      return Promise.resolve({ url: input.returnUrl });
    },

    // There is no invoice to list. An empty list rather than a throw: the billing page's
    // invoice section renders empty, which is the honest answer.
    listInvoices(): Promise<Invoice[]> {
      return Promise.resolve([]);
    },

    /**
     * What the subject reads before they pay.
     *
     * The figure comes off the submission the core opened, not off `plans.ts` read again:
     * the subject has to be told one number and be judged against that same number later.
     */
    manualInstructions(
      env: BillingEnv,
      input: ManualInstructionsInput
    ): ManualInstructions {
      const number = required(env, "BKASH_PERSONAL_NUMBER");
      const label = text(env, "BKASH_PERSONAL_ACCOUNT_LABEL");
      const amount = major(input.expectedAmount);

      return {
        destination: number,
        heading: "Send Money on bKash",
        note: `${label ? `The number belongs to ${label}. ` : ""}This is a personal bKash wallet, so there is no automatic confirmation. Someone checks your transaction id against the account's own statement, usually within a day.`,
        steps: [
          "Open the bKash app and choose Send Money.",
          `Send to ${number}${label ? ` (${label})` : ""}.`,
          `Enter exactly ${amount} ${input.currency}. A different amount has to be refused and refunded by hand.`,
          "Leave the reference field empty. Nothing reads it.",
          "Confirm, and wait for the bKash SMS with your transaction id.",
          "Type that transaction id and the number you sent from into the form below.",
        ],
      };
    },

    name: PROVIDER_NAME,

    /**
     * Nothing recurs on its own. `billing.renewal-due` marks a row `past_due` when its period
     * ends, and the subject sends money again and submits a second transaction id through
     * `POST /billing/renew`.
     */
    renewal: "manual",

    restore(
      _env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...carried(input),
          cancelAt: null,
          cancelAtPeriodEnd: false,
        }),
        url: "",
      });
    },

    setQuantity(
      _env: BillingEnv,
      _ctx: HostContext,
      input: QuantityInput
    ): Promise<void> {
      if (input.seats < 1) {
        throw new BillingError(
          "invalid_request",
          `A subscription needs at least one seat; got ${input.seats}.`,
          { providerCode: "invalid_seats" }
        );
      }
      // Seats are a follow-up issue everywhere, and nothing reads the column yet.
      return Promise.resolve();
    },

    /** The words this provider settles in. See the file header. */
    settlement: "manual",

    /**
     * The three values the subject types in after they pay.
     *
     * `transactionId` is the reference the duplicate check runs on. `senderNumber` is
     * remembered, so the next submission starts pre-filled and a change is flagged in the
     * admin queue. `amount` is what the subject says they sent, shown beside the quoted
     * figure so the admin compares two numbers rather than one.
     */
    submissionFields(): SubmissionField[] {
      return [
        {
          help: "The 10-character code in the bKash SMS, e.g. 8N7A5D2K1P.",
          id: "transactionId",
          label: "bKash transaction ID",
          normalize: (value) => {
            const trimmed = value.trim().toUpperCase();
            if (!TRX_ID.test(trimmed)) {
              throw new BillingError(
                "invalid_request",
                `"${value.trim()}" is not a bKash transaction ID. It is exactly 10 letters and digits, printed in the SMS bKash sends you — for example 8N7A5D2K1P.`,
                { providerCode: "transactionId" }
              );
            }
            return trimmed;
          },
          reference: true,
          type: "text",
        },
        {
          help: "The bKash number you sent the money from. It does not have to be your account's number.",
          id: "senderNumber",
          label: "Your bKash number",
          normalize: (value) => {
            const match = BD_MOBILE.exec(value.trim().replaceAll(/[\s-]/g, ""));
            if (!match) {
              throw new BillingError(
                "invalid_request",
                `"${value.trim()}" is not a Bangladeshi mobile number. Write it as 01712345678 or +8801712345678.`,
                { providerCode: "senderNumber" }
              );
            }
            return `+880${match[1] as string}`;
          },
          remembered: true,
          type: "tel",
        },
        {
          help: "In taka, as the SMS shows it.",
          id: "amount",
          label: "Amount you sent",
          normalize: (value) => {
            const amount = Number(value.trim().replace(/^[^\d.]+/, ""));
            if (!Number.isFinite(amount) || amount <= 0) {
              throw new BillingError(
                "invalid_request",
                `"${value.trim()}" is not an amount. Write the figure in taka, e.g. 499.`,
                { providerCode: "amount" }
              );
            }
            // Stored as the subject wrote it, in major units, for an admin to read beside
            // the quoted figure. It is evidence for a person, never a check this file runs.
            return amount.toFixed(2);
          },
          type: "amount",
        },
      ];
    },
  };
}

/**
 * Where the subject goes to read the instructions and type the reference: this project's own
 * pay page, never a vendor page, because there is no vendor page.
 *
 * A plan carrying `trialDays` mints a `trialing` row here and collects nothing, exactly as
 * `billing-console` and `billing-sslcommerz` do, so a project can run a trial with no wallet
 * at all. The core skips the submission shell on the same condition.
 */
function payPage(
  env: BillingEnv,
  input: CheckoutInput | ChangePlanInput
): CheckoutResult {
  const plan = findPlan(plans, input.planId);
  const now = new Date();

  if (plan.trialDays) {
    return {
      event: event(
        "subscription.changed",
        input.subject,
        trialing(plan, input.interval, now, input.subject)
      ),
      url: input.successUrl,
    };
  }

  // Refused here as well as in the core, and deliberately: the core checks that a price
  // exists, and this checks it is taka. A wallet that holds only taka cannot be handed
  // dollars, and the refusal has to name the plan before the subject sends anything.
  priceFor(plan, input.interval);

  // Configuration is proved before the subject is sent anywhere. An unset receiving number
  // would otherwise surface on the pay page, after a submission row had been opened.
  required(env, "BKASH_PERSONAL_NUMBER");

  const url = new URL(input.successUrl);
  url.searchParams.set("billing", "submit");
  if (input.submissionId) {
    url.searchParams.set("submission", input.submissionId);
  }

  // No event. Nothing has been paid yet, and an admin approval is what says it has.
  return { url: url.toString() };
}

/** The price a plan carries for an interval, or a refusal naming what is wrong. */
function priceFor(
  plan: Plan,
  interval: PlanInterval
): { amount: number; currency: string } {
  const price = plan.price[interval];

  if (!price || price.amount <= 0) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" carries no ${interval} price. bkash-personal quotes the subject a figure to send, so set price.${interval} = { amount, currency: "${CURRENCY}" } in packages/billing/src/plans.ts — amount in poisha, so 499 BDT is 49900.`,
      { providerCode: "no_price" }
    );
  }

  if (price.currency.trim().toUpperCase() !== CURRENCY) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" is priced in ${price.currency} and a personal bKash wallet holds ${CURRENCY} only. Price the plan in taka, or take payment through a provider that handles that currency.`,
      { providerCode: "unsupported_currency" }
    );
  }

  return { amount: price.amount, currency: CURRENCY };
}

/** The row a trial produces. No payment, and nothing for anyone to check. */
function trialing(
  plan: Plan,
  interval: PlanInterval,
  now: Date,
  subject: BillableSubject
): SubscriptionInput {
  const trialDays = plan.trialDays ?? 0;
  return {
    billingInterval: interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    metadata: { rawStatus: "trialing", trial: true },
    // The same instant as `trialEnd`. The renewal sweep reads `trialEnd` on a `trialing`
    // row, and keeping the two in step means a trial that ends is asked to pay once.
    periodEnd: addDays(now, trialDays),
    periodStart: now,
    plan: plan.id,
    providerCustomerId: customerId(subject),
    providerSubscriptionId: subscriptionId(subject),
    seats: 1,
    status: "trialing",
    trialEnd: addDays(now, trialDays),
    trialStart: now,
  };
}

/**
 * The row a `cancel` or a `restore` starts from — the live one the route read, minus the
 * columns the core owns.
 */
function carried(input: SubjectInput): SubscriptionInput {
  const current = input.current;
  if (!current) {
    throw new BillingError(
      "not_found",
      `No live subscription for ${input.subject.customerType} ${input.subject.referenceId}. Start one through POST /billing/checkout first.`,
      { providerCode: "no_subscription" }
    );
  }

  const {
    createdAt: _createdAt,
    customerType: _customerType,
    id: _id,
    lockedAt: _lockedAt,
    provider: _provider,
    referenceId: _referenceId,
    reminderSentAt: _reminderSentAt,
    updatedAt: _updatedAt,
    ...projected
  } = current;

  return projected;
}

/** Days still left on the row the subject is paying on, or zero. */
function daysLeft(current: Subscription | undefined, now: Date): number {
  const endsAt = current?.periodEnd ?? current?.trialEnd;
  if (!endsAt || endsAt.getTime() <= now.getTime()) {
    return 0;
  }
  return Math.floor((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** Build one normalized event from a projection this provider minted itself. */
function event(
  type: BillingEvent["type"],
  subject: BillableSubject,
  subscription: SubscriptionInput
): BillingEvent {
  return {
    occurredAt: new Date(),
    provider: PROVIDER_NAME,
    // Random, because no payment produced an id: these events report a decision this project
    // made, not one anybody reported, so two of them must never dedupe. An *approval* is the
    // opposite case and carries the submission id.
    providerEventId: `${PREFIX}evt_${crypto.randomUUID()}`,
    subject,
    subscription,
    type,
  };
}

function subjectOf(submission: {
  customerType: string;
  referenceId: string;
}): BillableSubject {
  return {
    customerType: submission.customerType,
    referenceId: submission.referenceId,
  };
}

function subscriptionId(subject: BillableSubject): string {
  return `${PREFIX}sub_${subject.customerType}_${subject.referenceId}`;
}

function customerId(subject: BillableSubject): string {
  return `${PREFIX}cus_${subject.customerType}_${subject.referenceId}`;
}

/** A required env value, or a refusal naming the key that is unset. */
function required(env: BillingEnv, key: string): string {
  const value = text(env, key);
  if (!value) {
    throw new BillingError(
      "invalid_request",
      `bkash-personal is not configured here: ${key} is unset. Set it in apps/api/.dev.vars for local development and with \`wrangler secret put ${key}\` for a deployed Worker.`,
      { providerCode: "unconfigured" }
    );
  }
  return value;
}

function text(env: BillingEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** `49900` → `"499.00"`. What the subject is told to send. */
function major(amount: number): string {
  return (amount / 100).toFixed(2);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
