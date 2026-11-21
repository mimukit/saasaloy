import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { Column, Table } from "drizzle-orm";
import type { PlanStep } from "./plan";

// Turns the seed plan into Drizzle insert statements: one `insert … on conflict` per row,
// in plan order. The statements are built and not run, so the driver decides how they
// run: it awaits them one by one inside a transaction.
//
// The update half reads `excluded.<column>`, the row the insert tried to write, rather than
// binding every value a second time. A row that sets nothing outside its conflict key
// becomes `on conflict do nothing`, because an empty `set` is not valid SQL.

/**
 * The part of a Drizzle database (or Postgres transaction) the statements need. Typed
 * loosely on purpose, so the file takes a client or a transaction without naming the
 * driver's generics.
 */
export interface SeedDatabase {
  insert: (table: never) => unknown;
}

interface InsertBuilder {
  values: (row: Record<string, unknown>) => {
    onConflictDoUpdate: (config: {
      target: Column[];
      set: Record<string, unknown>;
    }) => unknown;
    onConflictDoNothing: (config: { target: Column[] }) => unknown;
  };
}

/** The statements for `plan`, in order, ready to await or to batch. */
export function seedStatements(
  db: SeedDatabase,
  tables: readonly Table[],
  plan: readonly PlanStep[]
): unknown[] {
  const byName = new Map(tables.map((table) => [getTableName(table), table]));

  return plan.flatMap((step) => {
    const table = byName.get(step.table);
    if (!table) {
      throw new Error(
        `The seed plan names ${step.table}, which is not in the schema.`
      );
    }
    const columns = getTableColumns(table);
    const target = step.target.map((key) => columns[key] as Column);
    const insert = db.insert as (table: Table) => InsertBuilder;

    return step.rows.map((row) => {
      const query = insert.call(db, table).values(row.values);
      if (row.update.length === 0) {
        return query.onConflictDoNothing({ target });
      }
      const set = Object.fromEntries(
        row.update.map((key) => [
          key,
          sql`excluded.${sql.identifier((columns[key] as Column).name)}`,
        ])
      );
      return query.onConflictDoUpdate({ target, set });
    });
  });
}
