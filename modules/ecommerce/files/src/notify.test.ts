// Tests for the order number and the buyer SMS text. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillOrderMessage, formatOrderNumber } from "./notify.ts";

describe("formatOrderNumber", () => {
  it("puts the prefix before the sequence number", () => {
    assert.equal(formatOrderNumber("ORD-", 1001), "ORD-1001");
  });

  it("takes an empty prefix", () => {
    assert.equal(formatOrderNumber("", 1001), "1001");
  });
});

describe("fillOrderMessage", () => {
  it("fills every placeholder, each as often as it appears", () => {
    assert.equal(
      fillOrderMessage("{shopName}: {orderNumber} is on its way. {shopName}", {
        orderNumber: "ORD-1001",
        shopName: "Shop",
      }),
      "Shop: ORD-1001 is on its way. Shop"
    );
  });

  it("leaves an unknown placeholder as written", () => {
    assert.equal(
      fillOrderMessage("{orderNumber} {name}", {
        orderNumber: "ORD-1",
        shopName: "Shop",
      }),
      "ORD-1 {name}"
    );
  });
});
