// Guards what makes `api_keys` a user's table in the schema: the `user_id`
// column, its cascading foreign key to `users`, and the index the owner lookups use.
// Deleting an account must delete its keys (plan 0083, Q11), and a schema that drops the
// cascade would leave a live credential for a user who no longer exists.
//
// It is NOT in the descriptor's `files` list, so `add api-keys-user` never copies it into
// a user's project. It runs here only, under `pnpm test:modules`.
//
// It reads the schema files as text, for the reason `./schema-version.test.ts` gives:
// the schema imports `drizzle-orm`, which this repo's root `node_modules` does not
// carry. `db:generate` in a scaffolded project is the end-to-end check on the SQL.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const source = read("./api-keys.ts");

describe("the api_keys owner column", () => {
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
    assert.doesNotMatch(source, /tenantColumn|organizationId|organization_id/);
  });
});
