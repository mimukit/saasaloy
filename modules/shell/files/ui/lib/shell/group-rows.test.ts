// Tests for ./group-rows.ts. This file is NOT in the descriptor's `files` list, so
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
import { groupRows } from "./group-rows.ts";

const rows = [
  { id: "a", store: "North" },
  { id: "b", store: "South" },
  { id: "c", store: "North" },
  { id: "d", store: "East" },
  { id: "e", store: "South" },
];

describe("groupRows", () => {
  it("places each group where its first row falls, and keeps the order inside it", () => {
    assert.deepEqual(
      groupRows(rows, (row) => row.store),
      [
        { key: "North", rows: [rows[0], rows[2]] },
        { key: "South", rows: [rows[1], rows[4]] },
        { key: "East", rows: [rows[3]] },
      ]
    );
  });

  it("answers no groups for no rows", () => {
    assert.deepEqual(
      groupRows([], () => "x"),
      []
    );
  });
});
