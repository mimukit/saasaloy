// Tests for the signed token that authorizes the proxy route: it round-trips, a tampered
// one fails, an expired one fails, and a missing secret fails loudly with the command
// that fixes it. Repo-only, run by `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StorageError } from "./provider.ts";
import { signToken, verifyToken } from "./token.ts";

const env = { STORAGE_URL_SECRET: "test-secret-value-not-a-real-key" };

const claims = {
  contentType: "text/plain",
  exp: Math.floor(Date.now() / 1000) + 300,
  key: "t/t1/uploads/i/a.txt",
  maxBytes: 1024,
  method: "PUT" as const,
};

function isInvalidKey(error: unknown): boolean {
  return error instanceof StorageError && error.code === "invalid_key";
}

describe("signToken / verifyToken", () => {
  it("round-trips every claim", async () => {
    const verified = await verifyToken(env, await signToken(env, claims));
    assert.deepEqual(verified, claims);
  });

  it("refuses a token whose payload was edited", async () => {
    const token = await signToken(env, claims);
    const [, signature] = token.split(".");
    const forged = btoa(
      JSON.stringify({ ...claims, key: "t/t2/uploads/i/a.txt" })
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    await assert.rejects(
      () => verifyToken(env, `${forged}.${signature}`),
      isInvalidKey
    );
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signToken({ STORAGE_URL_SECRET: "other" }, claims);
    await assert.rejects(() => verifyToken(env, token), isInvalidKey);
  });

  it("refuses a malformed token", async () => {
    for (const token of ["", "nodot", "a.b"]) {
      await assert.rejects(() => verifyToken(env, token), isInvalidKey);
    }
  });

  it("refuses an expired token, and accepts it a second before", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signToken(env, { ...claims, exp });
    assert.equal(
      (await verifyToken(env, token, new Date((exp - 1) * 1000))).exp,
      exp
    );
    await assert.rejects(
      () => verifyToken(env, token, new Date(exp * 1000)),
      isInvalidKey
    );
  });

  it("throws by name when STORAGE_URL_SECRET is unset", async () => {
    await assert.rejects(
      () => signToken({}, claims),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("STORAGE_URL_SECRET") &&
        error.message.includes("openssl rand -base64 32")
    );
    await assert.rejects(
      () => verifyToken({}, "a.b"),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("STORAGE_URL_SECRET") &&
        error.message.includes("openssl rand -base64 32")
    );
  });
});
