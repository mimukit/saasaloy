// Tests for the `retryable` coercion in `SmsError` (./provider.ts): only `rate_limited` and
// `provider_error` may carry `retryable: true`, whatever a provider passes. Repo-only (the
// descriptor does not list it); it runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SmsError } from "./provider.ts";
import type { SmsErrorCode } from "./provider.ts";

const RETRYABLE: SmsErrorCode[] = ["rate_limited", "provider_error"];
const NOT_RETRYABLE: SmsErrorCode[] = [
  "invalid_number",
  "unroutable",
  "opted_out",
  "account_error",
  "message_too_long",
  "invalid_message",
];

describe("SmsError: retryable coercion", () => {
  for (const code of RETRYABLE) {
    it(`keeps retryable true for ${code}`, () => {
      assert.equal(
        new SmsError(code, "x", { retryable: true }).retryable,
        true
      );
    });
  }

  for (const code of NOT_RETRYABLE) {
    it(`forces retryable false for ${code}`, () => {
      assert.equal(
        new SmsError(code, "x", { retryable: true }).retryable,
        false
      );
    });
  }

  it("defaults retryable to false when the option is absent", () => {
    assert.equal(new SmsError("provider_error", "x").retryable, false);
  });

  it("keeps the code, the message and the provider code", () => {
    const error = new SmsError("opted_out", "STOP received", {
      providerCode: "21610",
    });
    assert.equal(error.code, "opted_out");
    assert.equal(error.message, "STOP received");
    assert.equal(error.providerCode, "21610");
    assert.ok(error instanceof Error);
  });
});
