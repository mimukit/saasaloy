import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the sms capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const smsPreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const smsPreset = definePreset({
  module: "@repo/sms",
  extends: [],
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
