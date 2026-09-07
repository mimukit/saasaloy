import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import { AttributeList } from "@admin/components/attribute-list";
import { PageHeader } from "@admin/components/page-header";
import { PageLayout } from "@admin/components/page-layout";
import { StatusPill } from "@admin/components/status-pill";
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
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
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
  const { data, isFetching, dataUpdatedAt } = useQuery(healthQuery);

  const status = data?.status;

  return (
    // No `detail` prop here: the overview has nothing to select, so PageLayout renders a
    // single column and no side panel. /users is the screen that passes one.
    <PageLayout>
      <PageHeader
        title="Overview"
        description="Live data from the api Worker."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            // Invalidation, not `refetch()`: marking the key stale refreshes every screen
            // holding this query, and it is the same call a mutation's `onSuccess` makes.
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: healthQuery.queryKey })
            }
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <section
          aria-labelledby="api-health"
          className="border-border max-w-2xl rounded-xl border p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 id="api-health" className="text-sm font-medium">
              Api health
            </h2>
            {/* The one live value on this screen, so it gets the pill rather than a row
                of plain text. `open` is the muted blue the reference reserves for a
                healthy state; anything other than "ok" falls back to neutral. */}
            <StatusPill
              label={status ?? "unknown"}
              tone={status === "ok" ? "open" : "neutral"}
            />
          </div>

          {/* The same label/value rows the detail panel uses, so the two screens read as
              one system and neither invents its own field layout. */}
          <AttributeList
            items={[
              {
                label: "Endpoint",
                value: <code className="font-mono text-xs">GET /health</code>,
              },
              {
                label: "Client",
                value: (
                  <code className="font-mono text-xs">hc&lt;AppType&gt;</code>
                ),
              },
              { label: "Status", value: status },
              {
                label: "Checked",
                value:
                  dataUpdatedAt === 0
                    ? undefined
                    : new Date(dataUpdatedAt).toLocaleTimeString(),
              },
            ]}
          />

          <p className="text-muted-foreground mt-3 text-sm">
            The response is typed by the route file in apps/api, so a schema
            change there fails this app&#39;s typecheck.
          </p>
        </section>
      </div>
    </PageLayout>
  );
}

// A down api is the ordinary case in dev, not an exception worth a blank screen. The
// route's `errorComponent` catches the loader's throw and the query's, and the reset
// button re-runs the loader.
function DashboardError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader
        title="Overview"
        description="The api did not answer."
        actions={
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          role="alert"
          className="border-border text-muted-foreground max-w-2xl rounded-xl border p-4 text-sm"
        >
          {error.message} Check that apps/api is running on the origin
          PUBLIC_API_URL names (http://localhost:4000 in dev).
        </div>
      </div>
    </PageLayout>
  );
}
