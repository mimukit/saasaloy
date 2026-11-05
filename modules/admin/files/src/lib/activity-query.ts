import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { ACTIVITY_KEY, activityParams } from "@admin/lib/activity";
import type { ActivityFilters } from "@admin/lib/activity";
import { api } from "@admin/lib/api";

// The audit log's requests. They live apart from ./activity.ts, which holds the pure
// rules, because the api client reads PUBLIC_API_URL when it loads, and a unit test runs
// with no environment.

/**
 * The log under the filters, 50 rows a page, with "Load older" fetching the next. The
 * range's start is fixed when the first page runs, so a later page does not move it.
 */
export function activityQuery(filters: ActivityFilters) {
  return infiniteQueryOptions({
    queryKey: [...ACTIVITY_KEY, "list", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.admin["audit-events"].$get({
        query: activityParams(filters, new Date(), pageParam),
      });
      if (res.status !== 200) {
        throw new Error(`The api answered ${res.status}.`);
      }
      return res.json();
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Everyone the person menu lists, removed admins marked. */
export const activityPeopleQuery = queryOptions({
  queryKey: [...ACTIVITY_KEY, "people"],
  queryFn: async () => {
    const res = await api.admin["audit-events"].people.$get();
    if (res.status !== 200) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
  staleTime: 5 * 60_000,
});

/** A member's three newest changes, for the Members screen's detail panel. */
export function memberActivityQuery(actorId: string) {
  return queryOptions({
    queryKey: [...ACTIVITY_KEY, "member", actorId],
    queryFn: async () => {
      const res = await api.admin["audit-events"].$get({
        query: { actor: actorId, limit: "3" },
      });
      if (res.status !== 200) {
        throw new Error(`The api answered ${res.status}.`);
      }
      return res.json();
    },
  });
}

type ActivityPage = Awaited<
  ReturnType<NonNullable<ReturnType<typeof activityQuery>["queryFn"]>>
>;

/** One audit row as the Activity screen reads it. */
export type ActivityEvent = ActivityPage["events"][number];
