// Tests for the local hosted checkout: the redirect `create` answers, the page it serves,
// and the form post that moves the payment. It ships as `console.test.ts` beside the
// provider when testing is on, and `pnpm test:modules` runs it in place in the saasaloy
// repo.
//
// `../index` resolves by its project path to the real `packages/payment` barrel, so the
// selection, the conditional update and the event rows are the ones a deployed Worker
// runs. Only the database is a fake.

import { beforeEach, describe, expect, it } from "vitest";
import { consolePayment } from "./console";
import { definePayment, setPaymentStoreResolver } from "../index";
import type { Payment, PaymentEventRecord, PaymentStore } from "../index";

/** A store miss. `Promise.resolve()` is `Promise<void>`, which the store's return types refuse. */
function miss(): Promise<undefined> {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- the explicit value is what types it
  return Promise.resolve(undefined);
}

const ENV = {
  BETTER_AUTH_URL: "http://localhost:4000",
  PAYMENT_PROVIDER: "console",
};

let rows: Map<string, Payment>;
let events: PaymentEventRecord[];

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
        status: "pending",
        submittedAt: null,
        settledAt: null,
        transactionId: null,
        transactionIdNormalized: null,
        updatedAt: now,
      };
      rows.set(row.id, payment);
      return Promise.resolve(payment);
    },
    insertRefund: (record) =>
      Promise.resolve({ ...record, createdAt: new Date(), id: "r_1" }),
    releaseRefund: () => Promise.resolve(),
    reserveRefund: (id) => Promise.resolve(rows.get(id)),
    transition(id, from, to, patch) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) {
        return miss();
      }
      const next = { ...row, ...patch, status: to };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    updatePayment: (id) => Promise.resolve(rows.get(id)),
  };
}

const client = () =>
  definePayment({ listeners: [], providers: [consolePayment()] }).create(ENV);

const order = {
  amount: 125_000,
  currency: "BDT",
  method: "card",
  referenceId: "o_1",
  referenceType: "order",
  returnUrl: "http://localhost:3000/orders/o_1",
};

function complete(paymentId: string, action: string) {
  const body = new FormData();
  body.set("paymentId", paymentId);
  body.set("action", action);
  return new Request(
    "http://localhost:4000/payment/callback/console/complete",
    { body, method: "POST" }
  );
}

describe("console provider", () => {
  beforeEach(() => {
    rows = new Map();
    events = [];
    setPaymentStoreResolver(fakeStore);
  });

  describe("payment-console", () => {
    it("offers card and redirects to its own checkout page on the api origin", async () => {
      const c = client();
      expect(c.methods().map((m) => m.id)).toStrictEqual(["card"]);
      const { next, payment } = await c.create(order);
      expect(next).toStrictEqual({
        kind: "redirect",
        url: `http://localhost:4000/payment/callback/console/checkout/${payment.id}`,
      });
    });

    it("serves a checkout page with Pay and Cancel that posts to /complete", async () => {
      const { payment } = await client().create(order);
      const reply = await client().handleCallback(
        "console",
        new Request(`http://localhost:4000/x`),
        `checkout/${payment.id}`
      );
      expect(reply.kind).toBe("response");
      const html = await (reply as { response: Response }).response.text();
      expect(html).toMatch(/action="\/payment\/callback\/console\/complete"/);
      expect(html).toMatch(/value="pay"/);
      expect(html).toMatch(/value="cancel"/);
      expect(html).toMatch(/1,250\.00/);
    });

    it("Pay makes the payment successful with two events, then returns the browser", async () => {
      const { payment } = await client().create(order);
      const reply = await client().handleCallback(
        "console",
        complete(payment.id, "pay"),
        "complete"
      );
      expect(reply).toStrictEqual({ kind: "redirect", url: order.returnUrl });
      const row = rows.get(payment.id);
      expect(row?.status).toBe("successful");
      expect(row?.settledAmount).toBe(125_000);
      expect(events.map((e) => [e.fromStatus, e.toStatus])).toStrictEqual([
        [null, "pending"],
        ["pending", "successful"],
      ]);
    });

    it("Cancel makes the payment cancelled", async () => {
      const { payment } = await client().create(order);
      await client().handleCallback(
        "console",
        complete(payment.id, "cancel"),
        "complete"
      );
      expect(rows.get(payment.id)?.status).toBe("cancelled");
    });

    it("refuses a form without a valid action", async () => {
      const { payment } = await client().create(order);
      await expect(
        client().handleCallback(
          "console",
          complete(payment.id, "steal"),
          "complete"
        )
      ).rejects.toThrow(expect.objectContaining({ code: "callback_invalid" }));
    });
  });
});
