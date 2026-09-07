import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The title bar at the top of a content panel — the reference's "Ahmed Reza" row, with
// its hairline separating the header from whatever scrolls beneath it.
//
// It is a `header` with the page's only `h1`. The shell above it renders no heading of
// its own, so this is the top of the document outline on every screen.
//
// `count` is a separate prop rather than something the caller folds into `title`,
// because the two are different things: the title names the screen and the count is a
// live number. Keeping them apart is what lets the number carry tabular figures and stay
// out of the accessible heading text.

export function PageHeader({
  title,
  count,
  description,
  actions,
  className,
}: {
  title: string;
  /** An optional total shown beside the title. Zero renders; `undefined` does not. */
  count?: number;
  description?: ReactNode;
  /** Buttons or controls pinned to the right of the row. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "border-border flex shrink-0 items-center gap-3 border-b px-4 py-3",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {count === undefined ? null : (
            <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
              {count}
            </span>
          )}
        </div>
        {description === undefined ? null : (
          <p className="text-muted-foreground truncate text-sm">
            {description}
          </p>
        )}
      </div>

      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </header>
  );
}
