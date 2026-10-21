// Tests for the manual provider: the instructions `create` answers, the submission checks,
// the transaction id normalization, and the review flow the core runs on top of them.
// Repo-only: the descriptor ships `manual.ts` and nothing else. It runs on `node:test` via
// `pnpm test:modules`.
//
// `../index` resolves through the shim beside this module to the real `packages/payment`
// barrel, so the selection, the status machine and the event rows are the ones a deployed
// Worker runs. Only the database is a fake, and it enforces the partial unique index on
// `(provider, transaction_id_normalized)` the way both schema twins declare it.
//
// `@repo/validators/phone` is a workspace package in a generated project and is not
// installed in this repo, so the hook below maps it onto the real file in
// `modules/validators`. The provider is imported after the hook is registered.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";
import {
  definePayment,
  PaymentError,
  setPaymentStoreResolver,
} from "../index.ts";
import type { Payment, PaymentEventRecord, PaymentStore } from "../index.ts";

const PHONE = new URL("../../validators/files/src/phone.ts", import.meta.url)
  .href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@repo/validators/phone") {
      return { shortCircuit: true, url: PHONE };
    }
    return nextResolve(specifier, context);
  },
});

const { manual, normalizeSender, normalizeTransactionId } =
  await import("./manual.ts");

const ENV = { PAYMENT_PROVIDER: "manual" };

const OPTIONS = {
  methods: {
    bank: {
      accountName: "Rahim Traders",
      accountNumber: "1501 2345 6789 01",
      bankName: "City Bank",
      branch: "Gulshan",
      routingNumber: "225261725",
    },
    bkash: {
      account: "+880 1712-345678",
      kind: "personal" as const,
      name: "Rahim",
    },
  },
};

let rows: Map<string, Payment>;
let events: PaymentEventRecord[];

/** The partial unique index: one live claim per id, per provider. */
function claimed(
  id: string,
  provider: string,
  normalized: string | null | undefined
) {
  if (!normalized) {
    return false;
  }
  return [...rows.values()].some(
    (row) =>
      row.id !== id &&
      row.provider === provider &&
      row.transactionIdNormalized === normalized &&
      row.status !== "failed" &&
      row.status !== "cancelled"
  );
}

function fakeStore(): PaymentStore {
  return {
    appendEvent(record) {
      events.push(record);
      return Promise.resolve();
    },
    findPayment: (id) => Promise.resolve(rows.get(id)),
    insertPayment(row) {
      const now = new Date();
      const payment: Payment = {
        ...row,
        claimedAmount: null,
        createdAt: now,
        providerData: null,
        refundedAmount: 0,
        senderAccount: null,
        settledAmount: null,
        settledAt: null,
        status: "pending",
        submittedAt: null,
        transactionId: null,
        transactionIdNormalized: null,
        updatedAt: now,
      };
      rows.set(row.id, payment);
      return Promise.resolve(payment);
    },
    insertRefund: (record) =>
      Promise.resolve({
        ...record,
        createdAt: new Date(),
        id: `r_${String(events.length)}`,
      }),
    releaseRefund: () => Promise.resolve(),
    reserveRefund(id, amount) {
      const row = rows.get(id);
      if (
        !row ||
        row.status !== "successful" ||
        row.refundedAmount + amount > row.amount
      ) {
        return Promise.resolve();
      }
      const next = { ...row, refundedAmount: row.refundedAmount + amount };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return Promise.resolve();
      }
      const next = { ...row, ...patch, status: to };
      if (
        to !== "failed" &&
        to !== "cancelled" &&
        claimed(id, row.provider, next.transactionIdNormalized)
      ) {
        return Promise.reject(
          new PaymentError("duplicate_transaction", "UNIQUE constraint failed")
        );
      }
      rows.set(id, next);
      return Promise.resolve(next);
    },
    updatePayment(id, patch) {
      const row = rows.get(id);
      if (!row) {
        return Promise.resolve();
      }
      const next = { ...row, ...patch };
      rows.set(id, next);
      return Promise.resolve(next);
    },
  };
}

const client = (options: Parameters<typeof manual>[0] = OPTIONS) =>
  definePayment({ listeners: [], providers: [manual(options)] }).create(ENV);

let order = 0;
const bkashOrder = () => ({
  amount: 125_000,
  currency: "BDT",
  method: "bkash",
  referenceId: `o_${String((order += 1))}`,
  referenceType: "order",
});

