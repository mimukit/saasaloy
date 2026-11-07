// Tests for ./attention.ts. This file is NOT in the descriptor's `files` list, so
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
import { attentionRows } from "./attention.ts";

const SOURCES = [
  { to: "/payments", label: "Payments to review" },
  { to: "/support", label: "Open support tickets" },
  { to: "/quotes", label: "Quotes to price" },
];

describe("attentionRows", () => {
  it("keeps the queues with work, in the order given, and sums them", () => {
    assert.deepEqual(
      attentionRows(SOURCES, { "/payments": 2, "/support": 0, "/quotes": 3 }),
      {
        rows: [
          { to: "/payments", label: "Payments to review", count: 2 },
          { to: "/quotes", label: "Quotes to price", count: 3 },
        ],
        total: 5,
      }
    );
  });

  it("hides a queue whose count is unknown", () => {
    assert.deepEqual(attentionRows(SOURCES, { "/payments": undefined }), {
      rows: [],
      total: 0,
    });
  });
});
