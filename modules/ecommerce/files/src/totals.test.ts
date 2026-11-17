// Tests for the cart and order totals. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EcommerceError } from "./errors.ts";
import { cartTotals, lineTotal, orderTotals } from "./totals.ts";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EcommerceError, String(error));
    return error.code;
  }
  return undefined;
}

const shirt = { unitPrice: 125_000, quantity: 2, currency: "BDT" };
const mug = { unitPrice: 45_050, quantity: 1, currency: "BDT" };

describe("lineTotal", () => {
  it("multiplies the unit price by the quantity", () => {
    assert.equal(lineTotal(shirt), 250_000);
  });

  it("refuses a zero or fractional quantity", () => {
    assert.equal(
      code(() => lineTotal({ ...shirt, quantity: 0 })),
      "invalid_quantity"
    );
    assert.equal(
      code(() => lineTotal({ ...shirt, quantity: 1.5 })),
      "invalid_quantity"
    );
  });
});

describe("cartTotals", () => {
  it("sums the lines and counts the items", () => {
    assert.deepEqual(cartTotals([shirt, mug], "BDT"), {
      currency: "BDT",
      itemCount: 3,
      subtotal: 295_050,
    });
  });

  it("gives an empty cart a zero subtotal", () => {
    assert.deepEqual(cartTotals([], "BDT"), {
      currency: "BDT",
      itemCount: 0,
      subtotal: 0,
    });
  });

  it("refuses a line in another currency", () => {
    assert.equal(
      code(() => cartTotals([shirt, { ...mug, currency: "USD" }], "BDT")),
      "currency_mismatch"
    );
  });
});

describe("orderTotals", () => {
  it("adds the shipping rate to the subtotal", () => {
    assert.deepEqual(
      orderTotals({ currency: "BDT", lines: [shirt, mug], shipping: 6000 }),
      {
        currency: "BDT",
        itemCount: 3,
        shipping: 6000,
        subtotal: 295_050,
        total: 301_050,
      }
    );
  });

  it("refuses an order with no lines", () => {
    assert.equal(
      code(() => orderTotals({ currency: "BDT", lines: [], shipping: 0 })),
      "empty_order"
    );
  });

  it("refuses a negative or fractional shipping rate", () => {
    for (const shipping of [-1, 0.5]) {
      assert.equal(
        code(() => orderTotals({ currency: "BDT", lines: [mug], shipping })),
        "invalid_amount",
        String(shipping)
      );
    }
  });
});
