import { cn } from "@repo/ui/lib/utils";

// The chip row under a page header: the set of views a screen can be narrowed to, each
// with its count. The pressed chip takes the hover tone and a hairline.
//
// Every chip is a real `button`, not a styled `div`, so it is reachable by keyboard and
// announced as pressable. The selected one carries `aria-pressed`, and the styling keys
// off that attribute rather than off a second class, so the look and the announcement can
// never disagree.
//
// Filtering itself happens in the route. This component reports which chip was pressed
// and nothing else — it holds no selection state, runs no query, and knows nothing about
// what the rows are.

export interface FilterChip {
  /** Stable across renders; it is both the React key and what `onSelect` reports. */
  id: string;
  label: string;
  /** An optional matching-row count shown after the label. Zero renders. */
  count?: number;
}

export function FilterChips({
  chips,
  selectedId,
  onSelect,
  label,
  className,
}: {
  chips: readonly FilterChip[];
  /** The pressed chip's id, or `null` when none is. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The accessible name of the group, e.g. "Filter users by role". */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-pressed={chip.id === selectedId}
          onClick={() => {
            onSelect(chip.id);
          }}
          className={cn(
            "text-muted-foreground focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
            "hover:bg-accent hover:text-foreground",
            "aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:border-border"
          )}
        >
          {chip.label}
          {chip.count === undefined ? null : (
            <span className="text-muted-foreground tabular-nums">
              {chip.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
