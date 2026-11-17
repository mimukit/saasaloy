// Tests for ./branch-name.ts. This file is NOT in the descriptor's `scaffolds[].files`
// list, so `add database-postgres` never copies it into a user's project — it exists for
// this repo only. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertManagedDatabase,
  branchDatabaseName,
  databasePrefix,
  isWorkerDatabase,
  testDatabaseName,
  workerDatabaseName,
  workerNumber,
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

describe("testDatabaseName", () => {
  it("appends _test to the development database", () => {
    assert.equal(testDatabaseName("app_dev"), "app_dev_test");
    assert.equal(
      testDatabaseName("app_dev_issue_207_abc123"),
      "app_dev_issue_207_abc123_test"
    );
  });

  it("gives two worktrees two test databases", () => {
    assert.notEqual(
      testDatabaseName(branchDatabaseName("app_dev", "issue-207-seed")),
      testDatabaseName(branchDatabaseName("app_dev", "issue-208-other"))
    );
  });

  it("stays a managed name inside 63 bytes for a long branch", () => {
    const database = branchDatabaseName("app_dev", `feature-${"x".repeat(80)}`);
    const name = testDatabaseName(database);
    assert.ok(name.length <= 63);
    assert.match(name, /_test$/);
    assert.notEqual(name, testDatabaseName(`${database.slice(0, -1)}y`));
    assertManagedDatabase("app_dev", name);
  });

  // `db:drop` drops the test database through the same guard as the development one.
  it("passes the drop guard for the default and a branch database", () => {
    assertManagedDatabase("app_dev", testDatabaseName("app_dev"));
    assertManagedDatabase(
      "app_dev",
      testDatabaseName(branchDatabaseName("app_dev", "issue-339-prune"))
    );
  });
});

describe("workerDatabaseName", () => {
  it("appends _w<worker> to the test database", () => {
    assert.equal(workerDatabaseName("app_dev_test", 1), "app_dev_test_w1");
    assert.equal(workerDatabaseName("app_dev_test", 4), "app_dev_test_w4");
  });

  it("stays a managed name inside 63 bytes for a long test database", () => {
    const test = testDatabaseName(
      branchDatabaseName("app_dev", `feature-${"x".repeat(80)}`)
    );
    const name = workerDatabaseName(test, 12);
    assert.ok(name.length <= 63);
    assert.match(name, /_[0-9a-f]{6}_w12$/);
    assertManagedDatabase("app_dev", name);
  });

  it("gives each worker and each long test database its own name", () => {
    const first = testDatabaseName(
      branchDatabaseName("app_dev", `feature-${"x".repeat(80)}-one`)
    );
    const second = testDatabaseName(
      branchDatabaseName("app_dev", `feature-${"x".repeat(80)}-two`)
    );
    assert.notEqual(workerDatabaseName(first, 1), workerDatabaseName(first, 2));
    assert.notEqual(
      workerDatabaseName(first, 1),
      workerDatabaseName(second, 1)
    );
  });

  // `VITEST_POOL_ID` starts at 1, so 0 or a fraction means the caller read it wrong.
  it("refuses a worker below 1 or not a whole number", () => {
    assert.throws(() => workerDatabaseName("app_dev_test", 0), /from 1/);
    assert.throws(() => workerDatabaseName("app_dev_test", 1.5), /from 1/);
  });
});

describe("isWorkerDatabase", () => {
  it("tells a worker clone from a test database and from a branch database", () => {
    assert.equal(isWorkerDatabase("app_dev_test_w3"), true);
    assert.equal(isWorkerDatabase("app_dev_test"), false);
    assert.equal(isWorkerDatabase("app_dev_wallet"), false);
    assert.equal(
      isWorkerDatabase(branchDatabaseName("app_dev", "wallet")),
      false
    );
  });

  it("reads the worker number back", () => {
    assert.equal(workerNumber(workerDatabaseName("app_dev_test", 7)), 7);
    assert.equal(workerNumber("app_dev_test"), undefined);
  });
});
