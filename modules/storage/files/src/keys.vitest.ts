// Tests for the key builder. Keys are the tenant boundary: a caller passes parts and
// never a path, so nothing a user types can write outside its own prefix. It ships as
// `packages/storage/src/keys.test.ts` when testing is on, and `pnpm test:modules` runs it
// in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import {
  assertValidKey,
  buildKey,
  isValidKey,
  sanitizeFilename,
  tenantPrefix,
} from "./keys";
import { StorageError } from "./provider";

const base = { filename: "a.txt", id: "i", scope: "s", tenantId: "t1" };

describe(buildKey, () => {
  it("builds t/<tenantId>/<scope>/<id>/<filename>", () => {
    expect(buildKey(base)).toBe("t/t1/s/i/a.txt");
  });

  it("rejects a traversal in any id segment", () => {
    for (const part of ["tenantId", "scope", "id"] as const) {
      expect(() => buildKey({ ...base, [part]: ".." })).toThrow(
        expect.toSatisfy(
          (error: unknown) =>
            error instanceof StorageError && error.code === "invalid_key"
        )
      );
    }
  });

  it("rejects a path separator and an absolute path", () => {
    for (const value of ["a/b", "a\\b", "/a", "../other"]) {
      expect(() => buildKey({ ...base, tenantId: value })).toThrow(
        expect.toSatisfy(
          (error: unknown) =>
            error instanceof StorageError && error.code === "invalid_key"
        )
      );
    }
  });

  it("rejects an empty segment", () => {
    expect(() => buildKey({ ...base, scope: "" })).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      )
    );
  });

  it("folds a traversing filename into one flat segment", () => {
    const key = buildKey({ ...base, filename: "../../etc/passwd" });
    expect(key).toBe("t/t1/s/i/_._etc_passwd");
    expect(!key.includes("..")).toBeTruthy();
  });

  it("folds a non-ASCII filename and keeps its extension", () => {
    expect(buildKey({ ...base, filename: "отчёт.csv" })).toBe("t/t1/s/i/_.csv");
    expect(buildKey({ ...base, filename: "quarterly отчёт.csv" })).toBe(
      "t/t1/s/i/quarterly_.csv"
    );
  });

  it("refuses a filename with nothing usable left", () => {
    expect(() => sanitizeFilename("...")).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      )
    );
  });

  it("produces a key it recognises as its own", () => {
    expect(isValidKey(buildKey(base))).toBeTruthy();
    expect(assertValidKey(buildKey(base))).toBe("t/t1/s/i/a.txt");
  });
});

describe(isValidKey, () => {
  it("refuses anything the builder would not have produced", () => {
    for (const key of [
      "t/t1/s/i/../../a.txt",
      "/t/t1/s/i/a.txt",
      "t/t1/s/a.txt",
      "t/t1/s/i/a.txt/extra",
      "other/t1/s/i/a.txt",
      "",
    ]) {
      expect(isValidKey(key)).toBeFalsy();
    }
  });

  it("assertValidKey throws invalid_key on a key from outside", () => {
    expect(() => assertValidKey("../secrets")).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      )
    );
  });
});

describe(tenantPrefix, () => {
  it("scopes a list to one tenant, with and without a scope", () => {
    expect(tenantPrefix("t1")).toBe("t/t1/");
    expect(tenantPrefix("t1", "uploads")).toBe("t/t1/uploads/");
  });

  it("refuses a tenant id that would break out of the prefix", () => {
    expect(() => tenantPrefix("../t2")).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      )
    );
  });
});
