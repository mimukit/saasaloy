import { queryOptions } from "@tanstack/react-query";

import { api } from "@admin/lib/api";

// The user list request. /users renders it as a table, with no query: the first 100
// accounts in the plugin's order.
//
// Every row here is real: `GET /admin/users` is served by apps/api/src/routes/admin-users.ts
// behind `adminGate`, and `hc<AppType>` types the answer. The api caps the answer at
// 100 users; `total` is its own count of every account.
export const usersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => {
    const res = await api.admin.users.$get({ query: {} });
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
});

/** How many sign-ups the overview lists. */
export const NEWEST_USERS_COUNT = 5;

// The overview's request: the five newest accounts, sorted by the api, and `total`.
// Its key sits under `["admin", "users"]`, so an invalidation of `usersQuery.queryKey`
// (a create or a delete on /users) refreshes the overview too.
export const newestUsersQuery = queryOptions({
  queryKey: ["admin", "users", "newest"],
  queryFn: async () => {
    const res = await api.admin.users.$get({
      query: {
        limit: String(NEWEST_USERS_COUNT),
        sortBy: "createdAt",
        sortDirection: "desc",
      },
    });
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
});

/**
 * One user row, taken from the query's own return type rather than redeclared. Writing
 * the fields out by hand would compile happily after the api dropped one of them; this
 * way a change in apps/api lands as a typecheck failure in the screens that read it.
 */
export type AdminUser = Awaited<
  ReturnType<NonNullable<(typeof usersQuery)["queryFn"]>>
>["users"][number];
