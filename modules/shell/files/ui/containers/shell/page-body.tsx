import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The scrolling body under a PageHeader. It pads itself with the frame's `--page-gutter`,
// so a page never writes its own padding and a change to the gutter in page-frame.tsx
// reaches every page.
//
// A list page that hands its whole height to a DataTable does not need it: the table
// scrolls itself. Everything else (an overview, a form, an editor) goes in here.

export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-(--page-gutter)",
        className
      )}
    >
      {children}
    </div>
  );
}
