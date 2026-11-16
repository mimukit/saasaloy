// Repo-only: the descriptor ships `login-code-rules.ts`, never this file. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  liveTriesLeft,
  loginCodeIdentifier,
  loginCodePurposeOf,
  loginCodeState,
  parseLoginCodeIdentifier,
  parseLoginCodeValue,
} from "./login-code-rules.ts";

const PHONE = "+12025550101";
const RULES = { attemptsAllowed: 3, lifeSeconds: 300 };
const NOW = new Date("2026-11-05T10:00:00Z");
const LATER = new Date("2026-11-05T10:04:00Z");
const MINUTE = 60_000;

describe("loginCodePurposeOf", () => {
  it("reads the reset template as a reset and any other as a sign-up", () => {
    assert.equal(loginCodePurposeOf("password-reset-code"), "password_reset");
    assert.equal(loginCodePurposeOf("verification-code"), "sign_up");
    assert.equal(loginCodePurposeOf("order-shipped"), "sign_up");
  });
});

describe("parseLoginCodeIdentifier", () => {
  it("reads a sign-up and a reset identifier", () => {
    assert.deepEqual(parseLoginCodeIdentifier(PHONE), {
      phone: PHONE,
      purpose: "sign_up",
    });
    assert.deepEqual(
      parseLoginCodeIdentifier(`${PHONE}-request-password-reset`),
      { phone: PHONE, purpose: "password_reset" }
    );
  });

  it("round-trips what loginCodeIdentifier writes", () => {
    for (const purpose of ["sign_up", "password_reset"] as const) {
      assert.deepEqual(
        parseLoginCodeIdentifier(loginCodeIdentifier(PHONE, purpose)),
        { phone: PHONE, purpose }
      );
    }
  });

  it("answers null for an identifier no login code uses", () => {
    for (const identifier of [
      "",
      "user@example.com",
      "reset-password:abc123",
      "-request-password-reset",
      "12025550101",
      `${PHONE}-change-email`,
    ]) {
      assert.equal(parseLoginCodeIdentifier(identifier), null, identifier);
    }
  });
});

describe("parseLoginCodeValue", () => {
  it("reads the wrong tries and never the code", () => {
    assert.deepEqual(parseLoginCodeValue("482913:0"), { triesUsed: 0 });
    assert.deepEqual(parseLoginCodeValue("012345:2"), { triesUsed: 2 });
  });

  it("answers null for any other shape", () => {
    for (const value of [
      "",
      "482913",
      "482913:",
      ":1",
      "48a913:0",
      "$2b$hash",
    ]) {
      assert.equal(parseLoginCodeValue(value), null, value);
    }
  });
});

describe("liveTriesLeft", () => {
  const fresh = { expiresAt: new Date(NOW.getTime() + 5 * MINUTE) };

  it("answers the tries left on a code in its life", () => {
    assert.equal(liveTriesLeft({ ...fresh, value: "482913:0" }, RULES, NOW), 3);
    assert.equal(
      liveTriesLeft({ ...fresh, value: "482913:1" }, RULES, LATER),
      2
    );
  });

  it("answers null once every try is spent", () => {
    assert.equal(
      liveTriesLeft({ ...fresh, value: "482913:3" }, RULES, NOW),
      null
    );
  });

  it("answers null past expiresAt, and still holds the code at expiresAt", () => {
    const row = { expiresAt: NOW, value: "482913:0" };
    assert.equal(liveTriesLeft(row, RULES, NOW), 3);
    assert.equal(liveTriesLeft(row, RULES, new Date(NOW.getTime() + 1)), null);
  });

  it("answers null for a value of another shape", () => {
    assert.equal(
      liveTriesLeft({ ...fresh, value: "hashed" }, RULES, NOW),
      null
    );
  });
});

describe("loginCodeState", () => {
  it("is live while the code has tries left", () => {
    assert.equal(loginCodeState(NOW, 2, RULES, LATER), "live");
  });

  it("is ended for a gone code inside a code's life", () => {
    assert.equal(loginCodeState(NOW, null, RULES, LATER), "ended");
    assert.equal(
      loginCodeState(NOW, null, RULES, new Date(NOW.getTime() + 5 * MINUTE)),
      "ended"
    );
  });

  it("is expired for a gone code past a code's life", () => {
    assert.equal(
      loginCodeState(
        NOW,
        null,
        RULES,
        new Date(NOW.getTime() + 5 * MINUTE + 1)
      ),
      "expired"
    );
  });
});
