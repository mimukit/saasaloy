import { Button } from "@repo/ui/components/shell/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@repo/ui/components/shell/sheet";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { StatusPill } from "@repo/ui/components/shell/status-pill";

import type { CmsRevision } from "@admin/lib/cms-api";
import { dateTime, revisionNumbers } from "@admin/lib/cms-format";

// The revisions drawer: a right-hand sheet, newest first, the live revision marked, and
// Restore on every row. Restore copies the snapshot into the working draft; the live post
// changes on the next publish, which the description says before anyone presses it.

export function RevisionsSheet({
  open,
  onOpenChange,
  revisions,
  loading,
  busyId,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revisions: readonly CmsRevision[] | undefined;
  loading: boolean;
  /** The revision a restore is running for, so its button can say so. */
  busyId: string | null;
  onRestore: (revision: CmsRevision, number: number) => void;
}) {
  const numbers = revisionNumbers(revisions?.length ?? 0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" variant="inset" className="sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Revisions</SheetTitle>
          <SheetDescription>
            Restore copies a revision into the draft. The live post changes on
            the next publish.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {loading ? (
            <div className="grid gap-3" aria-label="Loading revisions">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : revisions === undefined || revisions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No revisions yet. Each publish adds one.
            </p>
          ) : (
            <ol className="divide-border -mx-1 divide-y">
              {revisions.map((revision, index) => {
                const number = numbers[index] ?? 0;
                return (
                  <li
                    key={revision.id}
                    className="flex items-start gap-3 px-1 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          Revision {number}
                        </span>
                        {revision.live ? (
                          <StatusPill label="Live" tone="ok" />
                        ) : null}
                      </div>
                      <p className="truncate text-sm">{revision.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {dateTime(revision.createdAt)} ·{" "}
                        {revision.authorName ?? "No author"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Restore revision ${String(number)}`}
                      disabled={busyId !== null}
                      onClick={() => {
                        onRestore(revision, number);
                      }}
                    >
                      {busyId === revision.id ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-muted-foreground pt-2 text-xs">
            The newest 50 revisions are kept. The live revision is never pruned.
          </p>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
