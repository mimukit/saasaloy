// The vendor-blind half of manual settlement: the field validator, the reference rule, the
// pre-fill, the change flag, and `defineBilling` refusing an incomplete manual provider.
//
// No database here. The store port is where the partial unique index and the conditional
// update live, and those are proved against a real driver in the QA plan rather than against
// a fake that would only ever agree with itself.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineBilling } from "./define.ts";
import { BillingError } from "./provider.ts";
import type {
  BillingProvider,
  PaymentSubmission,
  SubmissionField,
} from "./provider.ts";
import {
  normalizeFields,
  normalizeReference,
  prefillFrom,
  referenceField,
  rememberedChanged,
} from "./submission.ts";

const TRX: SubmissionField = {
  id: "transactionId",
  label: "Transaction ID",
  normalize: (value) => {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length !== 10) {
      throw new BillingError("invalid_request", "ten characters, please", {
        providerCode: "transactionId",
      });
    }
    return trimmed;
  },
  reference: true,
  type: "text",
};

const SENDER: SubmissionField = {
  id: "senderNumber",
  label: "Sender number",
  normalize: (value) => value.trim(),
  remembered: true,
  type: "tel",
};

const FIELDS = [TRX, SENDER];

/** No earlier submission. Named, because the two helpers take it as a real argument. */
const noPrevious: PaymentSubmission | undefined = undefined;

function row(over: Partial<PaymentSubmission> = {}): PaymentSubmission {
  const now = new Date("2026-09-21T00:00:00.000Z");
  return {
    billingInterval: "monthly",
    createdAt: now,
    currency: "BDT",
    customerType: "user",
    expectedAmount: 49_900,
    fields: { senderNumber: "+8801712345678", transactionId: "8N7A5D2K1P" },
    id: "sub_1",
    plan: "pro",
    provider: "test",
    referenceId: "user_1",
    status: "pending",
    updatedAt: now,
    ...over,
  };
}

/** A provider that satisfies the whole contract. Tests below take members off it. */
const stub = () => Promise.resolve({ url: "" });

function manualProvider(over: Partial<BillingProvider> = {}): BillingProvider {
  return {
    approveSubmission: () => {
      throw new Error("not called");
    },
    cancel: () => Promise.resolve(),
    changePlan: stub,
    createCheckout: stub,
    createPortal: () => Promise.resolve({ url: "" }),
    listInvoices: () => Promise.resolve([]),
    manualInstructions: () => ({
      destination: "x",
      heading: "h",
      steps: [],
    }),
    name: "manual-test",
    restore: () => Promise.resolve(),
    setQuantity: () => Promise.resolve(),
    settlement: "manual",
    submissionFields: () => FIELDS,
    ...over,
  };
}

describe("referenceField", () => {
  it("returns the one field marked reference", () => {
    assert.equal(referenceField("test", FIELDS).id, "transactionId");
  });

  it("refuses a spec with no reference field", () => {
    assert.throws(
      () => referenceField("test", [SENDER]),
      (error: unknown) =>
        error instanceof BillingError && error.message.includes("exactly one")
    );
  });

  it("refuses a spec with two", () => {
    assert.throws(() =>
      referenceField("test", [TRX, { ...SENDER, reference: true }])
    );
  });
});

describe("normalizeReference", () => {
  it("makes one claim out of two spellings", () => {
    assert.equal(normalizeReference(" 8n7a5d2k1p "), "8N7A5D2K1P");
    assert.equal(
      normalizeReference("8N7A5D2K1P"),
      normalizeReference("8n7a5d2k1p")
    );
  });
});

describe("normalizeFields", () => {
  it("runs every value through the provider's own rule", () => {
    assert.deepEqual(
      normalizeFields(FIELDS, {
        senderNumber: " +8801712345678 ",
        transactionId: " 8n7a5d2k1p ",
      }),
      { senderNumber: "+8801712345678", transactionId: "8N7A5D2K1P" }
    );
  });

  it("refuses a missing value, naming the field", () => {
    assert.throws(
      () => normalizeFields(FIELDS, { transactionId: "8N7A5D2K1P" }),
      (error: unknown) =>
        error instanceof BillingError &&
        error.providerCode === "senderNumber" &&
        error.code === "invalid_request"
    );
  });

  it("refuses a blank value the same way", () => {
    assert.throws(() =>
      normalizeFields(FIELDS, {
        senderNumber: "   ",
        transactionId: "8N7A5D2K1P",
      })
    );
  });

  it("lets the provider's rule refuse a malformed value", () => {
    assert.throws(
      () =>
        normalizeFields(FIELDS, {
          senderNumber: "+8801712345678",
          transactionId: "short",
        }),
      (error: unknown) =>
        error instanceof BillingError && error.providerCode === "transactionId"
    );
  });

  it("drops a key nobody asked for", () => {
    const values = normalizeFields(FIELDS, {
      nonsense: "x",
      senderNumber: "+8801712345678",
      transactionId: "8N7A5D2K1P",
    });
    assert.equal("nonsense" in values, false);
  });
});

describe("prefillFrom", () => {
  it("is empty on a first submission", () => {
    assert.deepEqual(prefillFrom(FIELDS, noPrevious), {});
  });

  it("carries the remembered fields and never the reference", () => {
    assert.deepEqual(prefillFrom(FIELDS, row()), {
      senderNumber: "+8801712345678",
    });
  });
});

describe("rememberedChanged", () => {
  it("is false with nothing to compare against", () => {
    assert.equal(rememberedChanged(FIELDS, row(), noPrevious), false);
  });

  it("is false when the sender number is the same", () => {
    assert.equal(rememberedChanged(FIELDS, row(), row({ id: "sub_0" })), false);
  });

  it("is true when it differs", () => {
    const previous = row({
      fields: { senderNumber: "+8801999999999", transactionId: "AAAAAAAAAA" },
      id: "sub_0",
    });
    assert.equal(rememberedChanged(FIELDS, row(), previous), true);
  });
});

describe("defineBilling", () => {
  it("registers a complete manual provider", () => {
    const registry = defineBilling({ providers: [manualProvider()] });
    const client = registry.create({ BILLING_PROVIDER: "manual-test" });
    assert.equal(client.settlement, "manual");
    assert.deepEqual(client.submissionFields(), FIELDS);
  });

  it("refuses a manual provider missing any of the three members", () => {
    for (const member of [
      "manualInstructions",
      "submissionFields",
      "approveSubmission",
    ] as const) {
      assert.throws(
        () =>
          defineBilling({
            providers: [manualProvider({ [member]: undefined })],
          }),
        (error: unknown) =>
          error instanceof BillingError && error.message.includes(member),
        `${member} should be required`
      );
    }
  });

  it("leaves a vendor provider alone, and refuses its manual members", () => {
    const registry = defineBilling({
      providers: [
        manualProvider({
          approveSubmission: undefined,
          manualInstructions: undefined,
          name: "vendor-test",
          settlement: undefined,
          submissionFields: undefined,
        }),
      ],
    });

    const client = registry.create({ BILLING_PROVIDER: "vendor-test" });
    assert.equal(client.settlement, "vendor");
    assert.throws(
      () => client.submissionFields(),
      (error: unknown) =>
        error instanceof BillingError && error.code === "invalid_request"
    );
  });
});
