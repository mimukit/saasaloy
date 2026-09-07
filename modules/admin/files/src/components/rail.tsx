import { Link } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";

import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";
import { Avatar, AvatarFallback } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { navCount } from "@admin/components/app-shell";
import type { NavAreas } from "@admin/components/app-shell";
import { useSignOut } from "@admin/components/sign-out-button";
import type { AdminSession } from "@admin/lib/auth";

// The far-left strip of the shell: one icon per top-level area, then a footer holding the
// theme control and the account menu. It carries no panel background of its own — it sits
// directly on the canvas, which is what makes the nav and content panels read as floating.
//
// A label never shows here, so every area needs a Tooltip: the icon alone is not an
// accessible name, and the sr-only label below is what a screen reader announces.

/** Up to two initials for the avatar, falling back to `?` for an unnameable account. */
function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "?";
}

export function Rail({
  areas,
  session,
}: {
  areas: NavAreas;
  session: AdminSession;
}) {
  // The same order of operations the sign-out button uses, from the same hook: the
  // server clears the cookie, the cached session is dropped, and only then does the
  // router re-run the root guard.
  const { pending, error, signOut } = useSignOut();

  const name = session.user.name || session.user.email;

  return (
    <TooltipProvider>
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 py-1">
        <nav
          aria-label="Admin areas"
          className="flex min-h-0 flex-1 flex-col items-center gap-1"
        >
          {areas.map((area) => {
            const Icon = area.icon;
            const count = navCount(area);

            return (
              <Tooltip key={area.to}>
                <TooltipTrigger
                  // TanStack Router sets aria-current on the active link, which is both
                  // the accessible signal and the hook the active styling keys off — no
                  // second source of truth for "which area am I in".
                  render={
                    <Link
                      to={area.to}
                      activeOptions={{ exact: area.to === "/" }}
                    />
                  }
                  className={cn(
                    "text-muted-foreground relative flex size-11 items-center justify-center rounded-lg transition-colors md:size-9",
                    "hover:bg-accent hover:text-accent-foreground",
                    "aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                  )}
                >
                  <Icon className="size-5" />
                  {count === undefined ? null : (
                    <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] leading-none">
                      {count}
                    </Badge>
                  )}
                  <span className="sr-only">{area.label}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{area.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex shrink-0 flex-col items-center gap-1">
          {/* Inert chrome on its own: the delegated [data-theme-toggle] handler in
              src/main.tsx is what cycles light → dark → system. */}
          <ThemeToggle className="size-11 md:size-9" />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Account menu"
                  className="size-11 rounded-full md:size-9"
                />
              }
            >
              <Avatar size="sm">
                <AvatarFallback>{initialsOf(name)}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className="w-56"
            >
              <div className="px-1.5 py-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {session.user.email}
                </p>
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem disabled={pending} onClick={signOut}>
                <LogOutIcon />
                {pending ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>

              {error === null ? null : (
                <p
                  role="alert"
                  className="text-destructive px-1.5 py-1 text-xs"
                >
                  {error}
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
