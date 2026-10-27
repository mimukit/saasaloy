import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the bKash provider reads. `saasaloy add payment-bkash` appends this
// preset to `packages/payment/src/env-preset.ts`, so installing the provider is what makes
// its keys required.

export const bkashEnvPreset = definePreset({
  module: "payment-bkash",
  server: {
    BKASH_APP_KEY: z
      .string()
      .min(1)
      .describe("The app key of your bKash merchant account."),
    BKASH_APP_SECRET: z
      .string()
      .min(1)
      .describe("The app secret issued with the app key. A Worker secret."),
    BKASH_USERNAME: z
      .string()
      .min(1)
      .describe("The merchant API username sent on the token calls."),
    BKASH_PASSWORD: z
      .string()
      .min(1)
      .describe(
        "The merchant API password sent on the token calls. A Worker secret."
      ),
    BKASH_MODE: z
      .string()
      .default("sandbox")
      .describe(
        "`live` selects https://tokenized.pay.bka.sh. Anything else selects the sandbox."
      ),
  },
});

export function bkashEnv() {
  return bkashEnvPreset;
}
