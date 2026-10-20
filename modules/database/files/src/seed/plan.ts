import { seedId } from "./id";
import { orderTables } from "./order";

// The seed plan: every row the seed writes, in write order, with the conflict key each one
// is upserted on. It is built in full before the first write, which is what lets Postgres
// run it in one transaction and D1 in one atomic batch.
//
// This file works on plain shapes (`TableShape`, `SliceShape`) rather than Drizzle tables,
// so the repo tests it without a database or a Drizzle install. `./table.ts` reads the
// shapes off the real schema.

export interface ColumnShape {
  /** The property key a slice row uses, such as `emailVerified`. */
  key: string;
  /** The SQL column name, such as `email_verified`. */
  name: string;
  /** True for a column that holds a string, so a seed id fits it. */
  text: boolean;
  /** True when the database fills the value: an identity, serial or autoincrement key. */
  generated: boolean;
}

export interface TableShape {
  /** The table's SQL name. */
  name: string;
  columns: readonly ColumnShape[];
  /** Property keys of the primary key columns. Empty when the table has none. */
  primaryKey: readonly string[];
  /** SQL names of the tables its foreign keys point at. */
  references: readonly string[];
}

export interface SliceShape {
  /** The SQL name of the table the slice fills. */
  table: string;
  rows: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  key?: readonly string[] | undefined;
  after?: readonly string[] | undefined;
}

export interface PlannedRow {
  slug: string;
  /** The row as written, a derived id included. */
  values: Record<string, unknown>;
  /** Property keys an upsert resets: every value in the row outside the conflict key. */
  update: string[];
}

export interface PlanStep {
  table: string;
  /** Property keys of the conflict target. */
  target: string[];
  rows: PlannedRow[];
}

export class SeedPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedPlanError";
  }
}

/**
 * The conflict key for one slice: its own `key` when it names one, the table's primary key
 * otherwise. A primary key the database generates is refused, because a seed row cannot
 * name its own value and a rerun would insert it again.
 */
export function conflictTarget(table: TableShape, slice: SliceShape): string[] {
  const columns = new Map(table.columns.map((column) => [column.key, column]));

  if (slice.key && slice.key.length > 0) {
    for (const key of slice.key) {
      if (!columns.has(key)) {
        throw new SeedPlanError(
          `The ${table.name} slice names "${key}" in its key, but ${table.name} has no such column.`
        );
      }
    }
    return [...slice.key];
  }

  if (table.primaryKey.length === 0) {
    throw new SeedPlanError(
      `${table.name} has no primary key, so its slice must name a unique key, such as key: ["email"].`
    );
  }
  const generated = table.primaryKey.filter(
    (key) => columns.get(key)?.generated
  );
  if (generated.length > 0) {
    throw new SeedPlanError(
      `${table.name} has a generated primary key (${generated.join(", ")}), so its slice must name a unique key to upsert on, such as key: ["email"].`
    );
  }
  return [...table.primaryKey];
}

/** The one text primary key column a slug can fill, or `undefined`. */
function derivableId(table: TableShape): ColumnShape | undefined {
  if (table.primaryKey.length !== 1) {
    return undefined;
  }
  const column = table.columns.find((col) => col.key === table.primaryKey[0]);
  return column && column.text && !column.generated ? column : undefined;
}

function planRows(
  table: TableShape,
  slice: SliceShape,
  target: readonly string[]
): PlannedRow[] {
  const columns = new Set(table.columns.map((column) => column.key));
  const idColumn = derivableId(table);

  return Object.keys(slice.rows)
    .toSorted()
    .map((slug) => {
      const values: Record<string, unknown> = { ...slice.rows[slug] };
      for (const key of Object.keys(values)) {
        if (!columns.has(key)) {
          throw new SeedPlanError(
            `Row "${slug}" in the ${table.name} slice sets "${key}", but ${table.name} has no such column.`
          );
        }
        if (values[key] === undefined) {
          delete values[key];
        }
      }
      if (idColumn && values[idColumn.key] === undefined) {
        values[idColumn.key] = seedId(table.name, slug);
      }
      for (const key of target) {
        if (values[key] === undefined || values[key] === null) {
          throw new SeedPlanError(
            `Row "${slug}" in the ${table.name} slice has no value for "${key}", which is part of its conflict key.`
          );
        }
      }
      const update = Object.keys(values).filter((key) => !target.includes(key));
      return { slug, values, update };
    });
}

/**
 * Refuse a reference to a row whose id the database generates. Its seed id is a value no
 * row ever holds, so the reference would fail its foreign key, or worse, point at nothing
 * without one.
 */
function assertNoGeneratedReferences(
  tables: ReadonlyMap<string, TableShape>,
  steps: readonly PlanStep[]
): void {
  const forbidden = new Map<string, string>();
  for (const step of steps) {
    const table = tables.get(step.table);
    const generated = table?.columns.some(
      (column) => column.generated && table.primaryKey.includes(column.key)
    );
    if (!generated) {
      continue;
    }
    for (const row of step.rows) {
      forbidden.set(seedId(step.table, row.slug), `${step.table}/${row.slug}`);
    }
  }
  if (forbidden.size === 0) {
    return;
  }
  for (const step of steps) {
    for (const row of step.rows) {
      for (const [key, value] of Object.entries(row.values)) {
        const target = typeof value === "string" && forbidden.get(value);
        if (target) {
          throw new SeedPlanError(
            `Row "${row.slug}" in the ${step.table} slice sets "${key}" to seedId of ${target}, but that table's ids are generated by the database, so no row holds that id. Reference it by a column the slice sets instead.`
          );
        }
      }
    }
  }
}

/**
 * Build the plan for `slices` against the schema's `tables`.
 *
 * Throws `SeedPlanError` for a slice whose table is not in the schema, two slices for one
 * table, a row naming a column the table lacks, or a conflict key it cannot resolve, and
 * `SeedCycleError` when the tables cannot be ordered. Every check runs before anything is
 * written.
 */
export function planSeed(
  tables: readonly TableShape[],
  slices: readonly SliceShape[]
): PlanStep[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const bySlice = new Map<string, SliceShape>();
  for (const slice of slices) {
    if (!byName.has(slice.table)) {
      throw new SeedPlanError(
        `A slice fills ${slice.table}, but the schema has no table by that name.`
      );
    }
    if (bySlice.has(slice.table)) {
      throw new SeedPlanError(
        `Two slices fill ${slice.table}. Keep one slice file per table.`
      );
    }
    bySlice.set(slice.table, slice);
  }

  const order = orderTables(
    [...bySlice.values()].map((slice) => ({
      name: slice.table,
      after: [
        ...(byName.get(slice.table)?.references ?? []),
        ...(slice.after ?? []),
      ],
    }))
  );

  const steps = order.map((name): PlanStep => {
    const table = byName.get(name) as TableShape;
    const slice = bySlice.get(name) as SliceShape;
    const target = conflictTarget(table, slice);
    return { table: name, target, rows: planRows(table, slice, target) };
  });
  assertNoGeneratedReferences(byName, steps);
  return steps;
}

/** The SQL names of the tables in `tables` that no slice fills, sorted. */
export function missingSlices(
  tables: readonly { name: string }[],
  slices: readonly { table: string }[]
): string[] {
  const filled = new Set(slices.map((slice) => slice.table));
  return tables
    .map((table) => table.name)
    .filter((name) => !filled.has(name))
    .toSorted();
}
