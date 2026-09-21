// Tests for the bKash personal provider. Repo-only: the descriptor ships
// `bkash-personal.ts` and nothing else, and this file runs on `node:test` via
// `pnpm test:modules`.
//
// Nothing is stubbed, because nothing here calls a network — that is the whole point of the
// provider. The shims beside this module resolve `../provider`, `../define` and `../plans`:
// the first two to the real `packages/billing` core, the third to a fixture plan table
// priced in BDT, because the template's own table is priced for Stripe. See ../plans.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bkashPersonalBilling } from "./bkash-personal.ts";
import { BillingError } from "../provider.ts";
import type {
  BillingEnv,
  HostContext,
  PaymentSubmission,
  Subscription,
  SubmissionField,
} from "../provider.ts";

const ENV: BillingEnv = {
  BILLING_PROVIDER: "bkash-personal",
  BKASH_PERSONAL_NUMBER: "+8801712345678",
};

const CTX: HostContext = { auth: null, headers: new Headers() };
const SUBJECT = { customerType: "user", referenceId: "user_1" };
const DAY = 24 * 60 * 60 * 1000;

const checkout = {
  cancelUrl: "https://admin.example.test/billing?cancel",
  interval: "monthly" as const,
  planId: "pro",
  subject: SUBJECT,
  successUrl: "https://admin.example.test/billing",
};

function fieldNamed(id: string): SubmissionField {
  const fields = bkashPersonalBilling().submissionFields?.(ENV) ?? [];
  const field = fields.find((candidate) => candidate.id === id);
  assert.ok(field, `no submission field "${id}"`);
  return field;
}

function submission(over: Partial<PaymentSubmission> = {}): PaymentSubmission {
  const now = new Date("2026-09-21T00:00:00.000Z");
  return {
    billingInterval: "monthly",
    createdAt: now,
    currency: "BDT",
    customerType: "user",
    expectedAmount: 49_900,
    fields: {
      amount: "499.00",
      senderNumber: "+8801712345678",
      transactionId: "8N7A5D2K1P",
    },
    id: "sub_1",
    plan: "pro",
    provider: "bkash-personal",
    referenceId: "user_1",
    reviewedBy: "admin_1",
    status: "approved",
    transactionRef: "8N7A5D2K1P",
    transactionRefNormalized: "8N7A5D2K1P",
    updatedAt: now,
    ...over,
  };
}

describe("submission fields", () => {
  it("accepts a real bKash transaction id and upper-cases it", () => {
    assert.equal(
      fieldNamed("transactionId").normalize(" 8n7a5d2k1p "),
      "8N7A5D2K1P"
    );
  });

  it("refuses a transaction id that is not ten alphanumerics", () => {
    for (const bad of ["8N7A5D2K1", "8N7A5D2K1PP", "8N7A-5D2K1", ""]) {
      assert.throws(
        () => fieldNamed("transactionId").normalize(bad),
        (error: unknown) =>
          error instanceof BillingError &&
          error.code === "invalid_request" &&
          error.providerCode === "transactionId",
        `"${bad}" should be refused`
      );
    }
  });

  it("is the one field the duplicate check runs on", () => {
    const fields = bkashPersonalBilling().submissionFields?.(ENV) ?? [];
    assert.deepEqual(
      fields.filter((field) => field.reference === true).map((f) => f.id),
      ["transactionId"]
    );
  });

  it("normalizes every shape a Bangladeshi mobile number is written in", () => {
    for (const written of [
      "01712345678",
      "1712345678",
      "+8801712345678",
      "8801712345678",
      "017 1234 5678",
      "017-1234-5678",
    ]) {
      assert.equal(
        fieldNamed("senderNumber").normalize(written),
        "+8801712345678",
        `"${written}" should normalize`
      );
    }
  });

  it("refuses a number that is not a Bangladeshi mobile", () => {
    for (const bad of ["+15551234567", "01212345678", "0171234567", "hello"]) {
      assert.throws(
        () => fieldNamed("senderNumber").normalize(bad),
        (error: unknown) =>
          error instanceof BillingError &&
          error.providerCode === "senderNumber",
        `"${bad}" should be refused`
      );
    }
  });

  it("remembers the sender number and nothing else", () => {
    const fields = bkashPersonalBilling().submissionFields?.(ENV) ?? [];
    assert.deepEqual(
      fields.filter((field) => field.remembered === true).map((f) => f.id),
      ["senderNumber"]
    );
  });

  it("stores the claimed amount in major units, and refuses a non-amount", () => {
    assert.equal(fieldNamed("amount").normalize("৳499"), "499.00");
    assert.equal(fieldNamed("amount").normalize(" 499.5 "), "499.50");
    assert.throws(
      () => fieldNamed("amount").normalize("free"),
      (error: unknown) =>
        error instanceof BillingError && error.providerCode === "amount"
    );
  });
});

