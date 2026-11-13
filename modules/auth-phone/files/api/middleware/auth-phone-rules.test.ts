// Repo-only: the descriptor ships `auth-phone-rules.ts`, never this file. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOGIN_CODE_WINDOW_SECONDS,
  loginCodeLimitApplies,
  loginCodeRefusal,
  maskPhone,
  phoneKeyPart,
} from "./auth-phone-rules.ts";

const LIMITS = { codesPerHour: 5, resendSeconds: 60 };

describe("loginCodeRefusal", () => {
  it("lets the first code of the hour go", () => {
    assert.equal(
      loginCodeRefusal({ inHour: 0, inResendWindow: 0 }, LIMITS),
      null
    );
  });

  it("refuses a second code inside the resend wait", () => {
    assert.equal(
      loginCodeRefusal({ inHour: 1, inResendWindow: 1 }, LIMITS)
        ?.retryAfterSeconds,
      60
    );
  });

  it("refuses once the hour's codes are spent, and not one code before", () => {
    assert.equal(
      loginCodeRefusal({ inHour: 5, inResendWindow: 0 }, LIMITS)
        ?.retryAfterSeconds,
      LOGIN_CODE_WINDOW_SECONDS
    );
    assert.equal(
      loginCodeRefusal({ inHour: 4, inResendWindow: 0 }, LIMITS),
      null
    );
  });

  it("reads the wait from the limits it is given", () => {
    assert.equal(
      loginCodeRefusal(
        { inHour: 1, inResendWindow: 1 },
        { codesPerHour: 5, resendSeconds: 90 }
      )?.retryAfterSeconds,
      90
    );
  });
});

describe("loginCodeLimitApplies", () => {
  it("skips the limit under the console provider", () => {
    assert.equal(loginCodeLimitApplies("console"), false);
  });

  it("keeps the limit for a gateway, and when the provider is unset", () => {
    assert.equal(loginCodeLimitApplies("khudebarta"), true);
    assert.equal(loginCodeLimitApplies(), true);
  });
});

describe("maskPhone", () => {
  it("keeps the last four digits of an E.164 number", () => {
    assert.equal(maskPhone("+12025550101"), "…0101");
  });

  it("drops what is not a digit before it counts", () => {
    assert.equal(maskPhone("+1 202 555 01-01"), "…0101");
  });

  it("keeps a short value as it is", () => {
    assert.equal(maskPhone("12"), "…12");
  });
});

describe("phoneKeyPart", () => {
  it("keeps the digits only, so no `:` reaches the key", () => {
    assert.equal(phoneKeyPart("+1:202:555"), "1202555");
  });

  it("caps the part at 20 digits", () => {
    assert.equal(phoneKeyPart("1".repeat(30)), "1".repeat(20));
  });

  it("names a missing number `none`", () => {
    assert.equal(phoneKeyPart(null), "none");
    assert.equal(phoneKeyPart("abc"), "none");
  });
});
