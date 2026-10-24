// Tests for ./data-table-highlight.ts. This file is NOT in the descriptor's `files` list,
// so `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ./data-table-cards.test.ts does. Run them with `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepHighlight, tableKeysLive } from "./data-table-highlight.ts";

const rows = ["a", "b", "c"];

describe("stepHighlight", () => {
  it("returns null for an empty list", () => {
    assert.equal(stepHighlight([], null, null, 1), null);
    assert.equal(stepHighlight([], "a", "a", -1), null);
  });

  it("starts J at the first row and K at the last when nothing is picked", () => {
    assert.equal(stepHighlight(rows, null, null, 1), "a");
    assert.equal(stepHighlight(rows, null, null, -1), "c");
  });

  it("moves one row from the highlight", () => {
    assert.equal(stepHighlight(rows, "a", null, 1), "b");
    assert.equal(stepHighlight(rows, "c", null, -1), "b");
  });

  it("stops at either end rather than wrapping", () => {
    assert.equal(stepHighlight(rows, "c", null, 1), "c");
    assert.equal(stepHighlight(rows, "a", null, -1), "a");
  });

  it("starts from the selection when nothing is highlighted", () => {
    assert.equal(stepHighlight(rows, null, "b", 1), "c");
    assert.equal(stepHighlight(rows, null, "b", -1), "a");
  });

  it("prefers the highlight over the selection", () => {
    assert.equal(stepHighlight(rows, "a", "c", 1), "b");
  });

  it("treats an id that left the list as no pick", () => {
    assert.equal(stepHighlight(rows, "gone", null, 1), "a");
    assert.equal(stepHighlight(rows, "gone", "also-gone", -1), "c");
    assert.equal(stepHighlight(rows, "gone", "b", 1), "c");
  });
});

describe("tableKeysLive", () => {
  // A stand-in element: `control` says whether it sits in a button, link or field.
  const element = (control: boolean) => ({
    closest: (selector: string) =>
      control && selector.includes("button") ? {} : null,
  });
  const inside = element(true);
  const table = { contains: (node: unknown) => node === inside };

  it("acts with nothing focused", () => {
    assert.equal(tableKeysLive(null, table), true);
  });

  it("acts with the page body focused", () => {
    assert.equal(tableKeysLive(element(false), table), true);
  });

  it("acts with the focus on one of the table's own controls", () => {
    assert.equal(tableKeysLive(inside, table), true);
  });

  it("leaves the key to a focused control outside the table", () => {
    assert.equal(tableKeysLive(element(true), table), false);
    assert.equal(tableKeysLive(element(true), null), false);
  });
});