describe("checkout", () => {
  it("returns the project's own pay page, carrying the submission id", async () => {
    const result = await bkashPersonalBilling().createCheckout(ENV, CTX, {
      ...checkout,
      submissionId: "sub_1",
    });

    const url = new URL(result.url);
    assert.equal(
      url.origin + url.pathname,
      "https://admin.example.test/billing"
    );
    assert.equal(url.searchParams.get("billing"), "submit");
    assert.equal(url.searchParams.get("submission"), "sub_1");
    // Nothing has been paid, so nothing is minted. The admin approval is what grants.
    assert.equal(result.event, undefined);
  });

  it("refuses a plan priced in anything but taka, naming the plan", () => {
    assert.throws(
      () =>
        bkashPersonalBilling().createCheckout(ENV, CTX, {
          ...checkout,
          planId: "dollars",
        }),
      (error: unknown) =>
        error instanceof BillingError &&
        error.providerCode === "unsupported_currency" &&
        error.message.includes("dollars")
    );
  });

  it("refuses a plan with no price for the interval", () => {
    assert.throws(
      () =>
        bkashPersonalBilling().createCheckout(ENV, CTX, {
          ...checkout,
          interval: "yearly",
          planId: "monthly-only",
        }),
      (error: unknown) =>
        error instanceof BillingError && error.providerCode === "no_price"
    );
  });

  it("refuses when BKASH_PERSONAL_NUMBER is unset, naming the key", () => {
    assert.throws(
      () =>
        bkashPersonalBilling().createCheckout(
          { BILLING_PROVIDER: "bkash-personal" },
          CTX,
          checkout
        ),
      (error: unknown) =>
        error instanceof BillingError &&
        error.providerCode === "unconfigured" &&
        error.message.includes("BKASH_PERSONAL_NUMBER")
    );
  });

  it("mints a trialing row for a trial plan and collects nothing", async () => {
    const result = await bkashPersonalBilling().createCheckout(ENV, CTX, {
      ...checkout,
      planId: "trial",
    });

    assert.equal(result.url, checkout.successUrl);
    assert.equal(result.event?.subscription?.status, "trialing");
    assert.equal(result.event?.subscription?.plan, "trial");
  });
});

describe("instructions", () => {
  it("names the receiving number and the exact figure", () => {
    const instructions = bkashPersonalBilling().manualInstructions?.(ENV, {
      currency: "BDT",
      expectedAmount: 49_900,
      interval: "monthly",
      planId: "pro",
      subject: SUBJECT,
    });

    assert.equal(instructions?.destination, "+8801712345678");
    assert.ok(instructions?.steps.some((step) => step.includes("499.00 BDT")));
    assert.ok(instructions?.note?.includes("no automatic confirmation"));
  });

  it("refuses when the receiving number is unset", () => {
    assert.throws(
      () =>
        bkashPersonalBilling().manualInstructions?.(
          { BILLING_PROVIDER: "bkash-personal" },
          {
            currency: "BDT",
            expectedAmount: 49_900,
            interval: "monthly",
            planId: "pro",
            subject: SUBJECT,
          }
        ),
      (error: unknown) =>
        error instanceof BillingError && error.providerCode === "unconfigured"
    );
  });
});

