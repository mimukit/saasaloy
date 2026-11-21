import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type {
  PgColumn,
  PgDatabase,
  PgInsertValue,
  PgQueryResultHKT,
  PgTable,
} from "drizzle-orm/pg-core";
import type { PlannedRow, PlanStep } from "./plan";

// Turns the seed plan into Drizzle insert statements: one multi-row `insert … on conflict`
// per plan step, in plan order. The statements are built and not run; the driver awaits
// them one by one inside its transaction.
//
// The update half reads `excluded.<column>`, the row the insert tried to write, rather than
// binding every value a second time. A row that sets nothing outside its conflict key
// becomes `on conflict do nothing`, because an empty `set` is not valid SQL.
//
// One statement holds only rows that set the same columns. A column one row leaves out
// would otherwise reach the statement's `set` as the column default, and the upsert would
// reset a value that row never named. A slice whose rows all set the same keys, which is
// the usual case, is one statement.

/** A Postgres database or an open transaction on one. */
export type SeedDatabase = PgDatabase<PgQueryResultHKT>;

/** Postgres refuses a statement with more bound parameters than this. */
const MAX_PARAMETERS = 65_535;

/** The rows of one step, grouped by the set of keys they write, in plan order. */
function groupByKeys(rows: readonly PlannedRow[]): PlannedRow[][] {
  const groups = new Map<string, PlannedRow[]>();
  for (const row of rows) {
    const keys = Object.keys(row.values).toSorted().join("\u0000");
    const group = groups.get(keys);
    if (group) {
      group.push(row);
    } else {
      groups.set(keys, [row]);
    }
  }
  return [...groups.values()];
}

/** `rows` cut into runs that each stay under the bound-parameter limit. */
function underLimit(rows: PlannedRow[]): PlannedRow[][] {
  const width = Math.max(1, Object.keys(rows[0]?.values ?? {}).length);
  const size = Math.floor(MAX_PARAMETERS / width);
  const runs: PlannedRow[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    runs.push(rows.slice(start, start + size));
  }
  return runs;
}

/** The statements for `plan`, in order, for the driver to await in its transaction. */
export function seedStatements(
  db: SeedDatabase,
  tables: readonly PgTable[],
  plan: readonly PlanStep[]
) {
  const byName = new Map(tables.map((table) => [getTableName(table), table]));

  return plan.flatMap((step) => {
    const table = byName.get(step.table);
    if (!table) {
      throw new Error(
        `The seed plan names ${step.table}, which is not in the schema.`
      );
    }
    const columns = getTableColumns(table);
    const target = step.target.map((key) => columns[key] as PgColumn);

    return groupByKeys(step.rows)
      .flatMap((group) => underLimit(group))
      .map((rows) => {
        const query = db
          .insert(table)
          .values(rows.map((row) => row.values as PgInsertValue<PgTable>));
        const update = rows[0]?.update ?? [];
        if (update.length === 0) {
          return query.onConflictDoNothing({ target });
        }
        const set = Object.fromEntries(
          update.map((key) => [
            key,
            sql`excluded.${sql.identifier((columns[key] as PgColumn).name)}`,
          ])
        );
        return query.onConflictDoUpdate({ set, target });
      });
  });
}
