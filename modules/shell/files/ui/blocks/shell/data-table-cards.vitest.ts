// Tests for ./data-table-cards.ts. The file ships as `data-table-cards.test.ts` beside
// it when testing is on, and `pnpm test:modules` runs it in place on Vitest in the
// saasaloy repo, with imports resolved by project path.

import { describe, expect, it } from "vitest";
import { cardSlots } from "./data-table-cards";
import type { CardSlotColumn } from "./data-table-cards";

function ids(columns: readonly CardSlotColumn[]): string[] {
  return columns.map((column) => column.id);
}

describe(cardSlots, () => {
  it("makes the first column the title and every other column a line by default", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "email" },
      { id: "joined" },
    ]);

    expect(ids(slots.title)).toStrictEqual(["name"]);
    expect(ids(slots.trailing)).toStrictEqual([]);
    expect(ids(slots.lines)).toStrictEqual(["email", "joined"]);
  });

  it("lets an explicit title elsewhere turn the first column into a line", () => {
    const slots = cardSlots([
      { id: "method" },
      { id: "reference", card: "title" },
      { id: "submitted" },
    ]);

    expect(ids(slots.title)).toStrictEqual(["reference"]);
    expect(ids(slots.lines)).toStrictEqual(["method", "submitted"]);
  });

  it("puts a trailing column at the right of the title row, not in the lines", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "amount", card: "trailing" },
      { id: "date" },
    ]);

    expect(ids(slots.title)).toStrictEqual(["name"]);
    expect(ids(slots.trailing)).toStrictEqual(["amount"]);
    expect(ids(slots.lines)).toStrictEqual(["date"]);
  });

  it("leaves a hidden column out of every slot", () => {
    const slots = cardSlots([
      { id: "name" },
      { id: "internal", card: "hidden" },
      { id: "email" },
    ]);

    expect(ids(slots.title)).toStrictEqual(["name"]);
    expect(ids(slots.trailing)).toStrictEqual([]);
    expect(ids(slots.lines)).toStrictEqual(["email"]);
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

    expect(ids(slots.title)).toStrictEqual(["c", "f"]);
    expect(ids(slots.trailing)).toStrictEqual(["b", "e"]);
    expect(ids(slots.lines)).toStrictEqual(["a", "d", "g"]);
  });

  it("returns the column objects themselves, so a caller keeps its own fields", () => {
    const amount = {
      id: "amount",
      card: "trailing" as const,
      header: "Amount",
    };
    const slots = cardSlots([{ id: "name" }, amount]);

    expect(slots.trailing[0]).toBe(amount);
  });
});
