import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Upstash provider reads. `saasaloy add kv-upstash` appends this
// preset to `packages/kv/src/env-preset.ts`, beside the patch that appends the provider
// itself, so installing the provider is what makes its keys required.
//
// `KV_KEY_PREFIX` is optional in the kv preset, because `kv-cloudflare` and `kv-memory` do
// not need it. It is required here: one Redis database is one flat keyspace, so a `list`
// with no prefix would scan every key in it. This preset lands after the kv core's own in
// `kvPreset.extends`, and the last declaration of a key wins, so this one is the rule
// once kv-upstash is installed. The provider still refuses an empty prefix at its first
// call, for a caller that builds the client without the env gate.

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
    KV_KEY_PREFIX: z
      .string()
      .min(1)
      .describe(
        "Prefix put in front of every key, e.g. staging: or the project name. Required with kv-upstash: one Redis database is one flat keyspace."
      ),
  },
});

export function upstashEnv() {
  return upstashEnvPreset;
}
