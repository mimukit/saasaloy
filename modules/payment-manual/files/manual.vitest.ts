// Tests for the manual provider: the instructions `create` answers, the submission
// checks, the transaction id normalization, and the review flow the core runs on top of
// them. It ships as `packages/payment/src/providers/manual.test.ts` when testing is on,
// and `pnpm test:modules` runs it in place in the saasaloy repo.
//
// `../index` is the real `packages/payment` barrel, so the selection, the status machine
// and the event rows are the ones a deployed Worker runs. Only the database is a fake,
// and it enforces the partial unique index on `(provider, transaction_id_normalized)` the
// way both schema twins declare it.

import { beforeEach, describe, expect, it } from "vitest";
import { definePayment, PaymentError, setPaymentStoreResolver } from "../index";
import type { Payment, PaymentEventRecord, PaymentStore } from "../index";
import { manual, normalizeSender, normalizeTransactionId } from "./manual";

/** A store miss. `Promise.resolve()` is `Promise<void>`, which the store's return types refuse. */
function miss(): Promise<undefined> {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the explicit value is what types it
  return Promise.resolve(undefined);
}

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
        return miss();
      }
      const next = { ...row, refundedAmount: row.refundedAmount + amount };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return miss();
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
        return miss();
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

describe("manual payment provider", () => {
  beforeEach(() => {
    rows = new Map();
    events = [];
    setPaymentStoreResolver(fakeStore);
  });

  describe("payment-manual methods", () => {
    it("offers only the configured methods and reports card unavailable", () => {
      const listed = manual(OPTIONS).methods({});
      expect(listed.map((m) => [m.id, m.available])).toStrictEqual([
        ["bkash", true],
        ["nagad", false],
        ["rocket", false],
        ["bank", true],
        ["card", false],
      ]);
      expect(
        client()
          .methods()
          .map((m) => m.id)
      ).toStrictEqual(["bkash", "bank"]);
    });

    it("offers nothing with no options, the shape the install patch writes", () => {
      expect(client({}).methods()).toStrictEqual([]);
    });

    it("refuses a malformed wallet account at construction", () => {
      expect(() =>
        manual({ methods: { nagad: { account: "12345", kind: "personal" } } })
      ).toThrow(/methods\.nagad\.account/);
    });

    it("refuses a bank account with a missing field at construction", () => {
      expect(() =>
        manual({
          methods: {
            bank: {
              accountName: "R",
              accountNumber: "1",
              bankName: "",
              branch: "G",
            },
          },
        })
      ).toThrow(/methods\.bank\.bankName/);
    });
  });

  describe("payment-manual create", () => {
    it("answers instructions with the configured bkash account, the amount and the fields", async () => {
      const { next, payment } = await client().create(bkashOrder());
      expect(next.kind).toBe("instructions");
      const { instructions } = next as Extract<
        typeof next,
        { kind: "instructions" }
      >;
      expect(instructions.account).toStrictEqual({
        kind: "personal",
        label: "bKash personal",
        name: "Rahim",
        number: "01712345678",
      });
      expect(instructions.note ?? "").toMatch(
        /Send exactly BDT\s1,250\.00\. Use Send Money/
      );
      expect(instructions.fields.map((f) => f.id)).toStrictEqual([
        "transactionId",
        "senderAccount",
        "amount",
      ]);
      expect(payment.provider).toBe("manual");
    });

    it("opens a manual bkash payment and keeps the instructions on the row", async () => {
      const { next, payment } = await client().create(bkashOrder());
      const { instructions } = next as Extract<
        typeof next,
        { kind: "instructions" }
      >;
      expect({
        method: payment.method,
        provider: payment.provider,
      }).toStrictEqual({
        method: "bkash",
        provider: "manual",
      });
      // The core keeps the instructions, which is what the admin page reads.
      expect(rows.get(payment.id)?.providerData?.instructions).toStrictEqual(
        instructions
      );
    });

    it("answers the bank account with its branch and routing number", async () => {
      const { next } = await client().create({
        ...bkashOrder(),
        method: "bank",
      });
      const { instructions } = next as Extract<
        typeof next,
        { kind: "instructions" }
      >;
      expect(instructions.account.number).toBe("1501 2345 6789 01");
      expect(instructions.account.label).toBe("City Bank");
      expect(instructions.note ?? "").toMatch(
        /Branch: Gulshan\. Routing number: 225261725\./
      );
    });

    it("throws method_unavailable for card", async () => {
      await expect(
        client().create({ ...bkashOrder(), method: "card" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "method_unavailable",
        })
      );
    });

    it("throws method_unavailable for a method with no account", async () => {
      await expect(
        client().create({ ...bkashOrder(), method: "nagad" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "method_unavailable",
        })
      );
    });

    it("refuses a wallet payment that is not in BDT and closes the row", async () => {
      await expect(
        client().create({ ...bkashOrder(), currency: "USD" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "unsupported_currency",
        })
      );
      expect([...rows.values()].map((r) => r.status)).toStrictEqual(["failed"]);
    });
  });

  describe("payment-manual submit and review", () => {
    it("moves the payment to submitted with the normalized values", async () => {
      const payment = await submitted();
      expect({
        claimedAmount: payment.claimedAmount,
        senderAccount: payment.senderAccount,
        status: payment.status,
        transactionId: payment.transactionId,
        transactionIdNormalized: payment.transactionIdNormalized,
      }).toStrictEqual({
        claimedAmount: 125_000,
        senderAccount: "+8801812345678",
        status: "submitted",
        transactionId: "8n7a5d2k1p",
        transactionIdNormalized: "8N7A5D2K1P",
      });
      expect(payment.submittedAt instanceof Date).toBeTruthy();
      expect(events.map((e) => [e.fromStatus, e.toStatus])).toStrictEqual([
        [null, "pending"],
        ["pending", "submitted"],
      ]);
    });

    it("answers duplicate_transaction for a second payment with the same id", async () => {
      await submitted("8N7A5D2K1P");
      await expect(submitted(" 8n7a5d2k1p ")).rejects.toThrow(
        expect.objectContaining({
          code: "duplicate_transaction",
        })
      );
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
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason.code).toBe("conflict");
      const row = rows.get(payment.id);
      expect({
        settledAmount: row?.settledAmount,
        status: row?.status,
      }).toStrictEqual({
        settledAmount: 125_000,
        status: "successful",
      });
      expect(row?.settledAt instanceof Date).toBeTruthy();
    });

    it("lets a rejected transaction id be submitted again on a new payment", async () => {
      const first = await submitted();
      await expect(submitted()).rejects.toThrow(
        expect.objectContaining({ code: "duplicate_transaction" })
      );
      await client().reject(first.id, { reason: "not_found" });
      const again = await submitted();
      expect(again.status).toBe("submitted");
      expect(again.transactionIdNormalized).toBe("8N7A5D2K1P");
      expect(rows.get(first.id)?.status).toBe("failed");
    });

    it("refuses a malformed submission and leaves the payment pending", async () => {
      const c = client();
      const { payment } = await c.create(bkashOrder());
      await expect(
        c.submit(payment.id, { ...submission, senderAccount: "12345" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "senderAccount",
        })
      );
      await expect(
        c.submit(payment.id, { ...submission, amount: 0 })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "amount",
        })
      );
      await expect(
        c.submit(payment.id, { ...submission, transactionId: "SHORT" })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "transactionId",
        })
      );
      expect(rows.get(payment.id)?.status).toBe("pending");
    });

    it("records a refund staff sent by hand, with no vendor id", async () => {
      const payment = await submitted();
      const c = client();
      await c.confirm(payment.id);
      const { refund, payment: after } = await c.refund(payment.id, {
        amount: 25_000,
        note: "sent back by bKash",
      });
      expect(refund.amount).toBe(25_000);
      expect(refund.providerRefundId).toBeNull();
      expect(after.refundedAmount).toBe(25_000);
    });

    it("ignores anything posted to its callback surface", async () => {
      const reply = await client().handleCallback(
        "manual",
        new Request("http://localhost:4000/payment/callback/manual/x", {
          method: "POST",
        }),
        "x"
      );
      expect(reply).toStrictEqual({ kind: "ignored" });
    });
  });

  describe("payment-manual normalization", () => {
    it("trims and upper-cases a transaction id and checks its shape per method", () => {
      expect(normalizeTransactionId("bkash", "  8n7a5d2k1p ")).toStrictEqual({
        normalized: "8N7A5D2K1P",
        typed: "8n7a5d2k1p",
      });
      expect(normalizeTransactionId("nagad", "71a2b3c4").normalized).toBe(
        "71A2B3C4"
      );
      expect(normalizeTransactionId("bank", "ft24/123-abc").normalized).toBe(
        "FT24/123-ABC"
      );
    });

    it("refuses a transaction id of the wrong shape or for an unknown method", () => {
      expect(() => normalizeTransactionId("bkash", "8N7A5D2K1")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
      expect(() => normalizeTransactionId("bkash", "8N7A5D2K1P!")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
      expect(() => normalizeTransactionId("rocket", "")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
        })
      );
      expect(() => normalizeTransactionId("toString", "8N7A5D2K1P")).toThrow(
        expect.objectContaining({
          code: "method_unavailable",
        })
      );
    });

    it("normalizes a wallet sender through bangladeshMobile and a bank sender to digits", () => {
      expect(normalizeSender("bkash", "017-1234-5678")).toBe("+8801712345678");
      expect(normalizeSender("rocket", "8801912345678")).toBe("+8801912345678");
      expect(() => normalizeSender("nagad", "01212345678")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "senderAccount",
        })
      );
      expect(normalizeSender("bank", "1501 2345-6789 01")).toBe(
        "15012345678901"
      );
      expect(() => normalizeSender("bank", "12ab")).toThrow(
        expect.objectContaining({
          code: "invalid_request",
          providerCode: "senderAccount",
        })
      );
    });
  });
});
