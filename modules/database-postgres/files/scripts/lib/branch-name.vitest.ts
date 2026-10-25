// Tests for ./branch-name.ts. It ships as `branch-name.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import {
  assertManagedDatabase,
  branchDatabaseName,
  databasePrefix,
  testDatabaseName,
} from "./branch-name";

describe(databasePrefix, () => {
  it("slugifies the project name and adds _dev", () => {
    expect(databasePrefix("@acme/shop")).toBe("acme_shop_dev");
    expect(databasePrefix("My App")).toBe("my_app_dev");
  });

  it("falls back to app_dev for a name that cannot start an identifier", () => {
    expect(databasePrefix("")).toBe("app_dev");
    expect(databasePrefix("---")).toBe("app_dev");
    expect(databasePrefix("2fast")).toBe("app_dev");
  });
});

describe(branchDatabaseName, () => {
  it("keeps only the issue number of an issue branch", () => {
    const name = branchDatabaseName("app_dev", "issue-152-add-db-setup");
    expect(name).toMatch(/^app_dev_issue_152_[0-9a-f]{6}$/);
  });

  it("gives two issue branches with one number different names", () => {
    expect(branchDatabaseName("app_dev", "issue-152-one")).not.toBe(
      branchDatabaseName("app_dev", "issue-152-two")
    );
  });

  it("slugifies any other branch", () => {
    expect(branchDatabaseName("app_dev", "feat/Add-Teams")).toBe(
      "app_dev_feat_add_teams"
    );
  });

  it("cuts a name over 63 bytes and suffixes it with the branch hash", () => {
    const branch = `feat/${"a".repeat(120)}`;
    const name = branchDatabaseName("app_dev", branch);
    expect(name).toHaveLength(63);
    expect(name).toMatch(/_[0-9a-f]{6}$/);
  });

  it("keeps two long branches apart", () => {
    const first = branchDatabaseName("app_dev", `feat/${"a".repeat(120)}-one`);
    const second = branchDatabaseName("app_dev", `feat/${"a".repeat(120)}-two`);
    expect(first).not.toBe(second);
  });

  it("refuses a branch that slugifies to nothing", () => {
    expect(() => branchDatabaseName("app_dev", "///")).toThrow(/Cannot name/);
  });
});

describe(assertManagedDatabase, () => {
  it("accepts the plain prefix and a branch database", () => {
    expect(() => assertManagedDatabase("app_dev", "app_dev")).not.toThrow();
    expect(() =>
      assertManagedDatabase("app_dev", "app_dev_issue_152_abc123")
    ).not.toThrow();
  });

  it("refuses a database of another project", () => {
    expect(() => assertManagedDatabase("app_dev", "other_dev_main")).toThrow(
      /Refusing/
    );
  });

  it("refuses postgres, the maintenance database", () => {
    expect(() => assertManagedDatabase("app_dev", "postgres")).toThrow(
      /Refusing/
    );
  });

  // The guard is what lets a backend quote the name into `sql.unsafe`.
  it("refuses a name carrying a quote or a statement separator", () => {
    expect(() =>
      assertManagedDatabase("app_dev", 'app_dev"; DROP DATABASE x; --')
    ).toThrow(/Refusing/);
  });

  it("refuses a name past 63 bytes", () => {
    expect(() =>
      assertManagedDatabase("app_dev", `app_dev_${"a".repeat(60)}`)
    ).toThrow(/Refusing/);
  });
});

describe(testDatabaseName, () => {
  it("appends _test to the development database", () => {
    expect(testDatabaseName("app_dev")).toBe("app_dev_test");
    expect(testDatabaseName("app_dev_issue_207_abc123")).toBe(
      "app_dev_issue_207_abc123_test"
    );
  });

  it("gives two worktrees two test databases", () => {
    expect(
      testDatabaseName(branchDatabaseName("app_dev", "issue-207-seed"))
    ).not.toBe(
      testDatabaseName(branchDatabaseName("app_dev", "issue-208-other"))
    );
  });

  it("stays a managed name inside 63 bytes for a long branch", () => {
    const database = branchDatabaseName("app_dev", `feature-${"x".repeat(80)}`);
    const name = testDatabaseName(database);
    expect(name.length <= 63).toBeTruthy();
    expect(name).toMatch(/_test$/);
    expect(name).not.toBe(testDatabaseName(`${database.slice(0, -1)}y`));
    assertManagedDatabase("app_dev", name);
  });
});
