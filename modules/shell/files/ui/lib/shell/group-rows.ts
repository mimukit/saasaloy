// The row groups DataTable draws when a page passes `groupBy`, for example a list of
// orders grouped by store. Pure, so the order is unit-tested without React.

/** One group: its key and its rows, in the order the table displays them. */
export interface RowGroup<TRow> {
  key: string;
  rows: TRow[];
}

/**
 * The rows split by `key`, with each group placed where its first row falls in `rows`.
 * The rows keep their order inside a group, so a sort the table applies to `rows` holds
 * in every group, and a group's position follows its top row.
 */
export function groupRows<TRow>(
  rows: readonly TRow[],
  key: (row: TRow) => string
): RowGroup<TRow>[] {
  const groups = new Map<string, TRow[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, [row]);
    } else {
      group.push(row);
    }
  }
  return [...groups].map(([id, members]) => ({ key: id, rows: members }));
}
