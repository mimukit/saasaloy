// Repo-only: the descriptor ships `phone-results.ts`, never this file. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  phoneResultOf,
  phoneResultText,
  retryAfterSeconds,
} from "./phone-results.ts";

describe("phoneResultOf", () => {
  it("reads the api envelope's code ahead of the status", () => {
    assert.equal(
      phoneResultOf({ error: { code: "no_account" }, status: 401 }),
      "no_account"
    );
    assert.equal(
      phoneResultOf({ error: { code: "no_password" }, status: 401 }),
      "no_password"
    );
  });

  it("reads Better Auth's own code at the top of the body", () => {
    assert.equal(phoneResultOf({ code: "BANNED_USER", status: 403 }), "banned");
    assert.equal(
      phoneResultOf({ code: "TOO_MANY_ATTEMPTS", status: 403 }),
      "too_many_tries"
    );
    assert.equal(
      phoneResultOf({ code: "OTP_NOT_FOUND", status: 400 }),
      "code_expired"
    );
  });

  it("reads a 429 with no known code as rate limited", () => {
    assert.equal(phoneResultOf({ status: 429 }), "rate_limited");
  });

  it("reads an unknown answer as failed", () => {
    assert.equal(phoneResultOf({ code: "SOMETHING", status: 500 }), "failed");
    assert.equal(phoneResultOf(null), "failed");
  });
});

describe("retryAfterSeconds", () => {
  it("reads whole seconds and nothing else", () => {
    assert.equal(retryAfterSeconds("42"), 42);
    assert.equal(retryAfterSeconds(null), null);
    assert.equal(retryAfterSeconds("0"), null);
    assert.equal(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT"), null);
  });
});

describe("phoneResultText", () => {
  it("names the wait a 429 gave, in seconds or minutes", () => {
    assert.match(phoneResultText("rate_limited", 7), /in 7 seconds\./);
    assert.match(phoneResultText("rate_limited", 3600), /in 60 minutes\./);
    assert.match(phoneResultText("rate_limited", 61), /in 2 minutes\./);
  });

  it("asks for a minute when the wait could not be read", () => {
    assert.match(phoneResultText("rate_limited"), /Wait a minute/);
  });
});
