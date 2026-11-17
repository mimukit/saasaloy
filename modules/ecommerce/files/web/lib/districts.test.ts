// Tests for the district list. Repo-only: the descriptor ships `districts.ts`, never this
// file. It runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BANGLADESH_DISTRICTS } from "./districts.ts";

describe("BANGLADESH_DISTRICTS", () => {
  it("holds the 64 districts", () => {
    assert.equal(BANGLADESH_DISTRICTS.length, 64);
  });

  it("names each district once, in any case", () => {
    const names = BANGLADESH_DISTRICTS.map((name) => name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  it("lists them in alphabetical order with no blank name", () => {
    assert.ok(
      BANGLADESH_DISTRICTS.every((name) => name.trim() === name && name !== "")
    );
    assert.deepEqual(
      [...BANGLADESH_DISTRICTS].toSorted((a, b) => a.localeCompare(b, "en")),
      [...BANGLADESH_DISTRICTS]
    );
  });

  it("includes the capital and the renamed districts by their current names", () => {
    for (const name of [
      "Dhaka",
      "Chattogram",
      "Cumilla",
      "Barishal",
      "Bogura",
      "Jashore",
    ]) {
      assert.ok(BANGLADESH_DISTRICTS.includes(name), name);
    }
  });
});
