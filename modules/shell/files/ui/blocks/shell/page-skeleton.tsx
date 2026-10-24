import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { cn } from "@repo/ui/lib/utils";

// What a page shows while its loader runs: a header bar and a column of list rows, in the
// shape most shell pages settle into. The router's `defaultPendingComponent` renders it,
// so every route gets a loading state without writing one.
//
// The row widths repeat a short fixed pattern rather than a random one, so the render is
// pure and two loads of the same page look the same.

const ROW_WIDTHS = ["w-40", "w-28", "w-36", "w-24", "w-32", "w-28"] as const;

export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-(--page-gutter)">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-8" />
      </div>

      <div className="flex flex-col">
        {ROW_WIDTHS.map((width, index) => (
          <div
            // The list is a fixed placeholder that never reorders.
            // oxlint-disable-next-line react/no-array-index-key -- see above
            key={index}
            className="border-border flex h-12 items-center gap-3 border-b px-(--page-gutter)"
          >
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className={cn("h-3", width)} />
            <Skeleton className="ms-auto hidden h-3 w-40 sm:block" />
            <Skeleton className="hidden h-5 w-14 rounded-md md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
