import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { cn } from "@repo/ui/lib/utils";

import { EMPTY, isEmptyValue } from "@admin/components/attribute-list";

// The dense list the reference renders in the content panel: a muted header row, rows
// about 48px tall, an em dash wherever a cell has nothing, and one column at a time
// carrying the active sort in orange.
//
// This is the ONLY file in the app that imports @tanstack/react-table, and that is the
// point. A caller describes its screen with `columns` and `rows` — plain data and plain
// callbacks — and never sees a ColumnDef, a row model, or a sorting state. Swapping the
// library out is then an edit to this file rather than to every route.
//
// The library earns its place on sorting alone: comparators for strings, numbers and
// dates, a stable order for equal keys, and one place that owns which column is active.
// Everything else here is markup.

/**
 * What a column reads out of a row: the sort key, and the cell content when the column
 * declares no `cell` renderer. Anything richer is the renderer's business.
 */
export type CellValue = string | number | boolean | Date | null | undefined;

export interface DataTableColumn<TRow> {
  /** Stable across renders; it is the React key and the sorting state's column id. */
  id: string;
  header: ReactNode;
  /**
   * The row's value for this column. It is both what sorting compares and what the cell
   * shows when `cell` is absent, so the two can never fall out of step.
   */
  value: (row: TRow) => CellValue;
  /**
   * Optional rendering — a StatusPill, an avatar and a name, a link. Return `null`,
   * `undefined` or `""` and the cell falls back to the em dash, exactly as an empty
   * `value` does.
   */
  cell?: (row: TRow) => ReactNode;
  /** When true the header becomes a button that cycles this column's sort. */
  sortable?: boolean;
  /** `end` right-aligns the column, for counts and dates. Defaults to `start`. */
  align?: "start" | "end";
}

// Registered once, at module scope. v9 has no global feature set: a table only has
// sorting state and sorting methods because `rowSortingFeature` and a sorted row model
// are named here, which is also what keeps the unused features out of the bundle.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

export function DataTable<TRow extends object>({
  columns,
  rows,
  rowId,
  onRowClick,
  selectedId,
  emptyState,
  caption,
  className,
}: {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  /**
   * The row's identity. It keys the rows, matches `selectedId`, and is what `onRowClick`
   * is expected to store — an index would break the moment a sort reorders the table.
   */
  rowId: (row: TRow) => string;
  /** Called with the clicked row. Omit it and rows are inert, not merely unstyled. */
  onRowClick?: (row: TRow) => void;
  /** The `rowId` of the highlighted row, or `null` when none is. */
  selectedId?: string | null;
  /** Rendered in place of the rows when `rows` is empty. The header row stays. */
  emptyState?: ReactNode;
  /** An accessible description of the table, rendered visually hidden. */
  caption: string;
  className?: string;
}) {
  // react-table wants one column def per column and a stable array; ours carries only the
  // id, the accessor and whether the header may sort. Everything visual stays out of it,
  // because the header and the cells below are rendered from `columns` directly.
  const columnDefs = useMemo(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row: TRow) => column.value(row),
        enableSorting: column.sortable === true,
      })),
    [columns]
  );

  // `rows` is readonly to callers — a route hands over a filtered array it should not
  // have to defend — while the library's option type is mutable. One copy at the
  // boundary, memoized so it does not invalidate the row model every render.
  const data = useMemo(() => [...rows], [rows]);

  const table = useTable({
    features,
    columns: columnDefs,
    data,
    getRowId: rowId,
    // Two states, not three. A header that cycles asc → desc → unsorted leaves the table
    // in an order nobody asked for, and the reference's sort indicator has no "off" look.
    enableSortingRemoval: false,
  });

  const modelRows = table.getRowModel().rows;

  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        "[&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto",
        className
      )}
    >
      <Table>
        <caption className="sr-only">{caption}</caption>

        {/* Sticky against the container above, which is the element that scrolls. The
            opaque panel fill is not optional: a transparent header would let the rows
            slide under it. */}
        <TableHeader className="bg-card sticky top-0 z-10">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const modelColumn = table.getColumn(column.id);
              const sorted = modelColumn?.getIsSorted() ?? false;

              return (
                <TableHead
                  key={column.id}
                  aria-sort={
                    sorted === false
                      ? undefined
                      : sorted === "asc"
                        ? "ascending"
                        : "descending"
                  }
                  className={cn(
                    "text-muted-foreground h-9 px-3 text-xs font-medium",
                    column.align === "end" && "text-right"
                  )}
                >
                  {column.sortable === true && modelColumn !== undefined ? (
                    <button
                      type="button"
                      onClick={modelColumn.getToggleSortingHandler()}
                      className={cn(
                        "hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                        // The one place orange appears in a table. It marks which column
                        // the order is coming from, and nothing else on the page competes
                        // for that meaning.
                        sorted !== false && "text-accent-sort"
                      )}
                    >
                      {column.header}
                      {sorted === "asc" ? (
                        <ArrowUpIcon className="size-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDownIcon className="size-3" />
                      ) : (
                        <ChevronsUpDownIcon className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {modelRows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="text-muted-foreground h-24 px-3 text-center whitespace-normal"
              >
                {emptyState ?? "Nothing to show."}
              </TableCell>
            </TableRow>
          ) : (
            modelRows.map((modelRow) => {
              const row = modelRow.original;
              const id = rowId(row);

              return (
                <TableRow
                  key={id}
                  // The vendored TableRow already styles this attribute, so the selected
                  // look comes from the same place every other table's does.
                  data-state={selectedId === id ? "selected" : undefined}
                  // Pointer convenience only, and deliberately WITHOUT role or tabIndex.
                  // `role="button"` on a <tr> takes the row out of the table's
                  // accessibility tree: a screen reader in table mode stops seeing the row,
                  // its cells, and their header associations. The keyboard path is the
                  // button in the first cell below.
                  onClick={
                    onRowClick === undefined
                      ? undefined
                      : () => {
                          onRowClick(row);
                        }
                  }
                  className={cn(
                    "border-border",
                    onRowClick === undefined ? undefined : "cursor-pointer"
                  )}
                >
                  {columns.map((column, index) => {
                    const content =
                      column.cell === undefined
                        ? renderValue(column.value(row))
                        : column.cell(row);

                    const body = isEmptyValue(content) ? (
                      <span className="text-muted-foreground">{EMPTY}</span>
                    ) : (
                      content
                    );

                    return (
                      <TableCell
                        key={column.id}
                        className={cn(
                          "h-12 px-3 text-sm",
                          column.align === "end" && "text-right"
                        )}
                      >
                        {onRowClick === undefined || index !== 0 ? (
                          body
                        ) : (
                          // One real control per row, in the first cell, so the row is
                          // reachable by Tab and answers Enter and Space for free. It
                          // stops the click from reaching the row's own handler, which
                          // would otherwise fire `onRowClick` twice for one press.
                          <button
                            type="button"
                            aria-current={selectedId === id ? true : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRowClick(row);
                            }}
                            className="focus-visible:ring-ring/50 -mx-1 flex min-w-0 items-center rounded px-1 text-left focus-visible:ring-[3px] focus-visible:outline-none"
                          >
                            {body}
                          </button>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A column with no `cell` renderer shows its raw value. A Date is not renderable by
 * React and a boolean silently renders as nothing, so both are turned into text here
 * rather than left to surprise a caller who omitted the renderer.
 */
function renderValue(value: CellValue): ReactNode {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value;
}
