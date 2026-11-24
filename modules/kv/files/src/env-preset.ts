import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";
import { kvEnvPresets } from "./env-preset.generated";

// The environment keys the kv capability reads. `apps/api/src/env.ts` folds this preset in, so a missing
// key is named at the gate rather than thrown from inside a factory on the first request
// that needs it.
//
// Keep this in step with the `envVars` block of this module's `registry-item.json`:
// `pnpm test:scripts` fails when a key is in one and not the other.

// The kv core's own keys. Kept apart from `kvPreset` so a provider preset can tighten one.
// `createEnv` walks `extends` in array order and the last declaration of a key wins, so
// this preset stays the first entry and a provider preset appended after it overrides it:
// `kv-upstash` makes `KV_KEY_PREFIX` required while `KV_PROVIDER` is `upstash`, because one
// Redis database is one flat keyspace.
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
 * The capability's preset, then every provider preset. A provider module adds its own to
 * `./env-preset.generated.ts`, which the CLI writes on every run. `kvCorePreset` stays the first entry.
 */
export const kvPreset = definePreset({
  module: "@repo/kv",
  extends: [kvCorePreset, ...kvEnvPresets],
});

/** The preset a service's `env.ts` folds in. */
export function kvEnv() {
  return kvPreset;
}
