// Tests for the money helpers. Repo-only: the descriptor ships `money.ts`, never this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EcommerceError } from "./errors.ts";
import {
  addMinor,
  assertCurrency,
  assertMinor,
  formatMoney,
  fromMinor,
  isCurrencyCode,
  minorExponent,
  multiplyMinor,
  toMinor,
} from "./money.ts";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EcommerceError, String(error));
    return error.code;
  }
  return undefined;
}

describe("currency codes", () => {
  it("accepts three upper-case letters", () => {
    assert.equal(isCurrencyCode("BDT"), true);
    assert.equal(isCurrencyCode("USD"), true);
  });

  it("refuses lower case, the wrong length and other text", () => {
    for (const value of ["bdt", "BD", "BDTT", "", "৳", 12]) {
      assert.equal(isCurrencyCode(value), false, String(value));
    }
    assert.equal(
      code(() => assertCurrency("taka")),
      "invalid_currency"
    );
  });

  it("knows the minor unit of BDT, JPY and KWD", () => {
    assert.equal(minorExponent("BDT"), 2);
    assert.equal(minorExponent("USD"), 2);
    assert.equal(minorExponent("JPY"), 0);
    assert.equal(minorExponent("KWD"), 3);
  });
});

describe("minor units", () => {
  it("accepts a non-negative safe integer", () => {
    assert.equal(assertMinor(0), 0);
    assert.equal(assertMinor(125_050), 125_050);
  });

  it("refuses a fraction, a negative, NaN and an unsafe integer", () => {
    for (const value of [1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(
        code(() => assertMinor(value)),
        "invalid_amount",
        String(value)
      );
    }
  });

  it("converts a decimal string to minor units without float error", () => {
    assert.equal(toMinor("1250.50", "BDT"), 125_050);
    assert.equal(toMinor("0.29", "USD"), 29);
    assert.equal(toMinor("1250", "BDT"), 125_000);
    assert.equal(toMinor("1250.5", "BDT"), 125_050);
    assert.equal(toMinor("500", "JPY"), 500);
    assert.equal(toMinor("1.234", "KWD"), 1234);
  });

  it("refuses more decimals than the currency has, and text", () => {
    assert.equal(
      code(() => toMinor("1.234", "BDT")),
      "invalid_amount"
    );
    assert.equal(
      code(() => toMinor("1.5", "JPY")),
      "invalid_amount"
    );
    for (const value of ["", "abc", "-5", "1,000", "1e3"]) {
      assert.equal(
        code(() => toMinor(value, "BDT")),
        "invalid_amount",
        value
      );
    }
  });

  it("converts minor units back to a fixed decimal string", () => {
    assert.equal(fromMinor(125_050, "BDT"), "1250.50");
    assert.equal(fromMinor(5, "BDT"), "0.05");
    assert.equal(fromMinor(500, "JPY"), "500");
    assert.equal(fromMinor(1234, "KWD"), "1.234");
  });

  it("round-trips through toMinor and fromMinor", () => {
    for (const amount of [0, 1, 99, 100, 125_050, 9_999_999]) {
      assert.equal(toMinor(fromMinor(amount, "BDT"), "BDT"), amount);
    }
  });
});

describe("arithmetic", () => {
  it("adds and multiplies integers", () => {
    assert.equal(addMinor(100, 250, 5), 355);
    assert.equal(addMinor(), 0);
    assert.equal(multiplyMinor(125_050, 3), 375_150);
  });

  it("refuses a bad quantity", () => {
    for (const quantity of [-1, 1.5, Number.NaN]) {
      assert.equal(
        code(() => multiplyMinor(100, quantity)),
        "invalid_quantity",
        String(quantity)
      );
    }
  });

  it("refuses a result past the safe integer range", () => {
    assert.equal(
      code(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)),
      "invalid_amount"
    );
    assert.equal(
      code(() => addMinor(Number.MAX_SAFE_INTEGER, 1)),
      "invalid_amount"
    );
  });
});

describe("formatMoney", () => {
  it("formats with the currency and its own decimals", () => {
    assert.equal(formatMoney(125_050, "USD", "en-US"), "$1,250.50");
    assert.equal(formatMoney(500, "JPY", "en-US"), "¥500");
  });

  it("formats BDT", () => {
    const text = formatMoney(125_050, "BDT", "en-US");
    assert.match(text, /1,250\.50/);
    assert.match(text, /BDT|৳/);
  });
});
