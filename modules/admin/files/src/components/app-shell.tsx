import { Link } from "@tanstack/react-router";
import { LayoutDashboardIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";

import type { AdminSession } from "@admin/lib/auth";
import { SignOutButton } from "@admin/components/sign-out-button";

// The sidebar every admin screen renders inside. Dropping src/routes/<feature>.tsx is
// enough to make a screen reachable — the router plugin wires it up with no patch. Adding
// it to NAV_ITEMS below is the separate, optional step that puts it in the sidebar.
//
// The `to` values are checked against the generated route tree, so a nav entry pointing at
// a route that does not exist fails `pnpm typecheck` instead of 404-ing at runtime. That is
// the reason this list is written out rather than derived from the router at runtime.
const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
] as const;

export function AppShell({
  session,
  children,
}: {
  session: AdminSession;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center px-4 text-sm font-semibold tracking-tight">
          Admin
        </div>
        <Separator className="bg-sidebar-border" />

        <nav
          aria-label="Admin sections"
          className="flex flex-1 flex-col gap-0.5 p-2"
        >
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              // TanStack Router sets aria-current on the active link, which is both the
              // accessible signal and the hook the active styling keys off — no second
              // source of truth for "which screen am I on".
              activeOptions={{ exact: to === "/" }}
              className={cn(
                "text-muted-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:font-medium"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        {/* The user menu, kept as a plain block rather than a popover: @repo/ui ships no
            dropdown yet, and a backoffice sidebar has room to show the account outright. */}
        <div className="border-sidebar-border border-t p-2">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">
              {session.user.name || session.user.email}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {session.user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
