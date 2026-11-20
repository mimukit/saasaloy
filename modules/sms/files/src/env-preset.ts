import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { smsEnvPresets } from "./env-preset.generated";

// The environment keys the sms capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run.
 */
export const smsPreset = definePreset({
  module: "@repo/sms",
  extends: [...smsEnvPresets],
  server: {
    SMS_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider sends: console or khudebarta. Always required — there is no default."
      ),
    SMS_FROM: z
      .string()
      .optional()
      .describe(
        "Default sender for messages that carry no from of their own. A provider routing through a pool may assign it."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function smsEnv() {
  return smsPreset;
}
