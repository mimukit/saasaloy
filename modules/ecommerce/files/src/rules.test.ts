// Tests for the catalog, stock and cart rules the repositories apply. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EcommerceError } from "./errors.ts";
import {
  assertProductActivatable,
  assertVariantActivatable,
  availableStock,
  holdExpiry,
  isLiveReservation,
  mergedQuantity,
} from "./rules.ts";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EcommerceError, String(error));
    return error.code;
  }
  return undefined;
}

const NOW = new Date("2026-11-17T10:00:00.000Z");
const HOUR = 3_600_000;

describe("assertVariantActivatable", () => {
  it("passes a variant with a price in the store currency", () => {
    assert.doesNotThrow(() =>
      assertVariantActivatable([{ currency: "BDT", amount: 1000 }], "BDT")
    );
  });

  it("refuses a variant with no price, or only another currency", () => {
    assert.equal(
      code(() => assertVariantActivatable([], "BDT")),
      "no_store_price"
    );
    assert.equal(
      code(() =>
        assertVariantActivatable([{ currency: "USD", amount: 1000 }], "BDT")
      ),
      "no_store_price"
    );
  });
});

describe("assertProductActivatable", () => {
  it("passes a product with one active variant", () => {
    assert.doesNotThrow(() =>
      assertProductActivatable([{ active: false }, { active: true }])
    );
  });

  it("refuses a product whose variants are all inactive, or has none", () => {
    assert.equal(
      code(() => assertProductActivatable([{ active: false }])),
      "no_active_variant"
    );
    assert.equal(
      code(() => assertProductActivatable([])),
      "no_active_variant"
    );
  });
});

describe("isLiveReservation", () => {
  it("counts a hold with no expiry and a hold that ends later", () => {
    assert.equal(isLiveReservation({ expiresAt: null }, NOW), true);
    assert.equal(
      isLiveReservation({ expiresAt: new Date(NOW.getTime() + 1) }, NOW),
      true
    );
  });

  it("drops a hold that ended, at the instant it ends too", () => {
    assert.equal(isLiveReservation({ expiresAt: NOW }, NOW), false);
    assert.equal(
      isLiveReservation({ expiresAt: new Date(NOW.getTime() - HOUR) }, NOW),
      false
    );
  });
});

describe("availableStock", () => {
  it("subtracts live holds from on hand and ignores expired ones", () => {
    const holds = [
      { quantity: 2, expiresAt: null },
      { quantity: 1, expiresAt: new Date(NOW.getTime() + HOUR) },
      { quantity: 5, expiresAt: new Date(NOW.getTime() - HOUR) },
    ];
    assert.equal(availableStock(10, holds, NOW), 7);
  });

  it("never goes below zero", () => {
    assert.equal(availableStock(1, [{ quantity: 3, expiresAt: null }], NOW), 0);
  });
});

describe("holdExpiry", () => {
  it("gives a timed hold now plus the lifetime", () => {
    assert.deepEqual(
      holdExpiry("timed", NOW, 24),
      new Date(NOW.getTime() + 24 * HOUR)
    );
  });

  it("gives a held-until-shipped hold no expiry", () => {
    assert.equal(holdExpiry("untimed", NOW, 24), null);
  });
});

describe("mergedQuantity", () => {
  it("adds the guest quantity to the user's", () => {
    assert.equal(mergedQuantity(1, 2, 10), 3);
  });

  it("caps the sum at the available stock", () => {
    assert.equal(mergedQuantity(2, 3, 4), 4);
    assert.equal(mergedQuantity(0, 3, 0), 0);
  });
});
