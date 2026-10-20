import type { InferInsertModel, Table } from "drizzle-orm";

// A seed slice: the example rows for one table, in one file under `src/seed/slices/`.
//
//   export const users = defineSlice(usersTable, {
//     rows: {
//       superadmin: { email: "superadmin@example.test", name: "Ada", role: "superadmin" },
//       member: { email: "member@example.test", name: "Grace", role: "user" },
//     },
//   });
//
// Each row is keyed by a slug. The slug names the row for the rest of the seed: the engine
// derives a text primary key from it (`seedId("users", "superadmin")`), and a slice that
// points at this row writes the same call. Adding a table means adding one slice file;
// nothing else lists it, because `./index.ts` globs the folder.
//
// `pnpm db:seed` upserts every row on its conflict key, so a rerun puts each seed row back
// to the values written here and leaves every row a person made by hand alone. See the
// `saasaloy-database` skill, "Seed data".

/**
 * One row of a slice: the table's insert type, with `id` optional when the table has one.
 * The engine fills a missing text `id` from the slug.
 */
export type SeedRow<TTable extends Table> =
  InferInsertModel<TTable> extends infer Insert
    ? "id" extends keyof Insert
      ? Omit<Insert, "id"> & { id?: Insert["id"] }
      : Insert
    : never;

/** A column's property key on the table, as a slice names it. */
export type SeedColumn<TTable extends Table> = keyof InferInsertModel<TTable> &
  string;

export interface SliceOptions<TTable extends Table> {
  /** The rows, keyed by slug. An empty object is a slice that seeds nothing on purpose. */
  rows: Record<string, SeedRow<TTable>>;
  /**
   * The conflict columns, by property key. Leave it out and the table's primary key is
   * the conflict key. A table whose primary key the database generates (an identity or an
   * autoincrement column) must name a unique key here instead, such as `["email"]`.
   */
  key?: readonly SeedColumn<TTable>[];
  /**
   * SQL names of tables this slice must be written after, for an order no foreign key
   * shows. Foreign keys already order the slices; this adds edges, it removes none.
   */
  after?: readonly string[];
  /** A line `pnpm db:seed` prints after the counts, such as a documented dev password. */
  message?: string;
}

const SLICE = Symbol.for("saasaloy.seed.slice");

export interface Slice<
  TTable extends Table = Table,
> extends SliceOptions<TTable> {
  readonly [SLICE]: true;
  readonly table: TTable;
}

/** Declare the seed rows for `table`. Export the result from a file in `src/seed/slices/`. */
export function defineSlice<TTable extends Table>(
  table: TTable,
  options: SliceOptions<TTable>
): Slice<TTable> {
  return { ...options, table, [SLICE]: true };
}

export function isSlice(value: unknown): value is Slice {
  return typeof value === "object" && value !== null && SLICE in value;
}

/**
 * Every slice exported by the slice files, in file order. `modules` is the result of the
 * eager `import.meta.glob` in `./index.ts`: a path for each file, mapped to its exports.
 * Anything exported that is not a slice is ignored.
 */
export function collectSlices(
  modules: Record<string, Record<string, unknown>>
): Slice[] {
  return Object.keys(modules)
    .toSorted()
    .flatMap((path) => Object.values(modules[path] ?? {}).filter(isSlice));
}
