// Tests for the local hosted checkout: the redirect `create` answers, the page it serves,
// and the form post that moves the payment. Repo-only: the descriptor ships `console.ts`
// and nothing else. It runs on `node:test` via `pnpm test:modules`.
//
// `../index` resolves through the shim beside this module to the real
// `packages/payment` barrel, so the selection, the conditional update and the event rows
// are the ones a deployed Worker runs. Only the database is a fake.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { consolePayment } from "./console.ts";
import { definePayment, setPaymentStoreResolver } from "../index.ts";
import type { Payment, PaymentEventRecord, PaymentStore } from "../index.ts";

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
        return Promise.resolve();
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

beforeEach(() => {
  rows = new Map();
  events = [];
  setPaymentStoreResolver(fakeStore);
});

describe("payment-console", () => {
  it("offers card and redirects to its own checkout page on the api origin", async () => {
    const c = client();
    assert.deepEqual(
      c.methods().map((m) => m.id),
      ["card"]
    );
    const { next, payment } = await c.create(order);
    assert.deepEqual(next, {
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
    assert.equal(reply.kind, "response");
    const html = await (reply as { response: Response }).response.text();
    assert.match(html, /action="\/payment\/callback\/console\/complete"/);
    assert.match(html, /value="pay"/);
    assert.match(html, /value="cancel"/);
    assert.match(html, /1,250\.00/);
  });

  it("Pay makes the payment successful with two events, then returns the browser", async () => {
    const { payment } = await client().create(order);
    const reply = await client().handleCallback(
      "console",
      complete(payment.id, "pay"),
      "complete"
    );
    assert.deepEqual(reply, { kind: "redirect", url: order.returnUrl });
    const row = rows.get(payment.id);
    assert.equal(row?.status, "successful");
    assert.equal(row?.settledAmount, 125_000);
    assert.deepEqual(
      events.map((e) => [e.fromStatus, e.toStatus]),
      [
        [null, "pending"],
        ["pending", "successful"],
      ]
    );
  });

  it("Cancel makes the payment cancelled", async () => {
    const { payment } = await client().create(order);
    await client().handleCallback(
      "console",
      complete(payment.id, "cancel"),
      "complete"
    );
    assert.equal(rows.get(payment.id)?.status, "cancelled");
  });

  it("refuses a form without a valid action", async () => {
    const { payment } = await client().create(order);
    await assert.rejects(
      client().handleCallback(
        "console",
        complete(payment.id, "steal"),
        "complete"
      ),
      { code: "callback_invalid" }
    );
  });
});
