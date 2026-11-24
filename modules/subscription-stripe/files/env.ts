import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Stripe provider reads. `saasaloy add subscription-stripe` appends
// this preset to `packages/subscription/src/env-preset.ts`, so installing the provider adds its
// keys. Both are required only while `SUBSCRIPTION_PROVIDER` is `stripe`.

export const stripeEnvPreset = definePreset({
  module: "subscription-stripe",
  server: {
    STRIPE_SECRET_KEY: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Your Stripe secret key: sk_test_… while you develop, sk_live_… in production."
      ),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Signing secret of the webhook endpoint you registered. Every delivery is verified against it."
      ),
  },
  // Required only while SUBSCRIPTION_PROVIDER is stripe, so a project can keep this provider
  // installed and run on another one with these keys blank.
  requiredWhen: {
    STRIPE_SECRET_KEY: { key: "SUBSCRIPTION_PROVIDER", is: "stripe" },
    STRIPE_WEBHOOK_SECRET: { key: "SUBSCRIPTION_PROVIDER", is: "stripe" },
  },
});

export function stripeEnv() {
  return stripeEnvPreset;
}
