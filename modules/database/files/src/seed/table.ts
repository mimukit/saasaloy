import { getTableColumns, getTableName, is } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { ColumnShape, TableShape } from "./plan";

// Reads the shape `./plan.ts` needs off a Drizzle table: its columns, its primary key and
// the tables its foreign keys point at. Each schema file is a `pgTable`.

/** Every Drizzle table in a module's exports, such as the schema barrel. */
export function tablesIn(exports: Record<string, unknown>): PgTable[] {
  return Object.values(exports).filter((value): value is PgTable =>
    is(value, PgTable)
  );
}

/** True when the database fills the column: a Postgres identity or serial. */
function isGenerated(column: Column): boolean {
  const { generatedIdentity } = column as Column & {
    generatedIdentity?: unknown;
  };
  return Boolean(generatedIdentity) || column.columnType.includes("Serial");
}

export function describeTable(table: PgTable): TableShape {
  const { columns, foreignKeys, primaryKeys } = getTableConfig(table);
  // Keyed by SQL name, not by column object: a composite primary key hands back the
  // wrappers Drizzle built for the table's extra config, not the table's own columns.
  const keyOf = new Map<string, string>(
    Object.entries(getTableColumns(table)).map(([key, column]) => [
      column.name,
      key,
    ])
  );

  const composite = new Set(
    (primaryKeys[0]?.columns ?? []).map((column) => column.name)
  );
  const primary = columns.filter((column) =>
    composite.size > 0 ? composite.has(column.name) : column.primary
  );

  const shapes: ColumnShape[] = columns.map((column) => ({
    key: keyOf.get(column.name) ?? column.name,
    name: column.name,
    text: column.dataType === "string",
    generated: primary.includes(column) && isGenerated(column),
  }));

  return {
    name: getTableName(table),
    columns: shapes,
    primaryKey: primary.map((column) => keyOf.get(column.name) ?? column.name),
    references: [
      ...new Set(
        foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
      ),
    ],
  };
}
