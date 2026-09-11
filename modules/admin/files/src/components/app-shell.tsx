import { useRouterState } from "@tanstack/react-router";
import { PanelLeftIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@repo/ui/components/sheet";

import { NavPanel } from "@admin/components/nav-panel";
import { NAV_AREAS, areaFor } from "@admin/components/nav";
import { Rail } from "@admin/components/rail";
import type { AdminSession } from "@admin/lib/auth";

// The shell every admin screen renders inside: an icon rail, a nav panel, and a content
// panel, floating as separate rounded panels on the canvas with an 8px gutter between
// them and to the viewport edge.
//
// This file composes; it holds no navigation data. NAV_AREAS, its types, and the two
// rules that read it live in ./nav.ts, which is the one file to edit to add a screen.

export function AppShell({
  session,
  children,
}: {
  session: AdminSession;
  children: ReactNode;
}) {
  // Whether the nav panel is showing below `md`. Component state, never storage: the
  // plan settles that no nav state survives a load.
  const [navOpen, setNavOpen] = useState(false);

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  // With a single seeded area this always resolves to it, and adding a second area needs
  // no change here.
  const area = areaFor(pathname);

  return (
    <div className="bg-background flex h-dvh gap-2 overflow-hidden p-2">
      {/* The rail sits directly on the canvas with no panel chrome of its own. */}
      <Rail areas={NAV_AREAS} session={session} />

      <NavPanel area={area} className="hidden md:flex" />

      <main className="bg-card text-card-foreground border-border flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
        {/* Below `md` the nav panel is off screen and the rail stays, so the content
            header carries the way back to the nav. At `md` and up the panel is always
            there and this row is gone. */}
        <div className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Show navigation"
            aria-expanded={navOpen}
            onClick={() => {
              setNavOpen(true);
            }}
          >
            <PanelLeftIcon />
          </Button>
          <span className="truncate text-sm font-medium">{area.label}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>

      {/* The same NavPanel, in a sheet, for widths that have no room for a third panel.
          One component renders both, so the two can never drift. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-64! max-w-64! gap-0 border-none bg-transparent p-2 shadow-none"
        >
          <SheetTitle className="sr-only">{area.label} navigation</SheetTitle>
          <NavPanel
            area={area}
            className="h-full w-full"
            onNavigate={() => {
              setNavOpen(false);
            }}
            actions={
              <SheetClose
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    aria-label="Hide navigation"
                  />
                }
              >
                <XIcon />
              </SheetClose>
            }
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
