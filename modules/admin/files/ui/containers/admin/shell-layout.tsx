import { useEffect } from "react";
import type { ReactNode } from "react";

import { ThemeToggle } from "@repo/ui/blocks/admin/theme-toggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui/components/admin/sidebar";
import { ShellSidebar } from "@repo/ui/containers/admin/shell-sidebar";
import type {
  ShellAccount,
  ShellLink,
  ShellNavArea,
  ShellSignOut,
} from "@repo/ui/containers/admin/shell-nav";
import { relabelThemeToggles } from "@repo/ui/lib/theme";

// The shell every admin screen renders inside: an inset sidebar on the canvas, and a
// content panel beside it with a sticky header. The header carries the sidebar toggle,
// the page path and the theme control; the page itself scrolls under it.
//
// This file composes and holds no navigation data and no router. The admin app's
// AppShell reads the current path and the session, and passes them in with the nav
// data and its link component.

/** The label of the nav item that owns `path`, or `undefined` when none does. */
function pageLabelFor(
  areas: readonly ShellNavArea[],
  path: string
): string | undefined {
  const items = areas.flatMap((area) =>
    area.groups.flatMap((group) => group.items)
  );

  // The longest matching prefix wins, because "/" prefixes every path.
  return items
    .filter((item) =>
      item.to === "/" ? path === "/" : path.startsWith(item.to)
    )
    .toSorted((left, right) => right.to.length - left.to.length)[0]?.label;
}

export function ShellLayout({
  areas,
  area,
  currentPath,
  link,
  account,
  signOut,
  organizationPicker,
  children,
}: {
  areas: readonly ShellNavArea[];
  /** The area the current path belongs to. It is the first step of the page path. */
  area: ShellNavArea;
  currentPath: string;
  link: ShellLink;
  account: ShellAccount;
  signOut: ShellSignOut;
  /** The #141 organization picker, rendered at the top of the sidebar. */
  organizationPicker?: ReactNode;
  children: ReactNode;
}) {
  // The theme is applied in the admin app's src/main.tsx, before React mounts anything,
  // so `setTheme`'s own relabel pass finds no toggle to rename. Name it once here, after
  // the button exists.
  useEffect(() => {
    relabelThemeToggles();
  }, []);

  const pageLabel = pageLabelFor(areas, currentPath);

  return (
    <SidebarProvider className="bg-background h-dvh min-h-0 overflow-hidden">
      <ShellSidebar
        areas={areas}
        link={link}
        account={account}
        signOut={signOut}
        organizationPicker={organizationPicker}
      />

      <SidebarInset className="bg-card text-card-foreground border-border min-h-0 overflow-hidden border shadow-none md:peer-data-[variant=inset]:rounded-lg md:peer-data-[variant=inset]:shadow-none">
        <header className="border-border flex h-13 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="size-8" />
          <nav aria-label="Page path" className="min-w-0 flex-1">
            <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
              <li className="shrink-0">{area.label}</li>
              {pageLabel === undefined || pageLabel === area.label ? null : (
                <>
                  <li aria-hidden="true">/</li>
                  <li
                    aria-current="page"
                    className="text-foreground truncate font-medium"
                  >
                    {pageLabel}
                  </li>
                </>
              )}
            </ol>
          </nav>
          {/* Inert chrome on its own: the delegated [data-theme-toggle] handler in the
              admin app's src/main.tsx is what flips light and dark. */}
          <ThemeToggle />
        </header>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
