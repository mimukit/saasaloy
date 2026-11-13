import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The scrolling body under a PageHeader. It pads itself with the frame's `--page-gutter`,
// so a page never writes its own padding and a change to the gutter in page-frame.tsx
// reaches every page.
//
// A list page that hands its whole height to a DataTable does not need it: the table
// scrolls itself. Everything else (an overview, a form, an editor) goes in here.
//
// `aside` is a side column for a form page: help, a summary, a preview. With it, the body
// turns into a grid at `lg`, the main column on the left and a 20rem column on the right
// that stays at the top while the main column scrolls. Below `lg` the aside stacks under
// the main column. Without it, the body renders the children as it always did.

export function PageBody({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  /** A side column for a form page: help, a summary, a preview. Two columns at `lg`. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-(--page-gutter)",
        aside !== undefined &&
          "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6",
        className
      )}
    >
      {aside === undefined ? (
        children
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
          <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
            {aside}
          </aside>
        </>
      )}
    </div>
  );
}
