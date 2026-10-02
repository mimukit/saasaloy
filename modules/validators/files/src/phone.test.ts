// Tests for the Bangladeshi mobile number schema. Repo-only, and it runs on `node:test` via
// `pnpm test:modules`. A scaffolded project receives `phone.ts` alone.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bangladeshMobile } from "./phone.ts";

/** The regex `modules/sms-khudebarta/files/khudebarta.ts` enforces on a recipient. */
const PROVIDER_NUMBER = /^\+880\d{10}$/;

const CANONICAL = "+8801712345678";

function parse(raw: string): string {
  return bangladeshMobile.parse(raw);
}

describe("bangladeshMobile accepted forms", () => {
  const forms: [string, string][] = [
    ["national with the leading zero", "01712345678"],
    ["E.164", "+8801712345678"],
    ["country code without the plus", "8801712345678"],
    ["bare national significant number", "1712345678"],
    ["the 00 international prefix", "008801712345678"],
  ];

  for (const [label, raw] of forms) {
    it(`normalizes the ${label}`, () => {
      assert.equal(parse(raw), CANONICAL);
    });
  }

  it("accepts every operator digit from 3 to 9", () => {
    for (const digit of ["3", "4", "5", "6", "7", "8", "9"]) {
      assert.equal(parse(`01${digit}12345678`), `+8801${digit}12345678`);
    }
  });

  it("returns a value the sms provider accepts", () => {
    for (const [, raw] of forms) {
      assert.match(parse(raw), PROVIDER_NUMBER);
    }
  });
});

describe("bangladeshMobile separators", () => {
  const separated = [
    "017 1234 5678",
    "017-1234-5678",
    "+880 1712-345678",
    "(017) 1234.5678",
    " 01712345678 ",
    "+880 (17) 1234-5678",
  ];

  for (const raw of separated) {
    it(`removes the separators in ${JSON.stringify(raw)}`, () => {
      assert.equal(parse(raw), CANONICAL);
    });
  }
});

describe("bangladeshMobile rejections", () => {
  const rejected: [string, string][] = [
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["too few digits", "0171234567"],
    ["too many digits", "017123456789"],
    ["a landline", "0221234567"],
    ["the 10 operator block", "01012345678"],
    ["the 11 operator block", "01112345678"],
    ["the 12 operator block", "01212345678"],
    ["a non-Bangladeshi country code", "+919712345678"],
    ["a letter before the number", "hello01712345678"],
    ["a letter after the number", "01712345678world"],
    ["a letter wrapping the number", "hello01712345678world"],
    ["a letter inside the number", "0171234a5678"],
    ["Bengali numerals", "০১৭১২৩৪৫৬৭৮"],
    ["a disallowed punctuation mark", "01712345678!!!"],
    ["a plus that is not leading", "880+1712345678"],
    ["a plus with no digits", "+"],
  ];

  for (const [label, raw] of rejected) {
    it(`rejects ${label}`, () => {
      assert.equal(bangladeshMobile.safeParse(raw).success, false);
    });
  }

  it("reports one message with an example", () => {
    const result = bangladeshMobile.safeParse("nope");
    assert.equal(result.success, false);
    assert.equal(
      result.error.issues[0]?.message,
      "must be a Bangladeshi mobile number, for example +8801712345678"
    );
  });
});
