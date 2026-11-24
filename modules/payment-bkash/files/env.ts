import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the bKash provider reads. `saasaloy add payment-bkash` adds this
// preset as a row of `packages/payment/src/env-preset.generated.ts`, so installing the
// provider adds its keys. The four credentials are required only while `PAYMENT_PROVIDER`
// lists `bkash`.

export const bkashEnvPreset = definePreset({
  module: "payment-bkash",
  server: {
    BKASH_APP_KEY: z
      .string()
      .min(1)
      .optional()
      .describe("The app key of your bKash merchant account."),
    BKASH_APP_SECRET: z
      .string()
      .min(1)
      .optional()
      .describe("The app secret issued with the app key. A Worker secret."),
    BKASH_USERNAME: z
      .string()
      .min(1)
      .optional()
      .describe("The merchant API username sent on the token calls."),
    BKASH_PASSWORD: z
      .string()
      .min(1)
      .optional()
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
  // Required only while PAYMENT_PROVIDER lists bkash: the value is a comma list, and a key
  // stays blank under a list that does not name this provider.
  requiredWhen: {
    BKASH_APP_KEY: { key: "PAYMENT_PROVIDER", is: "bkash" },
    BKASH_APP_SECRET: { key: "PAYMENT_PROVIDER", is: "bkash" },
    BKASH_USERNAME: { key: "PAYMENT_PROVIDER", is: "bkash" },
    BKASH_PASSWORD: { key: "PAYMENT_PROVIDER", is: "bkash" },
  },
});

export function bkashEnv() {
  return bkashEnvPreset;
}
