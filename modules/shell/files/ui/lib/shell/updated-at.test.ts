// Tests for ./updated-at.ts. This file is NOT in the descriptor's `files` list, so
// `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ./nav-counts.test.ts does.
//
// It runs on `node:test` because vite has to load a tsconfig for every file it transforms,
// and this payload's tsconfig resolves only inside a scaffolded project. Run them with
// `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updatedLabel } from "./updated-at.ts";

const WORDS = {
  justNow: "Updated just now",
  seconds: "Updated {n}s ago",
  minutes: "Updated {n}m ago",
  hours: "Updated {n}h ago",
};

const AT = 1_000_000;

describe("updatedLabel", () => {
  it("reads just now under 10 seconds, and for a time ahead of the clock", () => {
    assert.equal(updatedLabel(AT, AT + 9999, WORDS), "Updated just now");
    assert.equal(updatedLabel(AT, AT - 5000, WORDS), "Updated just now");
  });

  it("counts seconds, then minutes, then hours", () => {
    assert.equal(updatedLabel(AT, AT + 12_000, WORDS), "Updated 12s ago");
    assert.equal(updatedLabel(AT, AT + 60_000, WORDS), "Updated 1m ago");
    assert.equal(updatedLabel(AT, AT + 59 * 60_000, WORDS), "Updated 59m ago");
    assert.equal(updatedLabel(AT, AT + 2 * 3_600_000, WORDS), "Updated 2h ago");
  });
});
