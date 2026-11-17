// Tests for the payment listener's dispatch. Repo-only.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  orderPaymentListener,
  setOrderPaymentHandler,
} from "./payment-listener.ts";
import type { OrderPaymentChange } from "./payment-listener.ts";

function change(referenceType: string): OrderPaymentChange {
  return {
    from: "pending",
    payment: {
      amount: 100,
      currency: "BDT",
      id: "pay-1",
      method: "card",
      providerData: null,
      referenceId: "order-1",
      referenceType,
      status: "successful",
      userId: null,
    },
    to: "successful",
  };
}

describe("orderPaymentListener", () => {
  afterEach(() => {
    setOrderPaymentHandler(undefined);
  });

  it("hands an order's payment to the registered handler", async () => {
    const seen: string[] = [];
    setOrderPaymentHandler(async (_env, next) => {
      seen.push(next.payment.referenceId);
    });
    await orderPaymentListener()({}, change("order"));
    assert.deepEqual(seen, ["order-1"]);
  });

  it("ignores a payment for anything but an order", async () => {
    let called = false;
    setOrderPaymentHandler(async () => {
      called = true;
    });
    await orderPaymentListener()({}, change("subscription"));
    assert.equal(called, false);
  });

  it("throws for an order payment while no handler is registered", async () => {
    await assert.rejects(
      orderPaymentListener()({}, change("order")),
      /handler/
    );
  });
});
