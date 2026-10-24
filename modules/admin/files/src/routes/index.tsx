import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";

import { ErrorState } from "@repo/ui/blocks/admin/error-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/admin/avatar";
import { Button, buttonVariants } from "@repo/ui/components/admin/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/admin/card";
import { StatusPill } from "@repo/ui/components/admin/status-pill";
import { PageBody } from "@repo/ui/containers/admin/page-body";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";
import { errors } from "@repo/ui/content/errors";

import { api } from "@admin/lib/api";
import { initialsOf } from "@admin/lib/initials";
import { usersQuery } from "@admin/lib/users-query";

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

// The dashboard at `/`: the api's health, the user count, and the five newest sign-ups.
// Both requests are ones the app already makes — `GET /health` and `GET /admin/users` —
// so the overview adds no api route. `createFileRoute("/")` is generated from this file's
// path under src/routes/; the router plugin writes the id, so never rename it by hand.
//
// `ensureQueryData` in the loader means both requests start while the route is still
// resolving, and `defaultPreload: "intent"` starts them on hover. By the time the
// component mounts the cache is warm, so `useQuery` below returns data on its first
// render instead of flashing a skeleton. A cached, unexpired entry skips the fetch.
export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(healthQuery),
      context.queryClient.ensureQueryData(usersQuery),
    ]),
  component: Dashboard,
  errorComponent: DashboardError,
});

/** How many sign-ups the overview lists. */
const NEWEST_COUNT = 5;

function Dashboard() {
  const queryClient = useQueryClient();
  // The loader already resolved both, so `data` is present on the first render. The hooks
  // are still what the component reads, because they subscribe: an invalidation anywhere
  // in the app re-renders this screen, which a value returned from the loader would not.
  const health = useQuery(healthQuery);
  const users = useQuery(usersQuery);

  // The api returns at most 100 users and promises no order, so the newest five are
  // picked here. With more than 100 accounts the list is the newest of the first page.
  const newest = useMemo(
    () =>
      (users.data?.users ?? [])
        .toSorted(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
        )
        .slice(0, NEWEST_COUNT),
    [users.data]
  );

  const status = health.data?.status;
  const refreshing = health.isFetching || users.isFetching;

  return (
    // No `detail` prop here: the overview has nothing to select, so PageLayout renders a
    // single column. /users is the screen that passes one.
    <PageLayout>
      <PageHeader
        title="Overview"
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={refreshing}
            // Invalidation, not `refetch()`: marking the keys stale refreshes every screen
            // holding these queries, and it is the same call a mutation's `onSuccess` makes.
            onClick={() =>
              Promise.all([
                queryClient.invalidateQueries({
                  queryKey: healthQuery.queryKey,
                }),
                queryClient.invalidateQueries({
                  queryKey: usersQuery.queryKey,
                }),
              ])
            }
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />

      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>API health</CardDescription>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {/* "ok" is the one healthy answer; anything else is worth a second look,
                    so it takes the `warn` tone rather than a quiet neutral one. */}
                {status === "ok" ? (
                  <StatusPill label="Healthy" tone="ok" />
                ) : (
                  <StatusPill label={status ?? "Unknown"} tone="warn" />
                )}
                <span className="text-muted-foreground text-sm font-normal">
                  {health.dataUpdatedAt === 0
                    ? null
                    : `Checked ${new Date(health.dataUpdatedAt).toLocaleTimeString()}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardPanel className="text-muted-foreground pt-0 text-xs">
              <code className="font-mono">GET /health</code>, typed by the route
              file in apps/api through <code className="font-mono">hc</code>.
            </CardPanel>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Users</CardDescription>
              <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
                {users.data?.total.toLocaleString() ?? "—"}
              </CardTitle>
            </CardHeader>
            <CardPanel className="text-muted-foreground pt-0 text-xs">
              Every account in this project.
            </CardPanel>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Newest sign-ups</CardTitle>
            <CardAction>
              <Link
                to="/users"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                View all
              </Link>
            </CardAction>
          </CardHeader>
          <CardPanel className="px-0 pt-0 pb-2">
            {newest.length === 0 ? (
              <p className="text-muted-foreground px-6 py-4 text-sm">
                Nobody has signed up yet.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {newest.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center gap-3 px-6 py-2.5"
                  >
                    <Avatar className="size-7">
                      <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {user.email}
                      </p>
                    </div>
                    <time
                      dateTime={user.createdAt}
                      className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    >
                      {new Date(user.createdAt).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardPanel>
        </Card>
      </PageBody>
    </PageLayout>
  );
}

// A down api is the ordinary case in dev, not an exception worth a blank screen. The
// route's `errorComponent` catches the loader's throw, and the retry re-runs the loader.
function DashboardError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Overview" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The api did not answer"
        description="Check that apps/api is running on the origin PUBLIC_API_URL names (http://localhost:4000 in dev)."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{
          label: errors.renderFailure.retryLabel,
          onClick: reset,
        }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
