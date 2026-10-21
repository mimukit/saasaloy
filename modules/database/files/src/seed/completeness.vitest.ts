import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedPlan, slices, tables } from "./index";
import { missingSlices } from "./plan";

// Every table in the schema has a seed slice, and the slices build a plan. It runs with
// `pnpm test`, so a table added without its slice fails here rather than leaving an empty
// table in every developer's database.
//
// A table that should stay empty still gets a slice, with `rows: {}`. That records the
// choice where the next reader looks for it.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

describe("seed slices", () => {
  it("fill every table in the schema", () => {
    const missing = missingSlices(
      tables.map((table) => ({ name: getTableName(table) })),
      slices.map((slice) => ({ table: getTableName(slice.table) }))
    );
    expect(
      missing,
      `Add a slice under packages/db/src/seed/slices/ for: ${missing.join(", ")}`
    ).toStrictEqual([]);
  });

  it("build a seed plan", () => {
    expect(() => seedPlan()).not.toThrow();
  });
});
