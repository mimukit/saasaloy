// Gate tests for the conditional payment-sslcommerz keys (#390): the payment core's preset and this
// provider's preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds
// them in. Repo-only: the descriptor ships `sslcommerz.ts` and `env.ts` and nothing else, and this
// file runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { paymentPreset } from "../../payment/files/src/env-preset.ts";
import { sslcommerzEnvPreset } from "./env.ts";

const env = createEnv({ extends: [paymentPreset, sslcommerzEnvPreset] });

const BLANK = {
  SSLCOMMERZ_STORE_ID: "",
  SSLCOMMERZ_STORE_PASSWORD: "",
  SSLCOMMERZ_RECEIPT_EMAIL: "",
};

/** The `KEY (module)` labels a failed gate names, sorted. */
function failures(source: Record<string, string>): string[] {
  try {
    env(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues
      .map((issue) => `${issue.key} (${issue.module})`)
      .toSorted();
  }
  return [];
}

describe("payment-sslcommerz preset: keys required only while PAYMENT_PROVIDER selects sslcommerz", () => {
  it("passes on manual with every sslcommerz key blank", () => {
    assert.deepEqual(failures({ ...BLANK, PAYMENT_PROVIDER: "manual" }), []);
  });

  it("names every blank sslcommerz key on a list that names sslcommerz", () => {
    assert.deepEqual(
      failures({ ...BLANK, PAYMENT_PROVIDER: "manual,sslcommerz" }),
      [
        "SSLCOMMERZ_RECEIPT_EMAIL (payment-sslcommerz)",
        "SSLCOMMERZ_STORE_ID (payment-sslcommerz)",
        "SSLCOMMERZ_STORE_PASSWORD (payment-sslcommerz)",
      ]
    );
  });

  it("passes on a list that does not name sslcommerz", () => {
    assert.deepEqual(
      failures({ ...BLANK, PAYMENT_PROVIDER: "manual,other" }),
      []
    );
  });
});
