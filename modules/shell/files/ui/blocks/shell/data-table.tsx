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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/shell/table";
import { useCommands } from "@repo/ui/lib/shell/commands";
import type { Command } from "@repo/ui/lib/shell/commands";
import { useMediaQuery } from "@repo/ui/lib/shell/use-media-query";
import { cn } from "@repo/ui/lib/utils";

import { EMPTY, isEmptyValue } from "@repo/ui/blocks/shell/attribute-list";
// Relative, not `@repo/ui/blocks/...`: the package maps `./blocks/*` to `.tsx` files only,
// and this rule is a `.ts` file so `node --test` can load it without JSX.
import { cardSlots } from "./data-table-cards";
import type { CardSlot } from "./data-table-cards";
import { stepHighlight } from "./data-table-highlight";

// The dense list the reference renders in the content panel: a muted header row, rows
// about 48px tall, an em dash wherever a cell has nothing, and one column at a time
// carrying the active sort in orange.
//
// This is the ONLY file in a signed-in app or @repo/ui that imports @tanstack/react-table,
// and that is the point. A caller describes its screen with `columns` and `rows` — plain
// data and plain callbacks — and never sees a ColumnDef, a row model, or a sorting state.
// Swapping the library out is then an edit to this file rather than to every route.
//
// The library earns its place on sorting alone: comparators for strings, numbers and
// dates, a stable order for equal keys, and one place that owns which column is active.
// Everything else here is markup.
//
// Below `md` the same rows render as a list of cards instead of a table, because six
// columns do not fit 360px without a sideways scroll. The columns decide the card through
// their `card` hint, so a page describes one layout and gets both. The breakpoint is read
// in JavaScript, not CSS, so the table and the card list never mount together: two
// mounted copies would put every row's button in the Tab order twice.
//
// While it is mounted, the table declares four keys in the `data-table` command scope:
// J and K move a highlight down and up the rows, Enter opens the highlighted row (the
// same call a click makes), and Escape drops the highlight. They are commands, so they
// bind only when a command provider is mounted; without one, the table renders exactly
// as it did before and the highlight never appears. The highlight takes the rows' hover
// tone, so it never reads as the selection.

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
  /**
   * Where the column goes in the card list below `md`. `title` heads the card, `trailing`
   * sits at the right of the title row (an amount, a status), `line` is a label and value
   * line under it, and `hidden` leaves the column out of the card. With no column hinted
   * `title`, the first column is the title; every other unhinted column is a line.
   */
  card?: CardSlot;
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
  const isDesktop = useMediaQuery("md");

  // The ids in displayed order, so J and K follow the active sort.
  const displayedIds = modelRows.map((modelRow) => modelRow.id);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // A filter or a refetch can take the highlighted row away; treat it as no highlight.
  const highlight =
    highlightedId !== null && displayedIds.includes(highlightedId)
      ? highlightedId
      : null;
  const highlightedRow =
    highlight === null
      ? undefined
      : modelRows.find((modelRow) => modelRow.id === highlight)?.original;

  const commands: readonly Command[] = [
    {
      id: "shell.table-next-row",
      title: "Next row",
      group: "page",
      shortcut: "J",
      when: () => displayedIds.length > 0,
      run: () => {
        setHighlightedId(
          stepHighlight(displayedIds, highlight, selectedId ?? null, 1)
        );
      },
    },
    {
      id: "shell.table-previous-row",
      title: "Previous row",
      group: "page",
      shortcut: "K",
      when: () => displayedIds.length > 0,
      run: () => {
        setHighlightedId(
          stepHighlight(displayedIds, highlight, selectedId ?? null, -1)
        );
      },
    },
    {
      id: "shell.table-open-row",
      title: "Open highlighted row",
      group: "page",
      shortcut: "Enter",
      when: () => onRowClick !== undefined && highlightedRow !== undefined,
      run: () => {
        if (onRowClick !== undefined && highlightedRow !== undefined) {
          onRowClick(highlightedRow);
        }
      },
    },
    {
      id: "shell.table-clear-highlight",
      title: "Clear row highlight",
      group: "page",
      shortcut: "Escape",
      when: () => highlight !== null,
      run: () => {
        setHighlightedId(null);
      },
    },
  ];
  useCommands(commands, { scope: "data-table" });

  // Keep the highlighted row in view as J and K walk past the scrolled edge.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight === null) {
      return;
    }
    containerRef.current
      ?.querySelector("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!isDesktop) {
    return (
      <DataTableCards
        columns={columns}
        // The sorted row model, so the cards keep whatever order the table's sort state
        // gives. The card list shows no sort control of its own.
        rows={modelRows.map((modelRow) => modelRow.original)}
        rowId={rowId}
        onRowClick={onRowClick}
        selectedId={selectedId}
        highlightedId={highlight}
        emptyState={emptyState}
        caption={caption}
        className={className}
        containerRef={containerRef}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        "[&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:flex-1 [&>[data-slot=table-container]]:overflow-auto",
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
                    "text-muted-foreground h-9 px-3 text-xs font-medium first:ps-(--page-gutter) last:pe-(--page-gutter)",
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
                className="text-muted-foreground px-3 text-center whitespace-normal"
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
                  // The J/K highlight, in the rows' hover tone.
                  data-highlighted={highlight === id ? "" : undefined}
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
                    onRowClick === undefined ? undefined : "cursor-pointer",
                    highlight === id && "bg-accent/50"
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
                          "h-11 px-3 text-sm first:ps-(--page-gutter) last:pe-(--page-gutter)",
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
 * The rows as cards, for widths below `md`. Each card is the title row (title columns,
 * then trailing columns at the right) over a list of label and value lines. A card with
 * `onRowClick` is one button, the whole card, which is the keyboard path the table's
 * first-cell button gives at desktop.
 */
function DataTableCards<TRow extends object>({
  columns,
  rows,
  rowId,
  onRowClick,
  selectedId,
  highlightedId,
  emptyState,
  caption,
  className,
  containerRef,
}: {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  rowId: (row: TRow) => string;
  onRowClick?: (row: TRow) => void;
  selectedId?: string | null;
  /** The J/K highlight, or `null` when there is none. */
  highlightedId: string | null;
  emptyState?: ReactNode;
  caption: string;
  className?: string;
  containerRef: Ref<HTMLDivElement>;
}) {
  const captionId = useId();
  const slots = useMemo(() => cardSlots(columns), [columns]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto",
        className
      )}
    >
      {/* The table's caption, kept for assistive tech. It names the list below. */}
      <p id={captionId} className="sr-only">
        {caption}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-(--page-gutter) py-3 text-center text-sm">
          {emptyState ?? "Nothing to show."}
        </p>
      ) : (
        <ul aria-labelledby={captionId} className="flex flex-col">
          {rows.map((row) => {
            const id = rowId(row);
            const selected = selectedId === id;
            const highlighted = highlightedId === id;

            const body = (
              <>
                <span className="flex min-w-0 items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {slots.title.map((column) => (
                      <span key={column.id}>{cellBody(column, row)}</span>
                    ))}
                  </span>
                  {slots.trailing.map((column) => (
                    <span key={column.id} className="shrink-0 text-sm">
                      {cellBody(column, row)}
                    </span>
                  ))}
                </span>

                {slots.lines.length === 0 ? null : (
                  <dl className="text-muted-foreground mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                    {slots.lines.map((column) => (
                      <div key={column.id} className="contents">
                        <dt>{column.header}</dt>
                        <dd className="text-foreground min-w-0 truncate">
                          {cellBody(column, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            );

            return (
              <li
                key={id}
                data-highlighted={highlighted ? "" : undefined}
                // The same accent fill the table's selected row takes, and its hover
                // tone for the J/K highlight.
                className={cn(
                  "border-border border-b",
                  selected ? "bg-accent" : highlighted && "bg-accent/50"
                )}
              >
                {onRowClick === undefined ? (
                  <div className="block px-(--page-gutter) py-3">{body}</div>
                ) : (
                  <button
                    type="button"
                    aria-current={selected ? true : undefined}
                    onClick={() => {
                      onRowClick(row);
                    }}
                    // The table row button's focus ring, so focus looks the same at
                    // every width.
                    className="hover:bg-accent/50 focus-visible:ring-ring/50 block w-full px-(--page-gutter) py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none focus-visible:ring-inset"
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A column's content for one row, or the em dash when it has none. */
function cellBody<TRow>(column: DataTableColumn<TRow>, row: TRow): ReactNode {
  const content =
    column.cell === undefined
      ? renderValue(column.value(row))
      : column.cell(row);

  return isEmptyValue(content) ? (
    <span className="text-muted-foreground">{EMPTY}</span>
  ) : (
    content
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
