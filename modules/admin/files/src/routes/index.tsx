import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ErrorComponentProps, createFileRoute } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";

import { api } from "@admin/lib/api";

// The convention every admin screen follows, written once here so a feature module can
// copy it: describe the request as `queryOptions(...)`, prefetch it in the route's
// `loader`, read it in the component with `useQuery`, and invalidate it by key.
//
// `queryOptions` is what ties those three together. The key and the fetcher are declared
// in one object, so the loader, the component and any invalidation elsewhere in the app
// cannot drift apart the way three hand-written `queryKey` arrays would.
//
// The fetcher throws on a non-2xx answer on purpose. `fetch` resolves a 500 like any
// other response, so without the check a failed request would land in the cache as data
// and the screen would render an error body as if it were health.
const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: async () => {
    const res = await api.health.$get();
    if (!res.ok) throw new Error(`The api answered ${res.status}.`);
    // Typed from apps/api's route chain, not asserted here. Change what
    // src/routes/health.ts returns and this call site is where the compiler complains.
    return res.json();
  },
});

// The dashboard at `/`. `createFileRoute("/")` is generated from this file's path under
// src/routes/ — the router plugin writes the id, so never rename the call by hand.
//
// `ensureQueryData` in the loader means the request starts while the route is still
// resolving, and `defaultPreload: "intent"` starts it on hover. By the time the component
// mounts the cache is warm, so `useQuery` below returns data on its first render instead
// of flashing a spinner. A cached, unexpired entry short-circuits the fetch entirely.
export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQuery),
  component: Dashboard,
  errorComponent: DashboardError,
});

function Dashboard() {
  const queryClient = useQueryClient();
  // The loader already resolved this, so `data` is present on the first render. The hook
  // is still what the component reads, because it subscribes: an invalidation anywhere in
  // the app re-renders this screen, which a value returned from the loader would not.
  const { data, isFetching } = useQuery(healthQuery);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="text-muted-foreground text-sm">Live data from the api Worker.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          // Invalidation, not `refetch()`: marking the key stale refreshes every screen
          // holding this query, and it is the same call a mutation's `onSuccess` makes.
          onClick={() => queryClient.invalidateQueries({ queryKey: healthQuery.queryKey })}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Api health</CardTitle>
          <CardDescription>
            <code className="font-mono">GET /health</code>, called through{" "}
            <code className="font-mono">hc&lt;AppType&gt;</code>. The response is typed by the
            route file in apps/api, so a schema change there fails this app's typecheck.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">status</span>
          <Badge variant="secondary">{data?.status}</Badge>
        </CardContent>
      </Card>
    </main>
  );
}

// A down api is the ordinary case in dev, not an exception worth a blank screen. The
// route's `errorComponent` catches the loader's throw and the query's, and the reset
// button re-runs the loader.
function DashboardError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>The api did not answer</CardTitle>
          <CardDescription>
            {error.message} Check that apps/api is running on the origin PUBLIC_API_URL names
            (http://localhost:4000 in dev).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
