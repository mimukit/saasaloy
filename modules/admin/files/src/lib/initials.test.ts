// Tests for ./initials.ts. This file is NOT in the descriptor's `scaffolds[].files` list,
// so `add admin` never copies it into a user's project — it exists for this repo only, the
// same way ./redirect.test.ts does.
//
// It runs on `node:test` because vite has to load a tsconfig for every file it transforms,
// and this payload's tsconfig resolves only inside a scaffolded project. Run them with
// `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. Shipped payload code keeps the extensionless
// style; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialsOf } from "./initials.ts";

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    assert.equal(initialsOf("Ada Lovelace"), "AL");
  });

  it("takes one letter from a single-word name", () => {
    assert.equal(initialsOf("ada"), "A");
  });

  it("stops at two letters however many words there are", () => {
    assert.equal(initialsOf("Ada Byron King Lovelace"), "AB");
  });

  it("collapses padding and runs of whitespace", () => {
    assert.equal(initialsOf("  a   b  c "), "AB");
  });

  it("falls back to a question mark for an empty name", () => {
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   "), "?");
  });
});
