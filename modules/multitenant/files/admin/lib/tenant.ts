import { queryOptions } from "@tanstack/react-query";

import { api } from "@admin/lib/api";

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
