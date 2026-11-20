import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { paymentEnvPresets } from "./env-preset.generated";

// The environment keys the payment capability reads. `apps/api/src/env.ts` folds this
// preset in, so a missing key is named at the gate rather than thrown from inside a
// factory on the first request that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run.
 */
export const paymentPreset = definePreset({
  module: "@repo/payment",
  extends: [...paymentEnvPresets],
  server: {
    PAYMENT_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed providers take payments, as a comma list in priority order, e.g. manual,sslcommerz. Always required; there is no default."
      ),
    PAYMENT_APP_URL: z
      .url()
      .optional()
      .describe(
        "The one origin a returnUrl may name. Unset, only http://localhost origins pass."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function paymentEnv() {
  return paymentPreset;
}
