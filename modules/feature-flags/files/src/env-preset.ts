import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the feature-flags capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

/**
 * Keep this line in exactly this shape: `export const featureFlagsPreset = definePreset({ extends: [...] })`
 * with a real array literal. A provider module appends its own preset with a
 * `plugin-array` patch, and it fails silently otherwise.
 */
export const featureFlagsPreset = definePreset({
  module: "@repo/feature-flags",
  extends: [],
  server: {
    FLAGS_ISOLATE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10)
      .describe(
        "Seconds an isolate serves its cached flag document before re-reading it from kv. 10 when unset."
      ),
  },
});

/** The preset a service's `env.ts` folds in. */
export function featureFlagsEnv() {
  return featureFlagsPreset;
}
