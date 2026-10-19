import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// The frame every admin page renders inside. The admin app's root route renders it once,
// around its <Outlet />, so a module page gets it with no import of its own.
//
// It owns the page's surroundings, and a page owns none of them:
//
//   - the gutter. `--page-gutter` is the padding every page uses, read by PageHeader,
//     PageBody and the table's first and last columns. Change it here and all seven
//     pages move together, with no module file in the diff.
//   - the height. The frame fills the shell's content panel, so a page can pin its header
//     and scroll its body, or hand the whole height to PageLayout's list and detail.
//   - where errors and loading land. The router wraps every route in its own error
//     boundary, which catches a render failure as well as a loader's throw, and the
//     admin app sets `defaultErrorComponent` and `defaultPendingComponent` in
//     src/main.tsx. Both replace the <Outlet /> this frame wraps, so the error screen and
//     the skeleton appear inside the frame, with the shell still around them.

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-frame"
      className={cn(
        "flex h-full min-h-0 flex-col [--page-gutter:--spacing(4)] md:[--page-gutter:--spacing(6)]",
        className
      )}
    >
      {children}
    </div>
  );
}
