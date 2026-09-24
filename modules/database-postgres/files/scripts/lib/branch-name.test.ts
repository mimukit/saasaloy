// Tests for ./branch-name.ts. This file is NOT in the descriptor's `scaffolds[].files`
// list, so `add database-postgres` never copies it into a user's project — it exists for
// this repo only. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertManagedDatabase,
  branchDatabaseName,
  databasePrefix,
} from "./branch-name.ts";

describe("databasePrefix", () => {
  it("slugifies the project name and adds _dev", () => {
    assert.equal(databasePrefix("@acme/shop"), "acme_shop_dev");
    assert.equal(databasePrefix("My App"), "my_app_dev");
  });

  it("falls back to app_dev for a name that cannot start an identifier", () => {
    assert.equal(databasePrefix(""), "app_dev");
    assert.equal(databasePrefix("---"), "app_dev");
    assert.equal(databasePrefix("2fast"), "app_dev");
  });
});

describe("branchDatabaseName", () => {
  it("keeps only the issue number of an issue branch", () => {
    const name = branchDatabaseName("app_dev", "issue-152-add-db-setup");
    assert.match(name, /^app_dev_issue_152_[0-9a-f]{6}$/);
  });

  it("gives two issue branches with one number different names", () => {
    assert.notEqual(
      branchDatabaseName("app_dev", "issue-152-one"),
      branchDatabaseName("app_dev", "issue-152-two")
    );
  });

  it("slugifies any other branch", () => {
    assert.equal(
      branchDatabaseName("app_dev", "feat/Add-Teams"),
      "app_dev_feat_add_teams"
    );
  });

  it("cuts a name over 63 bytes and suffixes it with the branch hash", () => {
    const branch = `feat/${"a".repeat(120)}`;
    const name = branchDatabaseName("app_dev", branch);
    assert.equal(name.length, 63);
    assert.match(name, /_[0-9a-f]{6}$/);
  });

  it("keeps two long branches apart", () => {
    const first = branchDatabaseName("app_dev", `feat/${"a".repeat(120)}-one`);
    const second = branchDatabaseName("app_dev", `feat/${"a".repeat(120)}-two`);
    assert.notEqual(first, second);
  });

  it("refuses a branch that slugifies to nothing", () => {
    assert.throws(() => branchDatabaseName("app_dev", "///"), /Cannot name/);
  });
});

describe("assertManagedDatabase", () => {
  it("accepts the plain prefix and a branch database", () => {
    assertManagedDatabase("app_dev", "app_dev");
    assertManagedDatabase("app_dev", "app_dev_issue_152_abc123");
  });

  it("refuses a database of another project", () => {
    assert.throws(
      () => assertManagedDatabase("app_dev", "other_dev_main"),
      /Refusing/
    );
  });

  it("refuses postgres, the maintenance database", () => {
    assert.throws(
      () => assertManagedDatabase("app_dev", "postgres"),
      /Refusing/
    );
  });

  // The guard is what lets a backend quote the name into `sql.unsafe`.
  it("refuses a name carrying a quote or a statement separator", () => {
    assert.throws(
      () => assertManagedDatabase("app_dev", 'app_dev"; DROP DATABASE x; --'),
      /Refusing/
    );
  });

  it("refuses a name past 63 bytes", () => {
    assert.throws(
      () => assertManagedDatabase("app_dev", `app_dev_${"a".repeat(60)}`),
      /Refusing/
    );
  });
});
