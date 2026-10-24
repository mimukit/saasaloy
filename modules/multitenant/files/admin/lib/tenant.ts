import { queryOptions } from "@tanstack/react-query";

import { api } from "@admin/lib/api";
import { auth } from "@admin/lib/auth";

// The `GET /tenant` query, in one place.
//
// Every tenant-scoped screen needs the same answer — which organization am I in, and what
// may I do here — and TanStack Query caches it under one key. Two screens declaring their
// own `queryOptions` under the same `queryKey` would share that cache entry while owning
// separate definitions of it, so a change to the fetcher on one screen silently changes
// the other. One export, one key, one fetcher.
//
// `multitenant` ships it because `multitenant` mounts the `GET /tenant` endpoint this
// query calls. The fetcher and the route it calls stay in one module, so a change to
// either lands in the same review.

/**
 * The resolved tenant. The fetcher throws on a non-2xx, so a 403 lands in `error` rather
 * than in the cache as data — and the two 403 messages mean different things:
 * `no active organization` is "pick an organization first", anything else is a refusal.
 */
export const tenantQuery = queryOptions({
  queryKey: ["tenant"],
  queryFn: async () => {
    const res = await api.tenant.$get();
    if (!res.ok) {
      const body = (await res.json()) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `The api answered ${res.status}.`);
    }
    return res.json();
  },
});

/**
 * The organization behind an id, for the screens that name it. `GET /tenant` carries the
 * id only, and a raw id means nothing to the person reading the page, so a screen shows
 * `name` instead. Better Auth's `getOrganization` checks that the caller is a member.
 *
 * The key sits under `["organizations", id]`, so the teams screen's invalidation of
 * `["organizations"]` after a rename refreshes this name too.
 */
export function organizationQuery(organizationId: string) {
  return queryOptions({
    queryKey: ["organizations", organizationId, "detail"],
    queryFn: async () => {
      const result = await auth.organization.getOrganization({
        query: { organizationId },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      if (!result.data) {
        throw new Error("no active organization");
      }
      return result.data;
    },
  });
}
