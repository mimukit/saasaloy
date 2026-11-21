import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { subscriptionEnvPresets } from "./env-preset.generated";

// The environment keys the subscription capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run.
 */
export const subscriptionPreset = definePreset({
  module: "@repo/subscription",
  extends: [...subscriptionEnvPresets],
  server: {
    SUBSCRIPTION_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider takes payments: stripe or console. Always required — there is no default."
      ),
    SUBSCRIPTION_APP_URL: z
      .url()
      .default("http://localhost:3001/subscription")
      .describe(
        "Absolute URL the subscription emails link to, and the one origin a checkout redirect may name."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function subscriptionEnv() {
  return subscriptionPreset;
}
