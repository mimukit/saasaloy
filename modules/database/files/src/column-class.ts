import { getTableColumns, getTableName } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { brandColumnClasses, toSqlNames } from "./column-class-check";
import type { ColumnClass, TableClasses } from "./column-class-check";

// Column classes: how the production read-only role may read each column. One file per
// table under `src/column-classes/`, named after the table in kebab-case, shipped by the
// module that owns the table:
//
//   import { users as usersTable } from "../schema/auth";
//   import { defineColumnClasses } from "../column-class";
//
//   export const users = defineColumnClasses(usersTable, {
//     email: "pii",
//     id: "plain",
//     ...
//   });
//
// Every column key of the table must be named, and only those, so a column added to the
// schema without a class fails `tsc` here and `column-classes.test.ts` in `pnpm test`.
// The grants the read-only role gets are built from these files: a `secret` column is
// never granted, a `pii` column is granted and masked in query output, a `plain` column
// is granted as is. See the `saasaloy-database` skill.

export {
  classificationProblems,
  collectColumnClasses,
  isTableClasses,
  piiColumnNames,
  secretColumns,
} from "./column-class-check";
export type { ColumnClass, TableClasses } from "./column-class-check";

/** One class for every column key of `TTable`, and no other key. */
export type ColumnClassMap<TTable extends Table> = Record<
  keyof TTable["_"]["columns"] & string,
  ColumnClass
>;

/**
 * Declare the class of every column in `table`. `classes` is keyed by the table's property
 * keys, as a seed slice names them; the result is keyed by SQL column name. Export the
 * result from a file in `src/column-classes/`. One file serves both drivers, because the
 * `pgTable` and the `sqliteTable` of a schema file carry the same keys.
 */
export function defineColumnClasses<TTable extends Table>(
  table: TTable,
  classes: NoInfer<ColumnClassMap<TTable>>
): TableClasses {
  const name = getTableName(table);
  return brandColumnClasses({
    columns: toSqlNames(name, getTableColumns(table), classes),
    table: name,
  });
}
