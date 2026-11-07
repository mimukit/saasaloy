// Tests for ./password.ts. This file is NOT in the descriptor's `scaffolds[].files` list,
// so `add database-postgres` never copies it into a user's project: it exists for this
// repo only. Run them with `pnpm test:modules`.
//
// The seed's dev password and its stored hash are read as text from the auth module's
// `db/seed/accounts.ts`, which imports the Drizzle schema and cannot load here. Better Auth
// signs the seed users in with that hash, so matching it proves this file derives keys the
// way Better Auth does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./password.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");

const AUTH = "../../../../auth/files/";
const accounts = read(`${AUTH}db/seed/accounts.ts`);
const DEV_PASSWORD =
  /const DEV_PASSWORD = "([^"]+)";/.exec(accounts)?.[1] ?? "";
const DEV_PASSWORD_HASH =
  /const DEV_PASSWORD_HASH =\s*"([0-9a-f]+:[0-9a-f]+)";/.exec(accounts)?.[1] ??
  "";

describe("verifyPassword", () => {
  it("reads the seed's password and hash", () => {
    assert.equal(DEV_PASSWORD, "saasaloy-dev-password");
    assert.match(DEV_PASSWORD_HASH, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("accepts the seed password against the hash Better Auth signs in with", async () => {
    assert.equal(await verifyPassword(DEV_PASSWORD_HASH, DEV_PASSWORD), true);
  });

  it("refuses a wrong password", async () => {
    assert.equal(
      await verifyPassword(DEV_PASSWORD_HASH, "saasaloy-dev-passwore"),
      false
    );
  });

  it("throws on something that is not a hash", async () => {
    await assert.rejects(
      verifyPassword("plain", DEV_PASSWORD),
      /Not a Better Auth password hash/
    );
  });
});

describe("hashPassword", () => {
  it("writes a 16-byte salt and a 64-byte key in hex, and verifies", async () => {
    const hash = await hashPassword("a long enough password");
    assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(await verifyPassword(hash, "a long enough password"), true);
  });

  it("salts every hash", async () => {
    assert.notEqual(
      await hashPassword("same password here"),
      await hashPassword("same password here")
    );
  });

  it("hashes the NFKC form, as Better Auth does", async () => {
    // U+FB01 (the "fi" ligature) folds to "fi" under NFKC.
    const hash = await hashPassword("proﬁle password");
    assert.equal(await verifyPassword(hash, "profile password"), true);
  });
});

describe("passwordProblem", () => {
  it("keeps the floor the auth module's sign-up applies", () => {
    assert.match(
      read(`${AUTH}src/auth.ts`),
      new RegExp(`const MIN_PASSWORD_LENGTH = ${String(MIN_PASSWORD_LENGTH)};`)
    );
  });

  it("passes a password inside the limits", () => {
    assert.equal(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH)), undefined);
    assert.equal(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH)), undefined);
  });

  it("refuses a short, an overlong or a space-padded password", () => {
    assert.match(
      passwordProblem("x".repeat(MIN_PASSWORD_LENGTH - 1)) ?? "",
      /at least 12/
    );
    assert.match(
      passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1)) ?? "",
      /at most/
    );
    assert.match(passwordProblem(" padded password ") ?? "", /space/);
  });
});
