import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the kv capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

// The kv core's own keys. Kept apart from `kvPreset` so a provider preset can tighten one.
// `createEnv` walks `extends` in array order and the last declaration of a key wins, so
// this preset stays the first entry and a provider preset appended after it overrides it:
// `kv-upstash` makes `KV_KEY_PREFIX` required, because one Redis database is one flat
// keyspace.
const kvCorePreset = definePreset({
  module: "@repo/kv",
  server: {
    KV_PROVIDER: z
      .string()
      .min(1)
      .describe(
        "Which installed provider stores values: cloudflare, upstash or memory. Always required — there is no default."
      ),
    KV_KEY_PREFIX: z
      .string()
      .default("")
      .describe(
        "Prefix put in front of every key buildKey produces. Empty by default."
      ),
  },
});

/**
 * Keep this line in exactly this shape: `export const kvPreset = definePreset({ extends: [...] })`
 * with a real array literal, and keep `kvCorePreset` its first entry. A provider module
 * appends its own preset with a `plugin-array` patch, and it fails silently otherwise.
 */
export const kvPreset = definePreset({
  module: "@repo/kv",
  extends: [kvCorePreset],
});

/** The preset a service's `env.ts` folds in. */
export function kvEnv() {
  return kvPreset;
}
