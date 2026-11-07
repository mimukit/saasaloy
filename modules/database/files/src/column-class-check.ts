// The Drizzle-free half of `./column-class.ts`: the class type, the collected shape and the
// checks over it. It imports nothing, so a script and a `node --test` file can read the
// class rule without a Drizzle install. `./column-class.ts` re-exports all of it; import
// from there in project code.

/**
 * How a column may be read by the production read-only role.
 *
 * - `secret`: a credential, token, password or key hash, or one-time code. Never readable.
 * - `pii`: a name, email, phone, address, IP address, or free text a person wrote.
 *   Readable, and masked in query output.
 * - `plain`: everything else. Readable as is.
 */
export type ColumnClass = "secret" | "pii" | "plain";

/** The classes of one table, keyed by SQL column name. */
export interface TableClasses {
  /** The SQL table name. */
  table: string;
  /** Every column's class, keyed by SQL column name. */
  columns: Readonly<Record<string, ColumnClass>>;
}

const CLASSES = Symbol.for("saasaloy.db.column-classes");

/** Marks `classes` as a class file export, so `collectColumnClasses` finds it. */
export function brandColumnClasses(classes: TableClasses): TableClasses {
  return Object.assign(classes, { [CLASSES]: true });
}

export function isTableClasses(value: unknown): value is TableClasses {
  return typeof value === "object" && value !== null && CLASSES in value;
}

/**
 * Rekey `classes` from a table's property keys to its SQL column names. `columns` maps each
 * property key to the column Drizzle built for it, as `getTableColumns` returns it. A key
 * the table lacks throws: the types already refuse it, so reaching it means a cast.
 */
export function toSqlNames(
  table: string,
  columns: Readonly<Record<string, { name: string }>>,
  classes: Readonly<Record<string, ColumnClass>>
): Record<string, ColumnClass> {
  return Object.fromEntries(
    Object.entries(classes).map(([key, value]) => {
      const column = columns[key];
      if (!column) {
        throw new TypeError(`${table} has no column with the key "${key}"`);
      }
      return [column.name, value];
    })
  );
}

/**
 * Every class file export, sorted by table. `modules` is the result of the eager
 * `import.meta.glob` in `./column-classes.ts`: a path for each file, mapped to its
 * exports. Anything exported that is not a `defineColumnClasses` result is ignored.
 */
export function collectColumnClasses(
  modules: Record<string, Record<string, unknown>>
): TableClasses[] {
  return Object.values(modules)
    .flatMap((exports) => Object.values(exports).filter(isTableClasses))
    .toSorted((a, b) => a.table.localeCompare(b.table));
}

/**
 * What stops the class files from matching the schema, one line each, or `[]`. `schema`
 * lists every table with its SQL column names. A table or column on either side alone is a
 * problem, and so is a table classified twice.
 */
export function classificationProblems(
  schema: readonly { table: string; columns: readonly string[] }[],
  classes: readonly TableClasses[]
): string[] {
  const problems: string[] = [];
  const byTable = new Map<string, TableClasses>();
  for (const entry of classes) {
    if (byTable.has(entry.table)) {
      problems.push(`${entry.table}: classified in more than one file`);
    }
    byTable.set(entry.table, entry);
  }

  const tables = new Set(schema.map((entry) => entry.table));
  for (const { table, columns } of schema) {
    const classified = byTable.get(table);
    if (!classified) {
      problems.push(`${table}: table has no column classes`);
      continue;
    }
    for (const column of columns) {
      if (!Object.hasOwn(classified.columns, column)) {
        problems.push(`${table}.${column}: column has no class`);
      }
    }
    for (const column of Object.keys(classified.columns)) {
      if (!columns.includes(column)) {
        problems.push(`${table}.${column}: classified, but not in the schema`);
      }
    }
  }
  for (const table of byTable.keys()) {
    if (!tables.has(table)) {
      problems.push(`${table}: classified, but not in the schema`);
    }
  }
  return problems;
}

/** Every SQL column name classed `pii` in any table. Query output masks these by name. */
export function piiColumnNames(classes: readonly TableClasses[]): Set<string> {
  return new Set(
    classes.flatMap((entry) =>
      Object.entries(entry.columns)
        .filter(([, value]) => value === "pii")
        .map(([column]) => column)
    )
  );
}

/** Every `secret` column, as `table.column`, sorted. */
export function secretColumns(classes: readonly TableClasses[]): string[] {
  return classes
    .flatMap((entry) =>
      Object.entries(entry.columns)
        .filter(([, value]) => value === "secret")
        .map(([column]) => `${entry.table}.${column}`)
    )
    .toSorted();
}
