import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useEffect } from "react";
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
import { NAV_COUNTS } from "@app/components/nav-counts";
import { shellExtensions } from "@app/components/shell-extensions";
import { useSignOut } from "@app/components/use-sign-out";
import type { AppSession } from "@app/lib/auth";
import { initialsOf } from "@app/lib/initials";
import { navCountQuery } from "@app/lib/nav-count";

// The app's frame: the `shell` layout with this app's nav, its session and its sign-out.
// The shell owns the markup and holds no auth logic; this file hands it the data. The live
// counts some rows show come from ./nav-counts.ts, which a module extends with a
// `const-array` patch.

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
 * The live counts for every NAV_COUNTS entry, keyed by the row's `to`.
 *
 * One query per entry, from `navCountQuery` in src/lib/nav-count.ts, under `["nav-count", to]`, so a page that changes a count
 * invalidates its own key after the mutation and the badge follows with no reload.
 * TanStack Query refetches on every window focus and does not run the interval in a hidden
 * tab.
 * A query with no data yet maps to `undefined`, "not known", so the row keeps its static
 * count; a query that failed after a success still holds its last `data`.
 *
 * A page the browser restores from its back-forward cache fires `pageshow` with
 * `persisted` set and no focus event, so that event invalidates every nav count too.
 */
function useNavCounts(): Record<string, number | undefined> {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void queryClient.invalidateQueries({ queryKey: ["nav-count"] });
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [queryClient]);

  return useQueries({
    queries: NAV_COUNTS.map((source) => navCountQuery(source)),
    combine: (results) =>
      Object.fromEntries(
        NAV_COUNTS.map(({ to }, index) => [to, results[index]?.data])
      ),
  });
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
  const counts = useNavCounts();

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
      counts={counts}
      // The product name stands alone in the sidebar. `admin` shows "Admin" under it.
      subtitle={null}
    >
      <AppCommands signOut={signOut.signOut} />
      {children}
    </ShellLayout>
  );
}
