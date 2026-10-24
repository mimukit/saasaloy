import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The label/value rows the reference stacks inside a detail panel — "Assignee · Ahmed
// Reza", "Submission date · Aug 15, 2025". A description list, because that is what it
// is: `dt` carries the name of the thing and `dd` carries its value, so a screen reader
// reads the pair rather than two loose strings.
//
// The label column is a fixed 8.25rem (132px, the width the screenshots hold) and the
// value takes the rest. Below that width the grid falls back to one column per row, so a
// long label never squeezes its value to nothing inside the `md` sheet.

/** An empty value renders as an em dash. `EMPTY` is that dash, shared with DataTable. */
export const EMPTY = "—";

export interface Attribute {
  label: string;
  /**
   * The value. `null`, `undefined` and `""` all render as an em dash, so a caller never
   * writes the dash itself and two empty rows can never disagree about what empty looks
   * like. Anything else — a StatusPill, an Avatar, a link — renders as given.
   */
  value?: ReactNode;
}

/** True when a value should render as the em dash rather than as itself. */
export function isEmptyValue(value: ReactNode): boolean {
  return value === null || value === undefined || value === "";
}

export function AttributeList({
  items,
  className,
}: {
  items: readonly Attribute[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="grid min-h-8 items-center gap-x-2 py-1 text-sm sm:grid-cols-[8.25rem_minmax(0,1fr)]"
        >
          <dt className="text-muted-foreground truncate">{item.label}</dt>
          <dd className="text-foreground min-w-0 break-words">
            {isEmptyValue(item.value) ? (
              <span className="text-muted-foreground">{EMPTY}</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
