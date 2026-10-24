import { Link, useRouterState } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellLayout } from "@repo/ui/containers/shell/shell-layout";
import type { ShellLinkProps } from "@repo/ui/containers/shell/shell-nav";

import { NAV_AREAS, areaFor } from "@app/components/nav";
import { useSignOut } from "@app/components/use-sign-out";
import type { AppSession } from "@app/lib/auth";
import { initialsOf } from "@app/lib/initials";

// The app's frame: the `shell` layout with this app's nav, its session and its sign-out.
// The shell owns the markup and holds no auth logic; this file hands it the data.

/**
 * The link the shell renders for every nav entry. TanStack Router sets aria-current on the
 * active link, which is the attribute the shell styles. The cast is the one place a nav
 * `to` loses its route typing; NAV_AREAS is already checked against the route tree.
 */
function ShellNavLink({ to, exact, ...props }: ShellLinkProps) {
  return (
    <Link {...props} to={to as LinkProps["to"]} activeOptions={{ exact }} />
  );
}

export function AppShell({
  session,
  children,
}: {
  session: AppSession;
  children: ReactNode;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const signOut = useSignOut();

  // A name is optional at sign-up in Better Auth's schema, so fall back to the email.
  const name = session.user.name || session.user.email;

  return (
    <ShellLayout
      areas={NAV_AREAS}
      area={areaFor(pathname)}
      currentPath={pathname}
      link={ShellNavLink}
      account={{ name, email: session.user.email, initials: initialsOf(name) }}
      signOut={signOut}
      // The product name stands alone in the sidebar. `admin` shows "Admin" under it.
      subtitle={null}
    >
      {children}
    </ShellLayout>
  );
}
