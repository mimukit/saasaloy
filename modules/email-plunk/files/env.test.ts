// Tests for the conditional email keys (#390): the email core's preset and this provider's
// preset, composed through the real `createEnv` the way `apps/api/src/env.ts` folds them in.
// Repo-only: the descriptor ships `plunk.ts` and `env.ts` and nothing else, and this file
// runs on `node:test` via `pnpm test:modules`. `@repo/env` resolves through
// `scripts/ts-resolve-hook.ts` to the base template's env sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnv, EnvValidationError } from "@repo/env";
import { emailPreset } from "../../email/files/src/env-preset.ts";
import { plunkEnvPreset } from "./env.ts";

const env = createEnv({ extends: [emailPreset, plunkEnvPreset] });

/** The `KEY (module)` labels a failed gate names, in its order. */
function failures(source: Record<string, string>): string[] {
  try {
    env(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues.map((issue) => `${issue.key} (${issue.module})`);
  }
  return [];
}

describe("email presets: keys required by the selected provider", () => {
  it("passes on console with EMAIL_FROM and PLUNK_API_KEY blank", () => {
    assert.deepEqual(
      failures({
        EMAIL_PROVIDER: "console",
        EMAIL_FROM: "",
        PLUNK_API_KEY: "",
      }),
      []
    );
  });

  it("names both keys on plunk with both blank", () => {
    assert.deepEqual(
      failures({
        EMAIL_PROVIDER: "plunk",
        EMAIL_FROM: "",
        PLUNK_API_KEY: "",
      }).toSorted(),
      ["EMAIL_FROM (@repo/email)", "PLUNK_API_KEY (email-plunk)"]
    );
  });

  it("names EMAIL_FROM only on cloudflare with both blank", () => {
    assert.deepEqual(
      failures({
        EMAIL_PROVIDER: "cloudflare",
        EMAIL_FROM: "",
        PLUNK_API_KEY: "",
      }),
      ["EMAIL_FROM (@repo/email)"]
    );
  });

  it("passes on plunk with both keys set", () => {
    assert.deepEqual(
      failures({
        EMAIL_PROVIDER: "plunk",
        EMAIL_FROM: "app@example.com",
        PLUNK_API_KEY: "sk_test",
      }),
      []
    );
  });
});
