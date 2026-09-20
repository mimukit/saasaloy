import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Stripe provider reads. `saasaloy add billing-stripe` appends
// this preset to `packages/billing/src/env-preset.ts`, so installing the provider is what
// makes its keys required.

export const stripeEnvPreset = definePreset({
  module: "billing-stripe",
  server: {
    STRIPE_SECRET_KEY: z
      .string()
      .min(1)
      .describe(
        "Your Stripe secret key: sk_test_… while you develop, sk_live_… in production."
      ),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .min(1)
      .describe(
        "Signing secret of the webhook endpoint you registered. Every delivery is verified against it."
      ),
  },
});

export function stripeEnv() {
  return stripeEnvPreset;
}
