import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Upstash provider reads. `saasaloy add kv-upstash` adds this
// preset as a `kv.envPresets` row, beside the `kv.providers` row for the provider
// itself. Its keys are required only while `KV_PROVIDER` is `upstash`.
//
// `KV_KEY_PREFIX` is optional in the kv preset, because `kv-cloudflare` and `kv-memory` do
// not need it. It is required here while `KV_PROVIDER` is `upstash`: one Redis database is
// one flat keyspace, so a `list` with no prefix would scan every key in it. This preset
// lands after the kv core's own preset (`kvCorePreset`) in `kvPreset.extends`, and the last
// declaration of a key wins, so this schema is the rule once kv-upstash is installed. It
// stays `min(1)`, so a blank prefix still fails under upstash (plan 0089); under another
// provider it may stay blank, and the kv core reads it as "". The provider still refuses an
// empty prefix at its first call, for a caller that builds the client without the env gate.

export const upstashEnvPreset = definePreset({
  module: "kv-upstash",
  server: {
    UPSTASH_REDIS_REST_URL: z
      .url()
      .optional()
      .describe(
        "REST endpoint of the Upstash Redis database, the https://<name>-<id>.upstash.io one under REST API."
      ),
    UPSTASH_REDIS_REST_TOKEN: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Read-write REST token for the same database. The read-only token cannot SET, DEL or run the limiter's EVAL."
      ),
    KV_KEY_PREFIX: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Prefix put in front of every key, e.g. staging: or the project name. Required while KV_PROVIDER is upstash: one Redis database is one flat keyspace."
      ),
  },
  // Required only while KV_PROVIDER is upstash, so a project can keep this provider
  // installed and run on another one with these keys blank.
  requiredWhen: {
    UPSTASH_REDIS_REST_URL: { key: "KV_PROVIDER", is: "upstash" },
    UPSTASH_REDIS_REST_TOKEN: { key: "KV_PROVIDER", is: "upstash" },
    KV_KEY_PREFIX: { key: "KV_PROVIDER", is: "upstash" },
  },
});

export function upstashEnv() {
  return upstashEnvPreset;
}
