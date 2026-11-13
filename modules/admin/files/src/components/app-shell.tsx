import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { AttentionMenu } from "@repo/ui/blocks/shell/attention-menu";
import {
  applyThemeChoice,
  currentThemeChoice,
} from "@repo/ui/blocks/shell/theme-toggle";
import { ShellLayout } from "@repo/ui/containers/shell/shell-layout";
import type { ShellLinkProps } from "@repo/ui/containers/shell/shell-nav";
import { attentionRows } from "@repo/ui/lib/shell/attention";
import type { AttentionSource } from "@repo/ui/lib/shell/attention";
import { useCommands } from "@repo/ui/lib/shell/commands";
import { navCountFromBody } from "@repo/ui/lib/shell/nav-counts";

import { adminCommands } from "@admin/components/commands";
import { NAV_AREAS, areaFor } from "@admin/components/nav";
import { NAV_COUNTS } from "@admin/components/nav-counts";
import { PageTrailContext } from "@admin/components/page-trail";
import type { PageTrailStep } from "@admin/components/page-trail";
import { shellExtensions } from "@admin/components/shell-extensions";
import { useSignOut } from "@admin/components/sign-out-button";
import { rootWrappers } from "@admin/extend/root";
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
// ./nav-counts.ts, which a module extends with a `const-array` patch. The same counts feed
// the "Needs attention" menu in the header, so a module that adds a count gets a row there
// too, with no second patch.

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

/**
 * Wraps `children` in each of the project's root wrappers, the first entry outermost.
 * The list lives in src/extend/root.tsx, a seed file the project owns, so a provider the
 * project adds there needs no edit to this file or to src/routes/__root.tsx.
 */
function RootWrappers({ children }: { children: ReactNode }) {
  let tree = children;
  for (const Wrapper of rootWrappers.toReversed()) {
    tree = <Wrapper>{tree}</Wrapper>;
  }
  return tree;
}

/** The words of the "Needs attention" menu. */
const ATTENTION_WORDS = {
  title: "Needs attention",
  empty: "Nothing waits for you.",
} as const;

/**
 * A nav row as the attention menu reads it. NAV_AREAS is `as const`, so each group's
 * `items` is a tuple type of its own, and a module that adds a group adds one more. This
 * is the shape they share.
 */
interface NavRow {
  readonly to: string;
  readonly label: string;
}

/**
 * The queues the "Needs attention" menu offers: every NAV_COUNTS entry, in its order, with
 * the label of the nav row whose `to` matches. An entry with no nav row has no label to
 * show, so the menu leaves it out.
 */
const ATTENTION_SOURCES: readonly AttentionSource[] = NAV_COUNTS.flatMap(
  ({ to }) => {
    const label = NAV_AREAS.flatMap((area) =>
      area.groups.flatMap((group): readonly NavRow[] => group.items)
    ).find((item) => item.to === to)?.label;
    return label === undefined ? [] : [{ to, label }];
  }
);

/** How often the sidebar's live counts refetch while the tab is visible. */
const NAV_COUNT_INTERVAL_MS = 60_000;

/**
 * One live nav count.
 *
 * Plain `fetch` rather than the typed `api` client: a NAV_COUNTS `path` is data a module's
 * patch wrote, so there is no route type to call it through. The origin, the cookie and
 * the audience header are the same three `src/lib/api.ts` sets, for the same reasons.
 *
 * Every failure (network, a non-OK status, a body that is not `{ count: number }`) throws,
 * so TanStack Query keeps the last count it read and the badge never drops because of a
 * failure. The query has no error UI, so a failure never reaches the screen.
 */
async function fetchNavCount(path: string): Promise<number> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: API_CREDENTIALS,
    headers: API_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`The nav count at ${path} answered ${response.status}.`);
  }
  return navCountFromBody(await response.json());
}

/**
 * The live counts for every NAV_COUNTS entry, keyed by the row's `to`.
 *
 * One query per entry under `["nav-count", to]`, so a page that changes a count
 * invalidates its own key after the mutation and the badge follows with no reload.
 * TanStack Query refetches on window focus and does not run the interval in a hidden tab.
 * A query with no data yet maps to `undefined`, "not known", so the row keeps its static
 * count; a query that failed after a success still holds its last `data`.
 */
function useNavCounts(): Record<string, number | undefined> {
  return useQueries({
    queries: NAV_COUNTS.map(({ to, path }) => ({
      queryKey: ["nav-count", to],
      queryFn: () => fetchNavCount(path),
      refetchInterval: NAV_COUNT_INTERVAL_MS,
      // "always", not `true`: `true` skips a count fetched inside the 30 s staleTime, so
      // a row changed in another tab would not show here until the next interval.
      refetchOnWindowFocus: "always",
    })),
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
function AdminCommands({ signOut }: { signOut: () => Promise<void> }) {
  const navigate = useNavigate();
  useCommands(
    adminCommands({
      // Cast for the reason ShellNavLink casts: a nav `to` may be a concrete path of a
      // param route ("/cms/blog"), which nav.ts's `NavTargets` has already checked.
      navigate: (to) => {
        void navigate({ to: to as LinkProps["to"] });
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
  const attention = attentionRows(ATTENTION_SOURCES, counts);

  // The page path a record screen sets through `usePageTrail`; unset, the shell derives it.
  const [trail, setTrail] = useState<readonly PageTrailStep[] | undefined>();

  const name = session.user.name || session.user.email;

  // The project's root wrappers go around the whole layout, so the sidebar, the header and
  // every page sit inside them. A wrapper here renders only for a signed-in admin.
  return (
    <RootWrappers>
      <ShellLayout
        areas={NAV_AREAS}
        // With a single seeded area this always resolves to it, and adding a second area
        // needs no change here.
        area={areaFor(pathname)}
        currentPath={pathname}
        link={ShellNavLink}
        account={{
          name,
          email: session.user.email,
          initials: initialsOf(name),
        }}
        signOut={signOut}
        extensions={shellExtensions}
        counts={counts}
        attention={
          <AttentionMenu
            rows={attention.rows}
            total={attention.total}
            link={ShellNavLink}
            title={ATTENTION_WORDS.title}
            emptyText={ATTENTION_WORDS.empty}
          />
        }
        trail={trail}
      >
        <AdminCommands signOut={signOut.signOut} />
        <PageTrailContext value={setTrail}>{children}</PageTrailContext>
      </ShellLayout>
    </RootWrappers>
  );
}
