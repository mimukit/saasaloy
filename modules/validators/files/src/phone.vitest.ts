// Tests for the Bangladeshi mobile number schema. It ships as `src/phone.test.ts` when
// testing is on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { bangladeshMobile } from "./phone";

/**
 * The regex the `sms-khudebarta` provider enforces on a recipient. The saasaloy repo holds
 * the two copies together in `scripts/phone-regex.test.ts`.
 */
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

  it.each(forms)("normalizes the %s", (_label, raw) => {
    expect(parse(raw)).toBe(CANONICAL);
  });

  it("accepts every operator digit from 3 to 9", () => {
    for (const digit of ["3", "4", "5", "6", "7", "8", "9"]) {
      expect(parse(`01${digit}12345678`)).toBe(`+8801${digit}12345678`);
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

  it.each(separated)("removes the separators in %j", (raw) => {
    expect(parse(raw)).toBe(CANONICAL);
  });
});

describe("bangladeshMobile and the sms provider", () => {
  it("returns a value the provider accepts for every operator digit", () => {
    for (const digit of ["3", "4", "5", "6", "7", "8", "9"]) {
      expect(parse(`+880 1${digit}12-345678`)).toMatch(PROVIDER_NUMBER);
    }
  });
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
    ["a space before the plus", " +8801712345678"],
    ["a tab", "\t01712345678"],
    ["a newline", "01712345678\n"],
    ["a non-breaking space", "017\u00A012345678"],
  ];

  it.each(rejected)("rejects %s", (_label, raw) => {
    expect(bangladeshMobile.safeParse(raw).success).toBeFalsy();
  });

  it("reports one message with an example", () => {
    const result = bangladeshMobile.safeParse("nope");
    expect(result.success).toBeFalsy();
    expect(result.error?.issues[0]?.message).toBe(
      "must be a Bangladeshi mobile number, for example +8801712345678"
    );
  });
});