const submission = {
  amount: 125_000,
  senderAccount: "01812345678",
  transactionId: "8n7a5d2k1p",
};

async function submitted(transactionId = submission.transactionId) {
  const c = client();
  const { payment } = await c.create(bkashOrder());
  return c.submit(payment.id, { ...submission, transactionId });
}

beforeEach(() => {
  rows = new Map();
  events = [];
  setPaymentStoreResolver(fakeStore);
});

describe("payment-manual methods", () => {
  it("offers only the configured methods and reports card unavailable", () => {
    const listed = manual(OPTIONS).methods({});
    assert.deepEqual(
      listed.map((m) => [m.id, m.available]),
      [
        ["bkash", true],
        ["nagad", false],
        ["rocket", false],
        ["bank", true],
        ["card", false],
      ]
    );
    assert.deepEqual(
      client()
        .methods()
        .map((m) => m.id),
      ["bkash", "bank"]
    );
  });

  it("offers nothing with no options, the shape the install patch writes", () => {
    assert.deepEqual(client({}).methods(), []);
  });

  it("refuses a malformed wallet account at construction", () => {
    assert.throws(
      () =>
        manual({ methods: { nagad: { account: "12345", kind: "personal" } } }),
      /methods\.nagad\.account/
    );
  });

  it("refuses a bank account with a missing field at construction", () => {
    assert.throws(
      () =>
        manual({
          methods: {
            bank: {
              accountName: "R",
              accountNumber: "1",
              bankName: "",
              branch: "G",
            },
          },
        }),
      /methods\.bank\.bankName/
    );
  });
});

describe("payment-manual create", () => {
  it("answers instructions with the configured bkash account, the amount and the fields", async () => {
    const { next, payment } = await client().create(bkashOrder());
    assert.equal(next.kind, "instructions");
    const { instructions } = next as Extract<
      typeof next,
      { kind: "instructions" }
    >;
    assert.deepEqual(instructions.account, {
      kind: "personal",
      label: "bKash personal",
      name: "Rahim",
      number: "01712345678",
    });
    assert.match(
      instructions.note ?? "",
      /Send exactly BDT\s1,250\.00\. Use Send Money/
    );
    assert.deepEqual(
      instructions.fields.map((f) => f.id),
      ["transactionId", "senderAccount", "amount"]
    );
    assert.equal(payment.provider, "manual");
    assert.equal(payment.method, "bkash");
    // The core keeps the instructions, which is what the admin page reads.
    assert.deepEqual(
      rows.get(payment.id)?.providerData?.instructions,
      instructions
    );
  });

  it("answers the bank account with its branch and routing number", async () => {
    const { next } = await client().create({ ...bkashOrder(), method: "bank" });
    const { instructions } = next as Extract<
      typeof next,
      { kind: "instructions" }
    >;
    assert.equal(instructions.account.number, "1501 2345 6789 01");
    assert.equal(instructions.account.label, "City Bank");
    assert.match(
      instructions.note ?? "",
      /Branch: Gulshan\. Routing number: 225261725\./
    );
  });

  it("throws method_unavailable for card", async () => {
    await assert.rejects(client().create({ ...bkashOrder(), method: "card" }), {
      code: "method_unavailable",
    });
  });

  it("throws method_unavailable for a method with no account", async () => {
    await assert.rejects(
      client().create({ ...bkashOrder(), method: "nagad" }),
      {
        code: "method_unavailable",
      }
    );
  });

  it("refuses a wallet payment that is not in BDT and closes the row", async () => {
    await assert.rejects(
      client().create({ ...bkashOrder(), currency: "USD" }),
      {
        code: "invalid_request",
        providerCode: "unsupported_currency",
      }
    );
    assert.deepEqual(
      [...rows.values()].map((r) => r.status),
      ["failed"]
    );
  });
});

