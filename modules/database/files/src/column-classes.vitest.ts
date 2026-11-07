import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classificationProblems } from "./column-class";
import { columnClasses } from "./column-classes";
import { schema } from "./schema";
import { tablesIn } from "./seed/table";

// Every column in the schema has a class, and every class names a column the schema has.
// It runs with `pnpm test`, so a column added without its class fails here rather than
// leaving the production read-only role without a grant for it, or with one for a column
// that should never be read.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

describe("column classes", () => {
  it("classify every column in the schema", () => {
    const problems = classificationProblems(
      tablesIn(schema).map((table) => ({
        columns: Object.values(getTableColumns(table)).map(
          (column) => column.name
        ),
        table: getTableName(table),
      })),
      columnClasses
    );
    expect(
      problems,
      `Add or edit packages/db/src/column-classes/<table>.ts, the table name in kebab-case, for:\n  ${problems.join("\n  ")}`
    ).toStrictEqual([]);
  });
});
