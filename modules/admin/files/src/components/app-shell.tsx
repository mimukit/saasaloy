import { Link, useRouterState } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellLayout } from "@repo/ui/containers/admin/shell-layout";
import type { ShellLinkProps } from "@repo/ui/containers/admin/shell-nav";

import { NAV_AREAS, areaFor } from "@admin/components/nav";
import { useSignOut } from "@admin/components/sign-out-button";
import type { AdminSession } from "@admin/lib/auth";
import { initialsOf } from "@admin/lib/initials";

// The router and session side of the shell. The layout itself lives in @repo/ui as
// ShellLayout, which imports no router and no session; this file is where both are
// read and handed in.
//
// NAV_AREAS, its types, and the two rules that read it live in ./nav.ts, which is the
// one file to edit to add a screen.

/**
 * The link the shell renders for every nav entry. TanStack Router sets aria-current on
 * the active link, which is the attribute the shell styles.
 *
 * The cast is the one place a nav `to` loses its route typing. NAV_AREAS is already
 * checked against the route tree, and the shell only ever hands back a `to` it read
 * from NAV_AREAS.
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
  session: AdminSession;
  children: ReactNode;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  // The same order of operations the sign-out button uses, from the same hook: the
  // server clears the cookie, the cached session is dropped, and only then does the
  // router re-run the root guard.
  const signOut = useSignOut();

  const name = session.user.name || session.user.email;

  return (
    <ShellLayout
      areas={NAV_AREAS}
      // With a single seeded area this always resolves to it, and adding a second area
      // needs no change here.
      area={areaFor(pathname)}
      currentPath={pathname}
      link={ShellNavLink}
      account={{ name, email: session.user.email, initials: initialsOf(name) }}
      signOut={signOut}
    >
      {children}
    </ShellLayout>
  );
}
