// Tests for the order status machine. Repo-only.
//
// The table is plan 0106's grill Q2 table, written out again here on purpose: a change to
// `ORDER_TRANSITIONS` must also change this list, or the test goes red.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EcommerceError } from "./errors.ts";
import {
  assertTransition,
  canTransition,
  isOrderStatus,
  isTerminalStatus,
  nextStatuses,
  ORDER_STATUSES,
} from "./status.ts";
import type { OrderStatus } from "./status.ts";

const ALLOWED: readonly (readonly [OrderStatus, OrderStatus])[] = [
  ["placed", "confirmed"],
  ["placed", "cancelled"],
  ["confirmed", "shipped"],
  ["confirmed", "cancelled"],
  ["shipped", "delivered"],
  ["shipped", "returned"],
];

const allowed = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));

describe("order statuses", () => {
  it("are the six the plan names", () => {
    assert.deepEqual([...ORDER_STATUSES].toSorted(), [
      "cancelled",
      "confirmed",
      "delivered",
      "placed",
      "returned",
      "shipped",
    ]);
  });

  it("recognises a status and refuses other text", () => {
    assert.equal(isOrderStatus("placed"), true);
    assert.equal(isOrderStatus("paid"), false);
    assert.equal(isOrderStatus(null), false);
  });
});

describe("canTransition", () => {
  it("allows every transition in the table", () => {
    for (const [from, to] of ALLOWED) {
      assert.equal(canTransition(from, to), true, `${from}->${to}`);
    }
  });

  it("refuses every transition outside the table, self moves included", () => {
    let refused = 0;
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (allowed.has(`${from}->${to}`)) {
          continue;
        }
        assert.equal(canTransition(from, to), false, `${from}->${to}`);
        refused += 1;
      }
    }
    assert.equal(refused, 36 - ALLOWED.length);
  });

  it("refuses an unknown status on either side", () => {
    assert.equal(canTransition("placed", "paid"), false);
    assert.equal(canTransition("paid", "confirmed"), false);
  });
});

describe("assertTransition", () => {
  it("passes an allowed transition", () => {
    assert.doesNotThrow(() => assertTransition("confirmed", "shipped"));
  });

  it("throws invalid_transition for every refused one", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (allowed.has(`${from}->${to}`)) {
          continue;
        }
        assert.throws(
          () => assertTransition(from, to),
          (error: unknown) =>
            error instanceof EcommerceError &&
            error.code === "invalid_transition",
          `${from}->${to}`
        );
      }
    }
  });
});

describe("nextStatuses", () => {
  it("lists the moves out of each status", () => {
    assert.deepEqual(nextStatuses("placed"), ["confirmed", "cancelled"]);
    assert.deepEqual(nextStatuses("confirmed"), ["shipped", "cancelled"]);
    assert.deepEqual(nextStatuses("shipped"), ["delivered", "returned"]);
    assert.deepEqual(nextStatuses("delivered"), []);
  });

  it("marks delivered, cancelled and returned as terminal", () => {
    assert.deepEqual(
      ORDER_STATUSES.filter((status) => isTerminalStatus(status)).toSorted(),
      ["cancelled", "delivered", "returned"]
    );
  });
});
