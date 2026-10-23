import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Upstash provider reads. `saasaloy add kv-upstash` appends this
// preset to `packages/kv/src/env-preset.ts`, beside the patch that appends the provider
// itself, so installing the provider is what makes its keys required.
//
// `KV_KEY_PREFIX` stays optional in the kv preset, because `kv-cloudflare` and
// `kv-memory` do not need it. The provider itself refuses an empty one at the first call.

export const upstashEnvPreset = definePreset({
  module: "kv-upstash",
  server: {
    UPSTASH_REDIS_REST_URL: z
      .url()
      .describe(
        "REST endpoint of the Upstash Redis database, the https://<name>-<id>.upstash.io one under REST API."
      ),
    UPSTASH_REDIS_REST_TOKEN: z
      .string()
      .min(1)
      .describe(
        "Read-write REST token for the same database. The read-only token cannot SET, DEL or run the limiter's EVAL."
      ),
  },
});

export function upstashEnv() {
  return upstashEnvPreset;
}
