// Guards what makes `api_keys` a user's table in both schema variants: the `user_id`
// column, its cascading foreign key to `users`, and the index the owner lookups use.
// Deleting an account must delete its keys (plan 0075, Q11), and a variant that drops the
// cascade would leave a live credential for a user who no longer exists.
//
// It is NOT in the descriptor's `files` list, so `add api-keys-user` never copies it into
// a user's project. It runs here only, under `pnpm test:modules`.
//
// It reads the schema files as text, for the reason `./schema-version.test.ts` gives:
// both variants import `drizzle-orm`, which this repo's root `node_modules` does not
// carry. `db:generate` in a scaffolded project is the end-to-end check on the SQL.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const VARIANTS = [
  { dialect: "sqlite", path: "./api-keys.sqlite.ts" },
  { dialect: "postgres", path: "./api-keys.pg.ts" },
];

// This file runs on `node:test`, whose `describe` carries no `.each`. The rule below
// reads the call as vitest's and is wrong here.
// oxlint-disable-next-line vitest/prefer-each
for (const variant of VARIANTS) {
  const source = read(variant.path);

  describe(`the ${variant.dialect} api_keys owner column`, () => {
    it("is the userId property on a non-null user_id column", () => {
      assert.match(source, /userId: text\("user_id"\)\s*\.notNull\(\)/);
    });

    it("references users.id and cascades on delete", () => {
      assert.match(
        source,
        /\.references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/
      );
      assert.match(source, /import \{ users \} from "\.\/auth";/);
    });

    it("is indexed as api_keys_user_id_idx", () => {
      assert.match(
        source,
        /index\("api_keys_user_id_idx"\)\.on\(table\.userId\)/
      );
    });

    it("carries no organization column", () => {
      assert.doesNotMatch(
        source,
        /tenantColumn|organizationId|organization_id/
      );
    });
  });
}
