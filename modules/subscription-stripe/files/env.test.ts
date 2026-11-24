// Gate tests for the conditional subscription-stripe keys (#390): the subscription core's preset and this
// provider's preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds
// them in. Repo-only: the descriptor ships `stripe.ts` and `env.ts` and nothing else, and this
// file runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { subscriptionPreset } from "../../subscription/files/src/env-preset.ts";
import { stripeEnvPreset } from "./env.ts";

const env = createEnv({ extends: [subscriptionPreset, stripeEnvPreset] });

const BLANK = {
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
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

describe("subscription-stripe preset: keys required only while SUBSCRIPTION_PROVIDER selects stripe", () => {
  it("passes on console with every stripe key blank", () => {
    assert.deepEqual(
      failures({ ...BLANK, SUBSCRIPTION_PROVIDER: "console" }),
      []
    );
  });

  it("names every blank stripe key on stripe", () => {
    assert.deepEqual(failures({ ...BLANK, SUBSCRIPTION_PROVIDER: "stripe" }), [
      "STRIPE_SECRET_KEY (subscription-stripe)",
      "STRIPE_WEBHOOK_SECRET (subscription-stripe)",
    ]);
  });
});
