// Repo-only: the descriptor ships `phone-rules.ts`, never this file. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAllowedPhone, placeholderEmail, toE164 } from "./phone-rules.ts";

describe("placeholderEmail", () => {
  it("keeps the digits under the reserved .invalid domain", () => {
    assert.equal(
      placeholderEmail("+8801712345678"),
      "8801712345678@phone.invalid"
    );
  });
});

describe("toE164", () => {
  it("keeps a number typed with a plus and drops the separators", () => {
    assert.equal(toE164(" +1 (202) 555-0101 "), "+12025550101");
  });

  it("reads a leading 00 as the plus", () => {
    assert.equal(toE164("00447700900123"), "+447700900123");
  });

  it("swaps a leading 0 for the default country code", () => {
    assert.equal(toE164("01712-345678", "+880"), "+8801712345678");
  });

  it("refuses a leading 0 when no default country code is set", () => {
    assert.equal(toE164("01712345678"), null);
  });

  it("refuses a number with no plus and no leading 0", () => {
    assert.equal(toE164("2025550101", "+1"), null);
  });

  it("refuses letters and a number too short for E.164", () => {
    assert.equal(toE164("+1202555abcd"), null);
    assert.equal(toE164("+12345"), null);
  });
});

describe("isAllowedPhone", () => {
  it("allows every E.164 number when the list is empty", () => {
    assert.equal(isAllowedPhone("+447700900123", []), true);
  });

  it("refuses a number that is not E.164", () => {
    assert.equal(isAllowedPhone("12025550101", []), false);
    assert.equal(isAllowedPhone("+02025550101", []), false);
    assert.equal(isAllowedPhone("+1202555010112345", []), false);
  });

  it("allows only the listed prefixes when the list is set", () => {
    assert.equal(isAllowedPhone("+8801712345678", ["+880"]), true);
    assert.equal(isAllowedPhone("+447700900123", ["+880", "+1"]), false);
  });
});
