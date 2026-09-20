import { definePreset } from "@repo/env";
import { z } from "@repo/env/zod";

// The environment keys the Postgres driver reads. `database-d1` ships no preset: D1
// arrives as a Worker binding, not as a value, so there is no key to validate.

export const databasePreset = definePreset({
  module: "database-postgres",
  server: {
    DATABASE_URL: z
      .string()
      .min(1)
      .describe(
        "Postgres connection string, e.g. postgres://user:pass@host:5432/app. A HYPERDRIVE binding takes precedence over it."
      ),
  },
});

/** The preset `apps/api/src/env.ts` folds in. */
export function databaseEnv() {
  return databasePreset;
}
