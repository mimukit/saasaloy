import { useQueries } from "@tanstack/react-query";
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

import { adminCommands } from "@admin/components/commands";
import { NAV_AREAS, areaFor } from "@admin/components/nav";
import { NAV_COUNTS } from "@admin/components/nav-counts";
import { shellExtensions } from "@admin/components/shell-extensions";
import { useSignOut } from "@admin/components/sign-out-button";
import { API_CREDENTIALS, API_HEADERS } from "@admin/lib/api";
import { apiBaseUrl } from "@admin/lib/auth";
import type { AdminSession } from "@admin/lib/auth";
import { initialsOf } from "@admin/lib/initials";

// The router and session side of the shell. The layout itself lives in @repo/ui as
// ShellLayout, which imports no router and no session; this file is where both are
// read and handed in.
//
// NAV_AREAS, its types, and the two rules that read it live in ./nav.ts, which is the
// one file to edit to add a screen. The live counts some rows show come from
// ./nav-counts.ts, which a module extends with a `const-array` patch.

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

/** How often the sidebar's live counts refetch while the tab is visible. */
const NAV_COUNT_INTERVAL_MS = 60_000;

/**
 * One live nav count, or `null` when there is none to show.
 *
 * Plain `fetch` rather than the typed `api` client: a NAV_COUNTS `path` is data a module's
 * patch wrote, so there is no route type to call it through. The origin, the cookie and
 * the audience header are the same three `src/lib/api.ts` sets, for the same reasons.
 *
 * Every failure (network, a non-OK status, a body that is not `{ count: number }`) answers
 * `null`, so a count that cannot be read shows no badge and never reaches an error UI.
 */
async function fetchNavCount(path: string): Promise<number | null> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: API_CREDENTIALS,
      headers: API_HEADERS,
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const count =
      typeof body === "object" && body !== null && "count" in body
        ? body.count
        : undefined;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * The live counts for every NAV_COUNTS entry, keyed by the row's `to`.
 *
 * One query per entry under `["nav-count", to]`, so a page that changes a count
 * invalidates its own key after the mutation and the badge follows with no reload.
 * TanStack Query refetches on window focus and does not run the interval in a hidden tab.
 */
function useNavCounts(): Record<string, number | undefined> {
  return useQueries({
    queries: NAV_COUNTS.map(({ to, path }) => ({
      queryKey: ["nav-count", to],
      queryFn: () => fetchNavCount(path),
      refetchInterval: NAV_COUNT_INTERVAL_MS,
      refetchOnWindowFocus: true,
    })),
    combine: (results) =>
      Object.fromEntries(
        NAV_COUNTS.map(({ to }, index) => [
          to,
          results[index]?.data ?? undefined,
        ])
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
function AdminCommands({ signOut }: { signOut: () => Promise<void> }) {
  const navigate = useNavigate();
  useCommands(
    adminCommands({
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

  const counts = useNavCounts();

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
      extensions={shellExtensions}
      counts={counts}
    >
      <AdminCommands signOut={signOut.signOut} />
      {children}
    </ShellLayout>
  );
}
