// Repo-only: the descriptor ships `mask-codes.ts`, never this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskCodes } from "./mask-codes.ts";

describe("maskCodes", () => {
  it("masks a six-digit code in a provider error", () => {
    assert.equal(
      maskCodes('rejected "482913 is your Acme code"'),
      'rejected "•••••• is your Acme code"'
    );
  });

  it("keeps a phone number and a short error code", () => {
    assert.equal(
      maskCodes("+8801700000001: account_error: -66"),
      "+8801700000001: account_error: -66"
    );
  });

  it("masks a four- and an eight-digit run, and leaves a nine-digit one", () => {
    assert.equal(
      maskCodes("1234 12345678 123456789"),
      "•••• •••••••• 123456789"
    );
  });

  it("masks a code joined by a plus or an underscore", () => {
    assert.equal(
      maskCodes("code+482913+is code_482913"),
      "code+••••••+is code_••••••"
    );
  });

  it("keeps a reference joined by hyphens", () => {
    assert.equal(
      maskCodes("INV-2026-000001 and TKT-10003"),
      "INV-2026-000001 and TKT-10003"
    );
  });
});
