// Gate tests for the conditional sms-khudebarta keys (#390): the sms core's preset and this
// provider's preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds
// them in. Repo-only: the descriptor ships `khudebarta.ts` and `env.ts` and nothing else, and this
// file runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { smsPreset } from "../../sms/files/src/env-preset.ts";
import { khudebartaEnvPreset } from "./env.ts";

const env = createEnv({ extends: [smsPreset, khudebartaEnvPreset] });

const BLANK = {
  KHUDEBARTA_API_KEY: "",
  KHUDEBARTA_SECRET_KEY: "",
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

describe("sms-khudebarta preset: keys required only while SMS_PROVIDER selects khudebarta", () => {
  it("passes on console with every khudebarta key blank", () => {
    assert.deepEqual(failures({ ...BLANK, SMS_PROVIDER: "console" }), []);
  });

  it("names every blank khudebarta key on khudebarta", () => {
    assert.deepEqual(failures({ ...BLANK, SMS_PROVIDER: "khudebarta" }), [
      "KHUDEBARTA_API_KEY (sms-khudebarta)",
      "KHUDEBARTA_SECRET_KEY (sms-khudebarta)",
    ]);
  });
});
