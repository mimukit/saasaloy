// Tests for ./data-table-cards.ts. This file is NOT in the descriptor's `files` list, so
// `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ../../lib/shell/nav-counts.test.ts does.
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
import { cardSlots } from "./data-table-cards.ts";
import type { CardSlotColumn } from "./data-table-cards.ts";

function ids(columns: readonly CardSlotColumn[]): string[] {
  return columns.map((column) => column.id);
}

describe("cardSlots", () => {
  it("makes the first column the title and every other column a line by default", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "email" },
      { id: "joined" },
    ]);

    assert.deepEqual(ids(slots.title), ["name"]);
    assert.deepEqual(ids(slots.trailing), []);
    assert.deepEqual(ids(slots.lines), ["email", "joined"]);
  });

  it("lets an explicit title elsewhere turn the first column into a line", () => {
    const slots = cardSlots([
      { id: "method" },
      { id: "reference", card: "title" },
      { id: "submitted" },
    ]);

    assert.deepEqual(ids(slots.title), ["reference"]);
    assert.deepEqual(ids(slots.lines), ["method", "submitted"]);
  });

  it("puts a trailing column at the right of the title row, not in the lines", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "amount", card: "trailing" },
      { id: "date" },
    ]);

    assert.deepEqual(ids(slots.title), ["name"]);
    assert.deepEqual(ids(slots.trailing), ["amount"]);
    assert.deepEqual(ids(slots.lines), ["date"]);
  });

  it("leaves a hidden column out of every slot", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "internal", card: "hidden" },
      { id: "email" },
    ]);

    assert.deepEqual(ids(slots.title), ["name"]);
    assert.deepEqual(ids(slots.trailing), []);
    assert.deepEqual(ids(slots.lines), ["email"]);
  });

  it("keeps column order inside each slot", () => {
    const slots = cardSlots([
      { id: "a", card: "line" },
      { id: "b", card: "trailing" },
      { id: "c", card: "title" },
      { id: "d" },
      { id: "e", card: "trailing" },
      { id: "f", card: "title" },
      { id: "g" },
    ]);

    assert.deepEqual(ids(slots.title), ["c", "f"]);
    assert.deepEqual(ids(slots.trailing), ["b", "e"]);
    assert.deepEqual(ids(slots.lines), ["a", "d", "g"]);
  });

  it("returns the column objects themselves, so a caller keeps its own fields", () => {
    const amount = {
      id: "amount",
      card: "trailing" as const,
      header: "Amount",
    };
    const slots = cardSlots([{ id: "name" }, amount]);

    assert.equal(slots.trailing[0], amount);
  });
});
