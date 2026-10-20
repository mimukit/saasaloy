import { Table, getTableColumns, getTableName, is } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import { PgTable, getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import type { ColumnShape, TableShape } from "./plan";

// Reads the shape `./plan.ts` needs off a Drizzle table: its columns, its primary key and
// the tables its foreign keys point at. One file serves both drivers, because each schema
// file is a `pgTable` under `database-postgres` and a `sqliteTable` under `database-d1`.

/** Every Drizzle table in a module's exports, such as the schema barrel. */
export function tablesIn(exports: Record<string, unknown>): Table[] {
  return Object.values(exports).filter((value): value is Table =>
    is(value, Table)
  );
}

function config(table: Table) {
  return is(table, PgTable)
    ? pgTableConfig(table)
    : sqliteTableConfig(table as Parameters<typeof sqliteTableConfig>[0]);
}

/**
 * True when the database fills the column: a Postgres identity or serial, or a SQLite
 * `INTEGER PRIMARY KEY`, which is an alias for the rowid with or without `autoIncrement`.
 */
function isGenerated(column: Column, singleKey: boolean): boolean {
  const flags = column as Column & {
    autoIncrement?: boolean;
    generatedIdentity?: unknown;
  };
  if (flags.generatedIdentity || column.columnType.includes("Serial")) {
    return true;
  }
  if (flags.autoIncrement) {
    return true;
  }
  return singleKey && column.primary && column.columnType === "SQLiteInteger";
}

export function describeTable(table: Table): TableShape {
  const { columns, foreignKeys, primaryKeys } = config(table);
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
  const singleKey = primary.length === 1;

  const shapes: ColumnShape[] = columns.map((column) => ({
    key: keyOf.get(column.name) ?? column.name,
    name: column.name,
    text: column.dataType === "string",
    generated: primary.includes(column) && isGenerated(column, singleKey),
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
