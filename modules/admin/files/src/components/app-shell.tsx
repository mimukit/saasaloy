import { useRouterState } from "@tanstack/react-router";
import {
  GaugeIcon,
  LayoutDashboardIcon,
  PanelLeftIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@repo/ui/components/sheet";

import type { AdminSession } from "@admin/lib/auth";
import { NavPanel } from "@admin/components/nav-panel";
import { Rail } from "@admin/components/rail";

// The shell every admin screen renders inside: an icon rail, a nav panel, and a content
// panel, floating as separate rounded panels on the canvas with an 8px gutter between
// them and to the viewport edge.
//
// Dropping src/routes/<feature>.tsx is enough to make a screen reachable — the router
// plugin wires it up with no patch. Adding it to NAV_AREAS below is the separate,
// optional step that puts it in the nav panel.
//
// The `to` values are checked against the generated route tree, so a nav entry pointing
// at a route that does not exist fails `pnpm typecheck` instead of 404-ing at runtime.
// That is the reason this list is written out rather than derived from the router at
// runtime, and the reason it is `as const`: widening `to` to `string` would take the
// check away.
//
// Shape, one area per top-level destination in the rail:
//
//   { label, to, icon, count?, groups: [{ label, items: [{ to, label, icon, count? }] }] }
//
// The seed ships one area, "Admin", with one group. A second area gets its own rail
// icon and its own nav panel; nothing else in this file has to change.
export const NAV_AREAS = [
  {
    label: "Admin",
    to: "/",
    icon: LayoutDashboardIcon,
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview", icon: GaugeIcon },
          { to: "/users", label: "Users", icon: UsersIcon },
        ],
      },
    ],
  },
] as const;

export type NavAreas = typeof NAV_AREAS;
export type NavArea = NavAreas[number];
export type NavGroup = NavArea["groups"][number];
export type NavItem = NavGroup["items"][number];

/**
 * The optional count on an area or a nav row.
 *
 * Read it through this helper rather than `entry.count`. NAV_AREAS is `as const`, which
 * is what keeps every `to` a literal the router can check — and it also means an entry
 * that omits `count` has no such key on its type at all. A parameter with an optional
 * `count` accepts both shapes and still rejects a wrong one.
 *
 * `label` is in the signature to carry that check, not because the count needs it. A
 * parameter whose every property is optional is a "weak type", and TypeScript rejects an
 * argument sharing no property with it — which is exactly the countless entry this helper
 * exists for. One required property both shapes already have settles it.
 */
export function navCount(entry: {
  readonly label: string;
  readonly count?: number;
}): number | undefined {
  return entry.count;
}

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

  // The area the current path belongs to: the one whose `to` is the longest prefix of
  // the path. With a single seeded area that always resolves to it, and adding a second
  // area needs no change here.
  const area =
    NAV_AREAS.filter((candidate) => pathname.startsWith(candidate.to)).toSorted(
      (a, b) => b.to.length - a.to.length
    )[0] ?? NAV_AREAS[0];

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
