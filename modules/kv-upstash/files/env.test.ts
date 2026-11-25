// Gate tests for the conditional kv-upstash keys (#390): the kv core's preset and this
// provider's preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds
// them in. Repo-only: the descriptor ships `upstash.ts` and `env.ts` and nothing else, and this
// file runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { kvPreset } from "../../kv/files/src/env-preset.ts";
import { upstashEnvPreset } from "./env.ts";

const env = createEnv({ extends: [kvPreset, upstashEnvPreset] });

const BLANK = {
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_KEY_PREFIX: "",
};

/** The `KEY (module)` labels a failed gate names, sorted. */
function failures(source: Record<string, string>): string[] {
  try {
    env(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues
      .map((issue) => `${issue.key} (${issue.module})`)
      .toSorted();
  }
  return [];
}

describe("kv-upstash preset: keys required only while KV_PROVIDER selects upstash", () => {
  it("passes on memory with every upstash key blank", () => {
    assert.deepEqual(failures({ ...BLANK, KV_PROVIDER: "memory" }), []);
  });

  it("names every blank upstash key on upstash", () => {
    assert.deepEqual(failures({ ...BLANK, KV_PROVIDER: "upstash" }), [
      "KV_KEY_PREFIX (kv-upstash)",
      "UPSTASH_REDIS_REST_TOKEN (kv-upstash)",
      "UPSTASH_REDIS_REST_URL (kv-upstash)",
    ]);
  });
});
