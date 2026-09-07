import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { cn } from "@repo/ui/lib/utils";

import { navCount } from "@admin/components/app-shell";
import type { NavArea } from "@admin/components/app-shell";

// The second panel of the shell: the active area's tree. A title row carrying the area
// name and an actions slot, then one collapsible group per NAV_AREAS group, each holding
// rows of icon, label, and a right-aligned count.
//
// Groups start open and their state is component state only — nothing about the nav is
// written to storage, so a reload always lands on the same shape.
//
// `actions` is a slot rather than a fixed pair of buttons. What belongs beside an area
// title is the area's own business (a "new" affordance, a filter), so the seed leaves it
// empty at desktop and AppShell fills it with the close control when this panel renders
// in the sheet below `md`.

export function NavPanel({
  area,
  actions,
  onNavigate,
  className,
}: {
  area: NavArea;
  actions?: ReactNode;
  /** Called after a row is clicked. AppShell uses it to close the sheet below `md`. */
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {area.label}
        </h2>
        {actions}
      </div>

      <nav
        aria-label={`${area.label} sections`}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pt-0"
      >
        {area.groups.map((group) => (
          <Collapsible key={group.label} defaultOpen className="flex flex-col">
            <CollapsibleTrigger
              className={cn(
                "group/nav-group text-sidebar-foreground flex min-h-11 items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition-colors md:min-h-0",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              {/* The chevron follows aria-expanded, which the trigger already sets —
                  the same hook accordion.tsx uses, so there is no second state to keep. */}
              <ChevronRightIcon className="size-4 shrink-0 group-aria-expanded/nav-group:hidden" />
              <ChevronDownIcon className="hidden size-4 shrink-0 group-aria-expanded/nav-group:block" />
            </CollapsibleTrigger>

            <CollapsibleContent className="flex flex-col gap-0.5 pt-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const count = navCount(item);

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    // TanStack Router sets aria-current on the active link, which is both
                    // the accessible signal and the hook the active styling keys off — no
                    // second source of truth for "which screen am I on".
                    activeOptions={{ exact: item.to === "/" }}
                    onClick={onNavigate}
                    className={cn(
                      "text-muted-foreground flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors md:min-h-0",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:font-medium"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {count === undefined ? null : (
                      <span className="shrink-0 text-xs tabular-nums">
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </nav>
    </div>
  );
}