describe("approval", () => {
  it("grants one month, keyed on the submission id", () => {
    const row = submission();
    const event = bkashPersonalBilling().approveSubmission?.(ENV, {
      submission: row,
    });

    assert.equal(event?.type, "payment.succeeded");
    assert.equal(event?.provider, "bkash-personal");
    // The submission id is the event id, so a double-clicked approval conflicts on the
    // billing_events primary key and grants one period rather than two.
    assert.equal(event?.providerEventId, "sub_1");
    assert.equal(event?.subscription?.status, "active");
    assert.equal(event?.subscription?.plan, "pro");

    const start = event?.subscription?.periodStart as Date;
    const end = event?.subscription?.periodEnd as Date;
    assert.equal(Math.round((end.getTime() - start.getTime()) / DAY), 30);
  });

  it("grants one year on a yearly submission", () => {
    const event = bkashPersonalBilling().approveSubmission?.(ENV, {
      submission: submission({ billingInterval: "yearly" }),
    });

    const start = event?.subscription?.periodStart as Date;
    const end = event?.subscription?.periodEnd as Date;
    assert.equal(Math.round((end.getTime() - start.getTime()) / DAY), 365);
    assert.equal(event?.subscription?.billingInterval, "year");
  });

  it("carries the days left on the current period into the new one", () => {
    const now = Date.now();
    const current = {
      createdAt: new Date(now),
      customerType: "user",
      id: "row_1",
      // A minute of slack: `daysLeft` floors, and the approval runs a few milliseconds
      // after this row is built.
      periodEnd: new Date(now + 10 * DAY + 60_000),
      plan: "pro",
      providerCustomerId: "c",
      providerSubscriptionId: "s",
      referenceId: "user_1",
      status: "past_due",
      updatedAt: new Date(now),
    } as Subscription;

    const event = bkashPersonalBilling().approveSubmission?.(ENV, {
      current,
      submission: submission(),
    });

    const start = event?.subscription?.periodStart as Date;
    const end = event?.subscription?.periodEnd as Date;
    assert.equal(Math.round((end.getTime() - start.getTime()) / DAY), 40);
  });

  it("converges on one row across periods", () => {
    const first = bkashPersonalBilling().approveSubmission?.(ENV, {
      submission: submission({ id: "sub_1" }),
    });
    const second = bkashPersonalBilling().approveSubmission?.(ENV, {
      submission: submission({ id: "sub_2" }),
    });

    assert.equal(
      first?.subscription?.providerSubscriptionId,
      second?.subscription?.providerSubscriptionId
    );
    assert.notEqual(first?.providerEventId, second?.providerEventId);
  });

  it("keeps the quoted figure and the claim in metadata for a human to reconcile", () => {
    const event = bkashPersonalBilling().approveSubmission?.(ENV, {
      submission: submission(),
    });
    const metadata = event?.subscription?.metadata as Record<string, unknown>;

    assert.equal(metadata.expectedAmount, 49_900);
    assert.equal(metadata.transactionRef, "8N7A5D2K1P");
    assert.equal(metadata.reviewedBy, "admin_1");
  });
});

describe("the rest of the contract", () => {
  it("sends the portal caller straight back", async () => {
    const result = await bkashPersonalBilling().createPortal(ENV, CTX, {
      returnUrl: "https://admin.example.test/billing",
      subject: SUBJECT,
    });
    assert.equal(result.url, "https://admin.example.test/billing");
  });

  it("lists no invoices", async () => {
    assert.deepEqual(
      await bkashPersonalBilling().listInvoices(ENV, CTX, { subject: SUBJECT }),
      []
    );
  });

  it("refuses a cancel with no live row", () => {
    assert.throws(
      () => bkashPersonalBilling().cancel(ENV, CTX, { subject: SUBJECT }),
      (error: unknown) =>
        error instanceof BillingError && error.code === "not_found"
    );
  });

  it("refuses fewer than one seat", () => {
    assert.throws(
      () =>
        bkashPersonalBilling().setQuantity(ENV, CTX, {
          seats: 0,
          subject: SUBJECT,
        }),
      (error: unknown) =>
        error instanceof BillingError && error.providerCode === "invalid_seats"
    );
  });

  it("settles manually and renews manually", () => {
    const provider = bkashPersonalBilling();
    assert.equal(provider.settlement, "manual");
    assert.equal(provider.renewal, "manual");
  });
});
