import { queryOptions } from "@tanstack/react-query";

import { navCountFromBody } from "@repo/ui/lib/shell/nav-counts";

import type { NavCountSource } from "@app/components/nav-counts";
import { API_CREDENTIALS } from "@app/lib/api";
import { apiBaseUrl } from "@app/lib/auth";

// The query behind one live nav count. app-shell.tsx runs one per NAV_COUNTS entry for the
// sidebar, and a module that shows the same number somewhere else (the notification bell)
// calls `navCountQuery` with the same entry. Both observers then carry the same `queryFn`
// and the same timing, so they share one fetch and can never disagree.
//
// It lives in its own file, not in app-shell.tsx, so a module can import it without
// importing the shell: app-shell.tsx imports shell-extensions.ts, which imports every
// module's extension, and an import back into app-shell.tsx would be a cycle.

/** How often a live nav count refetches while the tab is visible. */
export const NAV_COUNT_INTERVAL_MS = 60_000;

/**
 * One live nav count.
 *
 * Plain `fetch` rather than the typed `api` client: a NAV_COUNTS `path` is data a module's
 * patch wrote, so there is no route type to call it through. The origin and the cookie
 * are the same two `src/lib/api.ts` uses, for the same reasons.
 *
 * Every failure (network, a non-OK status, a body that is not `{ count: number }`) throws,
 * so TanStack Query keeps the last count it read and the badge never drops because of a
 * failure. The query has no error UI, so a failure never reaches the screen.
 */
export async function fetchNavCount(path: string): Promise<number> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: API_CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(`The nav count at ${path} answered ${response.status}.`);
  }
  return navCountFromBody(await response.json());
}

/** The query options for one NAV_COUNTS entry, under the key `["nav-count", to]`. */
export function navCountQuery({ to, path }: NavCountSource) {
  return queryOptions({
    queryKey: ["nav-count", to],
    queryFn: () => fetchNavCount(path),
    refetchInterval: NAV_COUNT_INTERVAL_MS,
    // "always", not `true`: `true` skips a count fetched inside the 30 s staleTime, so
    // a row marked read in another tab would not show here until the next interval.
    refetchOnWindowFocus: "always",
  });
}