describe("payment-manual submit and review", () => {
  it("moves the payment to submitted with the normalized values", async () => {
    const payment = await submitted();
    assert.equal(payment.status, "submitted");
    assert.equal(payment.transactionId, "8n7a5d2k1p");
    assert.equal(payment.transactionIdNormalized, "8N7A5D2K1P");
    assert.equal(payment.senderAccount, "+8801812345678");
    assert.equal(payment.claimedAmount, 125_000);
    assert.ok(payment.submittedAt instanceof Date);
    assert.deepEqual(
      events.map((e) => [e.fromStatus, e.toStatus]),
      [
        [null, "pending"],
        ["pending", "submitted"],
      ]
    );
  });

  it("answers duplicate_transaction for a second payment with the same id", async () => {
    await submitted("8N7A5D2K1P");
    await assert.rejects(submitted(" 8n7a5d2k1p "), {
      code: "duplicate_transaction",
    });
  });

  it("confirms to successful, and two concurrent confirms give one success and one conflict", async () => {
    const payment = await submitted();
    const c = client();
    const results = await Promise.allSettled([
      c.confirm(payment.id),
      c.confirm(payment.id),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.equal((lost[0] as PromiseRejectedResult).reason.code, "conflict");
    const row = rows.get(payment.id);
    assert.equal(row?.status, "successful");
    assert.equal(row?.settledAmount, 125_000);
    assert.ok(row?.settledAt instanceof Date);
  });

  it("lets a rejected transaction id be submitted again on a new payment", async () => {
    const first = await submitted();
    await assert.rejects(submitted(), { code: "duplicate_transaction" });
    await client().reject(first.id, { reason: "not_found" });
    const again = await submitted();
    assert.equal(again.status, "submitted");
    assert.equal(again.transactionIdNormalized, "8N7A5D2K1P");
    assert.equal(rows.get(first.id)?.status, "failed");
  });

  it("refuses a malformed submission and leaves the payment pending", async () => {
    const c = client();
    const { payment } = await c.create(bkashOrder());
    await assert.rejects(
      c.submit(payment.id, { ...submission, senderAccount: "12345" }),
      {
        code: "invalid_request",
        providerCode: "senderAccount",
      }
    );
    await assert.rejects(c.submit(payment.id, { ...submission, amount: 0 }), {
      code: "invalid_request",
      providerCode: "amount",
    });
    await assert.rejects(
      c.submit(payment.id, { ...submission, transactionId: "SHORT" }),
      {
        code: "invalid_request",
        providerCode: "transactionId",
      }
    );
    assert.equal(rows.get(payment.id)?.status, "pending");
  });

  it("records a refund staff sent by hand, with no vendor id", async () => {
    const payment = await submitted();
    const c = client();
    await c.confirm(payment.id);
    const { refund, payment: after } = await c.refund(payment.id, {
      amount: 25_000,
      note: "sent back by bKash",
    });
    assert.equal(refund.amount, 25_000);
    assert.equal(refund.providerRefundId, null);
    assert.equal(after.refundedAmount, 25_000);
  });

  it("ignores anything posted to its callback surface", async () => {
    const reply = await client().handleCallback(
      "manual",
      new Request("http://localhost:4000/payment/callback/manual/x", {
        method: "POST",
      }),
      "x"
    );
    assert.deepEqual(reply, { kind: "ignored" });
  });
});

describe("payment-manual normalization", () => {
  it("trims and upper-cases a transaction id and checks its shape per method", () => {
    assert.deepEqual(normalizeTransactionId("bkash", "  8n7a5d2k1p "), {
      normalized: "8N7A5D2K1P",
      typed: "8n7a5d2k1p",
    });
    assert.equal(
      normalizeTransactionId("nagad", "71a2b3c4").normalized,
      "71A2B3C4"
    );
    assert.equal(
      normalizeTransactionId("bank", "ft24/123-abc").normalized,
      "FT24/123-ABC"
    );
    assert.throws(() => normalizeTransactionId("bkash", "8N7A5D2K1"), {
      code: "invalid_request",
    });
    assert.throws(() => normalizeTransactionId("bkash", "8N7A5D2K1P!"), {
      code: "invalid_request",
    });
    assert.throws(() => normalizeTransactionId("rocket", ""), {
      code: "invalid_request",
    });
    assert.throws(() => normalizeTransactionId("toString", "8N7A5D2K1P"), {
      code: "method_unavailable",
    });
  });

  it("normalizes a wallet sender through bangladeshMobile and a bank sender to digits", () => {
    assert.equal(normalizeSender("bkash", "017-1234-5678"), "+8801712345678");
    assert.equal(normalizeSender("rocket", "8801912345678"), "+8801912345678");
    assert.throws(() => normalizeSender("nagad", "01212345678"), {
      code: "invalid_request",
      providerCode: "senderAccount",
    });
    assert.equal(
      normalizeSender("bank", "1501 2345-6789 01"),
      "15012345678901"
    );
    assert.throws(() => normalizeSender("bank", "12ab"), {
      code: "invalid_request",
      providerCode: "senderAccount",
    });
  });
});
