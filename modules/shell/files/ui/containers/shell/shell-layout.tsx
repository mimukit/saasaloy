import { Fragment } from "react";
import type { ReactNode } from "react";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui/components/shell/sidebar";
import { ShellSidebar } from "@repo/ui/containers/shell/shell-sidebar";
import type {
  ShellAccount,
  ShellLink,
  ShellNavArea,
  ShellSignOut,
} from "@repo/ui/containers/shell/shell-nav";
import type { LiveCounts } from "@repo/ui/lib/shell/nav-counts";

// The shell every signed-in screen renders inside: an inset sidebar on the canvas, and a
// content panel beside it with a sticky header. The header carries the sidebar toggle
// and the page path; the page itself scrolls under it. The theme control is a row in the
// sidebar's account menu.
//
// This file composes and holds no navigation data and no router. Each app's
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
  counts,
  subtitle,
  trail,
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
  /** Live nav counts keyed by a row's `to`. The sidebar shows them over static counts. */
  counts?: LiveCounts;
  /** Passed to ShellSidebar: the line under the product name. `null` hides it. */
  subtitle?: string | null;
  /**
   * The page path after the area, step by step. A step with `to` renders
   * through `link`; the last step is the current page. Omit it and the path is the area
   * plus the nav label that owns the current path.
   */
  trail?: readonly { label: string; to?: string }[];
  children: ReactNode;
}) {
  const pageLabel = pageLabelFor(areas, currentPath);
  const Crumb = link;
  const steps =
    trail ??
    (pageLabel === undefined || pageLabel === area.label
      ? []
      : [{ label: pageLabel }]);

  return (
    <SidebarProvider className="bg-background h-dvh min-h-0 overflow-hidden">
      <ShellSidebar
        areas={areas}
        link={link}
        account={account}
        signOut={signOut}
        organizationPicker={organizationPicker}
        counts={counts}
        subtitle={subtitle}
      />

      <SidebarInset className="bg-card text-card-foreground border-border min-h-0 overflow-hidden border shadow-none md:peer-data-[variant=inset]:rounded-lg md:peer-data-[variant=inset]:shadow-none">
        <header className="border-border flex h-13 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="size-8" />
          <nav aria-label="Page path" className="min-w-0 flex-1">
            <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
              <li className="shrink-0">{area.label}</li>
              {steps.map((step, index) => {
                const last = index === steps.length - 1;
                return (
                  <Fragment key={`${index}:${step.label}`}>
                    <li aria-hidden="true">/</li>
                    {last ? (
                      <li
                        aria-current="page"
                        className="text-foreground truncate font-medium"
                      >
                        {step.label}
                      </li>
                    ) : (
                      <li className="shrink-0">
                        {step.to === undefined ? (
                          step.label
                        ) : (
                          <Crumb
                            to={step.to}
                            exact
                            className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                          >
                            {step.label}
                          </Crumb>
                        )}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
          </nav>
        </header>

        {/* A flex column, so the page frame inside takes its height from `flex-1`. A
            percentage height here would leave Safari without a height to resolve, and the
            whole panel, page header included, would scroll as one block. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
