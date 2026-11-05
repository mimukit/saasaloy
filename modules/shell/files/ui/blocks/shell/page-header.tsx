import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { UPDATED_TICK_MS, updatedLabel } from "@repo/ui/lib/shell/updated-at";
import type { UpdatedWords } from "@repo/ui/lib/shell/updated-at";
import { cn } from "@repo/ui/lib/utils";

// The title bar at the top of a page, with its hairline separating the header from
// whatever scrolls beneath it. It pads itself with the page frame's `--page-gutter`, so
// it lines up with PageBody and the table's first column on every page.
//
// It is a `header` with the page's only `h1`. The shell above it renders no heading of
// its own, so this is the top of the document outline on every screen.
//
// `count` is a separate prop rather than something the caller folds into `title`,
// because the two are different things: the title names the screen and the count is a
// live number. Keeping them apart is what lets the number carry tabular figures and stay
// out of the accessible heading text. A filtered count reads "3 of 6", and `countLabel`
// gives it other words. `badges` sits after the title for the same reason:
// a copy button and status pills are not part of the heading.
//
// The second line says the state of the page. `status` is a line the page builds, usually
// links to the queues that follow from it, and `updated` ends it with "Updated 12s ago" as
// a button that refetches. A page with neither keeps the older fixed `description`.

/** When the page's data last arrived, and how to fetch it again. */
export interface PageHeaderUpdated {
  /** `dataUpdatedAt` of the page's query, in ms. 0 shows nothing. */
  at: number;
  refreshing: boolean;
  onRefresh: () => void;
  words: UpdatedWords & { refreshing: string; refresh: string };
}

/** The current time, redrawn every `UPDATED_TICK_MS`. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, UPDATED_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

function Updated({ updated }: { updated: PageHeaderUpdated }) {
  const now = useNow();
  const { at, refreshing, onRefresh, words } = updated;
  if (at === 0) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      title={words.refresh}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 disabled:cursor-default"
    >
      {refreshing ? words.refreshing : updatedLabel(at, now, words)}
      <RefreshCwIcon
        aria-hidden="true"
        className={cn("size-3.5", refreshing && "animate-spin")}
      />
    </button>
  );
}

export function PageHeader({
  title,
  count,
  total,
  countLabel,
  badges,
  description,
  status,
  updated,
  actions,
  className,
}: {
  title: string;
  /** An optional total shown beside the title. Zero renders; `undefined` does not. */
  count?: number;
  /**
   * Every record with no filter. With `count` below it the header reads "3 of 6";
   * otherwise it reads `count` alone.
   */
  total?: number;
  /**
   * The words for a filtered count, used when `total` is set and `count` is below it. It
   * gets both numbers and returns the text, so a project writes "3 of 6 orders" or puts it
   * in its own language. Without it the header reads "3 of 6".
   */
  countLabel?: (count: number, total: number) => string;
  /** Controls and pills after the title, such as a copy button and a status pill. */
  badges?: ReactNode;
  description?: ReactNode;
  /** The page's state line. It replaces `description` when both are set. */
  status?: ReactNode;
  /** "Updated 12s ago" at the end of the state line, as a refresh button. */
  updated?: PageHeaderUpdated;
  /** Buttons or controls pinned to the right of the row. */
  actions?: ReactNode;
  className?: string;
}) {
  const line = status ?? description;
  return (
    <header
      className={cn(
        "border-border flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-(--page-gutter) py-2.5",
        className
      )}
    >
      {/* A 12rem basis, not 0: with a zero basis the actions keep their width on a phone
          and squeeze the title to nothing, so a page with header actions showed no h1 at
          375 px (issue #293). With a real basis the row wraps first, and the actions move
          under the title. */}
      <div className="flex min-w-0 grow basis-48 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
            {title}
          </h1>
          {count === undefined ? null : (
            <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
              {total !== undefined && count < total
                ? (countLabel?.(count, total) ??
                  `${String(count)} of ${String(total)}`)
                : count}
            </span>
          )}
          {badges === undefined ? null : (
            <div className="flex shrink-0 items-center gap-1.5">{badges}</div>
          )}
        </div>
        {line === undefined && updated === undefined ? null : (
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
            {line === undefined ? null : (
              // Wraps rather than truncates: the line is links, and a cut link is lost.
              <div className="min-w-0">{line}</div>
            )}
            {updated === undefined ? null : <Updated updated={updated} />}
          </div>
        )}
      </div>

      {/* `ml-auto` keeps the actions at the right edge when they wrap under the title.
          `max-w-full` and `flex-wrap` let a toolbar wider than a phone wrap onto more
          lines instead of running off the panel. Below `sm` the actions take the full
          row, so a toolbar can lay its controls out edge to edge. */}
      {actions === undefined ? null : (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full">
          {actions}
        </div>
      )}
    </header>
  );
}
