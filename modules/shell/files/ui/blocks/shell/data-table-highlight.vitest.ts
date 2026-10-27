// Tests for ./data-table-highlight.ts. The file ships as `data-table-highlight.test.ts`
// beside it when testing is on, and `pnpm test:modules` runs it in place on Vitest in
// the saasaloy repo.

import { describe, expect, it } from "vitest";
import { stepHighlight, tableKeysLive } from "./data-table-highlight";

const rows = ["a", "b", "c"];

describe(stepHighlight, () => {
  it("returns null for an empty list", () => {
    expect(stepHighlight([], null, null, 1)).toBeNull();
    expect(stepHighlight([], "a", "a", -1)).toBeNull();
  });

  it("starts J at the first row and K at the last when nothing is picked", () => {
    expect(stepHighlight(rows, null, null, 1)).toBe("a");
    expect(stepHighlight(rows, null, null, -1)).toBe("c");
  });

  it("moves one row from the highlight", () => {
    expect(stepHighlight(rows, "a", null, 1)).toBe("b");
    expect(stepHighlight(rows, "c", null, -1)).toBe("b");
  });

  it("stops at either end rather than wrapping", () => {
    expect(stepHighlight(rows, "c", null, 1)).toBe("c");
    expect(stepHighlight(rows, "a", null, -1)).toBe("a");
  });

  it("starts from the selection when nothing is highlighted", () => {
    expect(stepHighlight(rows, null, "b", 1)).toBe("c");
    expect(stepHighlight(rows, null, "b", -1)).toBe("a");
  });

  it("prefers the highlight over the selection", () => {
    expect(stepHighlight(rows, "a", "c", 1)).toBe("b");
  });

  it("treats an id that left the list as no pick", () => {
    expect(stepHighlight(rows, "gone", null, 1)).toBe("a");
    expect(stepHighlight(rows, "gone", "also-gone", -1)).toBe("c");
    expect(stepHighlight(rows, "gone", "b", 1)).toBe("c");
  });
});

describe(tableKeysLive, () => {
  // A stand-in element: `control` says whether it sits in a button, link or field.
  const element = (control: boolean) => ({
    closest: (selector: string) =>
      control && selector.includes("button") ? {} : null,
  });
  const inside = element(true);
  const table = { contains: (node: unknown) => node === inside };

  it("acts with nothing focused", () => {
    expect(tableKeysLive(null, table)).toBeTruthy();
  });

  it("acts with the page body focused", () => {
    expect(tableKeysLive(element(false), table)).toBeTruthy();
  });

  it("acts with the focus on one of the table's own controls", () => {
    expect(tableKeysLive(inside, table)).toBeTruthy();
  });

  it("leaves the key to a focused control outside the table", () => {
    expect(tableKeysLive(element(true), table)).toBeFalsy();
    expect(tableKeysLive(element(true), null)).toBeFalsy();
  });
});
