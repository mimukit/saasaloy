import { queryOptions } from "@tanstack/react-query";

import { api } from "@admin/lib/api";

// The one description of the user list request. /users renders it as a table and the
// overview at / reads its total and newest rows, so both share one key and one fetcher:
// a refresh on either screen updates the other.
//
// Every row here is real: `GET /admin/users` is served by apps/api/src/routes/admin-users.ts
// behind `requireAdmin`, and `hc<AppType>` types the answer. The api caps the answer at
// 100 users; `total` is its own count of every account.
export const usersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => {
    const res = await api.admin.users.$get();
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
