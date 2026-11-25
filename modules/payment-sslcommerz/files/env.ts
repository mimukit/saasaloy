import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the SSLCOMMERZ provider reads. `saasaloy add payment-sslcommerz`
// adds this preset as a row of `packages/payment/src/env-preset.generated.ts`, so
// installing the provider adds its keys. The store keys and the receipt address are required
// only while `PAYMENT_PROVIDER` lists `sslcommerz`.

export const sslcommerzEnvPreset = definePreset({
  module: "payment-sslcommerz",
  server: {
    SSLCOMMERZ_STORE_ID: z
      .string()
      .min(1)
      .optional()
      .describe(
        "SSLCOMMERZ store id, from the sandbox or live merchant panel."
      ),
    SSLCOMMERZ_STORE_PASSWORD: z
      .string()
      .min(1)
      .optional()
      .describe("The store password issued with SSLCOMMERZ_STORE_ID."),
    SSLCOMMERZ_RECEIPT_EMAIL: z
      .email()
      .optional()
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
  // Required only while PAYMENT_PROVIDER lists sslcommerz: the value is a comma list, and a key
  // stays blank under a list that does not name this provider.
  requiredWhen: {
    SSLCOMMERZ_STORE_ID: { key: "PAYMENT_PROVIDER", is: "sslcommerz" },
    SSLCOMMERZ_STORE_PASSWORD: { key: "PAYMENT_PROVIDER", is: "sslcommerz" },
    SSLCOMMERZ_RECEIPT_EMAIL: { key: "PAYMENT_PROVIDER", is: "sslcommerz" },
  },
});

export function sslcommerzEnv() {
  return sslcommerzEnvPreset;
}
