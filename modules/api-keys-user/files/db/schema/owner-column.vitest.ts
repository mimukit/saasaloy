// Guards what makes `api_keys` a user's table in both schema variants: the `user_id`
// column, its cascading foreign key to `users`, and the index the owner lookups use.
// Deleting an account must delete its keys (plan 0083, Q11), and a variant that drops the
// cascade would leave a live credential for a user who no longer exists.
//
// It never ships: it reads both dialect variants and the module descriptors, which a
// project does not hold, so the descriptor lists no entry for it. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// It reads the schema files as text, for the reason the schema-version test beside it gives:
// both variants import `drizzle-orm`, which this repo's root `node_modules` does not
// carry. `db:generate` in a scaffolded project is the end-to-end check on the SQL.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const VARIANTS = [
  { dialect: "sqlite", path: "./api-keys.sqlite.ts" },
  { dialect: "postgres", path: "./api-keys.pg.ts" },
];

describe.each(VARIANTS)("the $dialect api_keys owner column", (variant) => {
  const source = read(variant.path);

  it("is the userId property on a non-null user_id column", () => {
    expect(source).toMatch(/userId: text\("user_id"\)\s*\.notNull\(\)/);
  });

  it("references users.id and cascades on delete", () => {
    expect(source).toMatch(
      /\.references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/
    );
    expect(source).toMatch(/import \{ users \} from "\.\/auth";/);
  });

  it("is indexed as api_keys_user_id_idx", () => {
    expect(source).toMatch(
      /index\("api_keys_user_id_idx"\)\.on\(table\.userId\)/
    );
  });

  it("carries no organization column", () => {
    expect(source).not.toMatch(/tenantColumn|organizationId|organization_id/);
  });
});
