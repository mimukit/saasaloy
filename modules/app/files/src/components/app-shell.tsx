import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  applyThemeChoice,
  currentThemeChoice,
} from "@repo/ui/blocks/shell/theme-toggle";
import { ShellLayout } from "@repo/ui/containers/shell/shell-layout";
import type { ShellLinkProps } from "@repo/ui/containers/shell/shell-nav";
import { useCommands } from "@repo/ui/lib/shell/commands";

import { appCommands } from "@app/components/commands";
import { NAV_AREAS, areaFor } from "@app/components/nav";
import { shellExtensions } from "@app/components/shell-extensions";
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

/**
 * Declares the app's own commands: Go to each nav row, sign out, and the theme choices.
 * It renders nothing. It sits inside ShellLayout, not in AppShell's own body, because a
 * shell extension's provider wraps the layout: a `useCommands` call in AppShell would run
 * above that provider and register nothing. With no `command` module installed, no
 * provider is mounted and the call does nothing.
 */
function AppCommands({ signOut }: { signOut: () => Promise<void> }) {
  const navigate = useNavigate();
  useCommands(
    appCommands({
      navigate: (to) => {
        void navigate({ to });
      },
      signOut: () => {
        void signOut();
      },
      setTheme: (theme) => {
        applyThemeChoice(theme);
      },
      currentTheme: currentThemeChoice,
    }),
    { scope: "global" }
  );
  return null;
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
      extensions={shellExtensions}
      // The product name stands alone in the sidebar. `admin` shows "Admin" under it.
      subtitle={null}
    >
      <AppCommands signOut={signOut.signOut} />
      {children}
    </ShellLayout>
  );
}
