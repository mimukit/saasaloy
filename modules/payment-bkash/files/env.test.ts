// Gate tests for the conditional payment-bkash keys (#390): the payment core's preset and this
// provider's preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds
// them in. Repo-only: the descriptor ships `bkash.ts` and `env.ts` and nothing else, and this
// file runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { paymentPreset } from "../../payment/files/src/env-preset.ts";
import { bkashEnvPreset } from "./env.ts";

const env = createEnv({ extends: [paymentPreset, bkashEnvPreset] });

const BLANK = {
  BKASH_APP_KEY: "",
  BKASH_APP_SECRET: "",
  BKASH_USERNAME: "",
  BKASH_PASSWORD: "",
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

describe("payment-bkash preset: keys required only while PAYMENT_PROVIDER selects bkash", () => {
  it("passes on manual with every bkash key blank", () => {
    assert.deepEqual(failures({ ...BLANK, PAYMENT_PROVIDER: "manual" }), []);
  });

  it("names every blank bkash key on a list that names bkash", () => {
    assert.deepEqual(failures({ ...BLANK, PAYMENT_PROVIDER: "manual,bkash" }), [
      "BKASH_APP_KEY (payment-bkash)",
      "BKASH_APP_SECRET (payment-bkash)",
      "BKASH_PASSWORD (payment-bkash)",
      "BKASH_USERNAME (payment-bkash)",
    ]);
  });

  it("passes on a list that does not name bkash", () => {
    assert.deepEqual(
      failures({ ...BLANK, PAYMENT_PROVIDER: "manual,other" }),
      []
    );
  });
});
