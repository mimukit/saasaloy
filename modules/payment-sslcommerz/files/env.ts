import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the SSLCOMMERZ provider reads. `saasaloy add payment-sslcommerz`
// appends this preset to `packages/payment/src/env-preset.ts`, so installing the provider
// is what makes its keys required.

export const sslcommerzEnvPreset = definePreset({
  module: "payment-sslcommerz",
  server: {
    SSLCOMMERZ_STORE_ID: z
      .string()
      .min(1)
      .describe(
        "SSLCOMMERZ store id, from the sandbox or live merchant panel."
      ),
    SSLCOMMERZ_STORE_PASSWORD: z
      .string()
      .min(1)
      .describe("The store password issued with SSLCOMMERZ_STORE_ID."),
    SSLCOMMERZ_RECEIPT_EMAIL: z
      .email()
      .describe(
        "A mailbox you own. SSLCOMMERZ requires cus_email on every session and mails its receipt there."
      ),
    SSLCOMMERZ_MODE: z
      .enum(["sandbox", "live"])
      .default("sandbox")
      .describe(
        "Which gateway host to use: sandbox (https://sandbox.sslcommerz.com) or live (https://securepay.sslcommerz.com)."
      ),
  },
});

export function sslcommerzEnv() {
  return sslcommerzEnvPreset;
}
