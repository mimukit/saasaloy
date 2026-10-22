import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { Sheet, SheetPopup, SheetTitle } from "@repo/ui/components/admin/sheet";
import { cn } from "@repo/ui/lib/utils";

// What a route renders inside the shell's content panel: a column for the page itself,
// and — when the route has a row selected — a detail panel beside it.
//
// The detail node is a prop rather than a component this layout builds, because the
// selection belongs to the route. The route knows which row is open, what its fields are,
// and what closing the panel means; this file knows only where the node goes.
//
// Where it goes depends on the width. At `md` and up it docks as a column at the right of
// the content panel, behind a hairline. Below `md` there is no room for a second column,
// so the SAME node renders in a bottom sheet over the list. One node, two placements, so
// the two can never drift apart.
//
// `detail` doubles as the open state: a route that clears its selection passes
// `undefined`, and both the side panel and the sheet close. There is no second boolean
// to keep in step.

/** Tailwind's `md`. The one place the breakpoint is written as a number. */
const MD_QUERY = "(min-width: 48rem)";

function subscribeToWidth(onChange: () => void): () => void {
  const list = window.matchMedia(MD_QUERY);
  list.addEventListener("change", onChange);

  return () => {
    list.removeEventListener("change", onChange);
  };
}

/**
 * Whether the viewport is at `md` or wider.
 *
 * A CSS-only answer would not do here. `md:hidden` on the sheet still mounts it, and a
 * mounted sheet traps focus and paints a backdrop even while it is invisible, so the
 * detail panel would be modal at desktop. Reading the breakpoint in JavaScript lets one
 * of the two placements render and the other not exist at all.
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(MD_QUERY).matches,
    // The server snapshot. The admin app is a client-rendered SPA, so this is only the
    // value React uses if it ever hydrates; desktop is the layout the shell assumes.
    () => true
  );
}

export function PageLayout({
  children,
  detail,
  detailLabel,
  onDetailClose,
  className,
}: {
  children: ReactNode;
  /** The detail panel, or `undefined` when nothing is selected. */
  detail?: ReactNode;
  /** The sheet's accessible name below `md`, e.g. the selected user's name. */
  detailLabel?: string;
  /** Called when the sheet is dismissed below `md`. The route clears its selection. */
  onDetailClose?: () => void;
  className?: string;
}) {
  const isDesktop = useIsDesktop();
  const open = detail !== undefined && detail !== null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        onDetailClose?.();
      }
    },
    [onDetailClose]
  );

  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

      {isDesktop && open ? (
        <aside className="border-border flex w-80 shrink-0 border-l lg:w-96">
          {detail}
        </aside>
      ) : null}

      {isDesktop ? null : (
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetPopup
            side="bottom"
            variant="inset"
            showCloseButton={false}
            // The detail node brings its own header and close control, so the sheet only
            // positions it, rounds it and supplies the backdrop.
            className="max-h-[85dvh] overflow-hidden"
          >
            <SheetTitle className="sr-only">
              {detailLabel ?? "Details"}
            </SheetTitle>
            {detail}
          </SheetPopup>
        </Sheet>
      )}
    </div>
  );
}
