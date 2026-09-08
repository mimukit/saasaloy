// Tests for the key builder. Keys are the tenant boundary: a caller passes parts and
// never a path, so nothing a user types can write outside its own prefix. This file is
// repo-only — it is not in the descriptor's scaffold list — and runs on `node:test` via
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertValidKey,
  buildKey,
  isValidKey,
  sanitizeFilename,
  tenantPrefix,
} from "./keys.ts";
import { StorageError } from "./provider.ts";

const base = { filename: "a.txt", id: "i", scope: "s", tenantId: "t1" };

describe("buildKey", () => {
  it("builds t/<tenantId>/<scope>/<id>/<filename>", () => {
    assert.equal(buildKey(base), "t/t1/s/i/a.txt");
  });

  it("rejects a traversal in any id segment", () => {
    for (const part of ["tenantId", "scope", "id"] as const) {
      assert.throws(
        () => buildKey({ ...base, [part]: ".." }),
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      );
    }
  });

  it("rejects a path separator and an absolute path", () => {
    for (const value of ["a/b", "a\\b", "/a", "../other"]) {
      assert.throws(
        () => buildKey({ ...base, tenantId: value }),
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      );
    }
  });

  it("rejects an empty segment", () => {
    assert.throws(
      () => buildKey({ ...base, scope: "" }),
      (error: unknown) =>
        error instanceof StorageError && error.code === "invalid_key"
    );
  });

  it("folds a traversing filename into one flat segment", () => {
    const key = buildKey({ ...base, filename: "../../etc/passwd" });
    assert.equal(key, "t/t1/s/i/_._etc_passwd");
    assert.ok(!key.includes(".."));
  });

  it("folds a non-ASCII filename and keeps its extension", () => {
    assert.equal(
      buildKey({ ...base, filename: "отчёт.csv" }),
      "t/t1/s/i/_.csv"
    );
    assert.equal(
      buildKey({ ...base, filename: "quarterly отчёт.csv" }),
      "t/t1/s/i/quarterly_.csv"
    );
  });

  it("refuses a filename with nothing usable left", () => {
    assert.throws(
      () => sanitizeFilename("..."),
      (error: unknown) =>
        error instanceof StorageError && error.code === "invalid_key"
    );
  });

  it("produces a key it recognises as its own", () => {
    assert.ok(isValidKey(buildKey(base)));
    assert.equal(assertValidKey(buildKey(base)), "t/t1/s/i/a.txt");
  });
});

describe("isValidKey", () => {
  it("refuses anything the builder would not have produced", () => {
    for (const key of [
      "t/t1/s/i/../../a.txt",
      "/t/t1/s/i/a.txt",
      "t/t1/s/a.txt",
      "t/t1/s/i/a.txt/extra",
      "other/t1/s/i/a.txt",
      "",
    ]) {
      assert.equal(isValidKey(key), false, key);
    }
  });

  it("assertValidKey throws invalid_key on a key from outside", () => {
    assert.throws(
      () => assertValidKey("../secrets"),
      (error: unknown) =>
        error instanceof StorageError && error.code === "invalid_key"
    );
  });
});

describe("tenantPrefix", () => {
  it("scopes a list to one tenant, with and without a scope", () => {
    assert.equal(tenantPrefix("t1"), "t/t1/");
    assert.equal(tenantPrefix("t1", "uploads"), "t/t1/uploads/");
  });

  it("refuses a tenant id that would break out of the prefix", () => {
    assert.throws(
      () => tenantPrefix("../t2"),
      (error: unknown) =>
        error instanceof StorageError && error.code === "invalid_key"
    );
  });
});
