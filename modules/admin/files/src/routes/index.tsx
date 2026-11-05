import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Button } from "@repo/ui/components/shell/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
} from "@repo/ui/components/shell/card";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";

import { whenLabel } from "@admin/lib/activity";
import { api } from "@admin/lib/api";
import { initialsOf } from "@admin/lib/initials";
import { NEWEST_USERS_COUNT, newestUsersQuery } from "@admin/lib/users-query";

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
// Two requests, `GET /health` and `GET /admin/users?limit=5&sortBy=createdAt&sortDirection=desc`.
// The api sorts and counts: the answer holds the five newest rows and `total`, the count
// of every account, so the overview fetches five rows to show five.
// `createFileRoute("/")` is generated from this file's path under src/routes/; the router
// plugin writes the id, so never rename it by hand.
//
// The loader starts both requests and awaits neither. `prefetchQuery` never throws, so a
// down api cannot hold the first paint or swap the page for an error screen: the page
// paints at once, and each card shows its own skeleton, then its data or its own failure.
// Starting them here rather than on mount still buys the head start `defaultPreload:
// "intent"` gives on hover, and a cached, unexpired entry skips the fetch.
export const Route = createFileRoute("/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQuery);
    void context.queryClient.prefetchQuery(newestUsersQuery);
  },
  component: Dashboard,
  errorComponent: DashboardError,
});

/** One line that says a card's request failed, with the error's own message under it. */
function CardFailure({ label, error }: { label: string; error: Error }) {
  return (
    <div className="flex flex-col items-start gap-1.5" role="alert">
      <StatusPill label={label} tone="bad" />
      <p className="text-muted-foreground text-xs">{error.message}</p>
    </div>
  );
}

function HealthCard() {
  const queryClient = useQueryClient();
  const health = useQuery(healthQuery);
  const status = health.data?.status;

  let body;
  if (health.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3 w-44" />
        <p className="text-muted-foreground text-xs">Checking…</p>
      </div>
    );
  } else if (health.isError) {
    body = (
      <div className="flex flex-col items-start gap-1.5" role="alert">
        <StatusPill label="Unreachable" tone="bad" />
        <p className="text-muted-foreground text-xs">
          The api did not answer <code className="font-mono">/health</code>.
          Retry, or check the api logs.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-start gap-1.5">
        {/* "ok" is the one healthy answer; anything else is worth a second look,
            so it takes the `warn` tone rather than a quiet neutral one. */}
        {status === "ok" ? (
          <StatusPill label="Healthy" tone="ok" />
        ) : (
          <StatusPill label={status ?? "Unknown"} tone="warn" />
        )}
        <p className="text-muted-foreground text-xs">
          Checked {new Date(health.dataUpdatedAt).toLocaleTimeString()}
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>API health</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Check the api again"
            loading={health.isFetching}
            // Invalidation, not `refetch()`: marking the key stale refreshes every screen
            // holding it, and it is the same call a mutation's `onSuccess` makes.
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: healthQuery.queryKey })
            }
          >
            <RefreshCwIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel className="pt-0">{body}</CardPanel>
    </Card>
  );
}

function UsersCard() {
  const users = useQuery(newestUsersQuery);

  let body;
  if (users.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  } else if (users.isError) {
    body = <CardFailure label="Not loaded" error={users.error} />;
  } else {
    body = (
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {users.data.total.toLocaleString()}
        </p>
        <p className="text-muted-foreground text-xs">
          Every account in this project.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Users</CardDescription>
      </CardHeader>
      <CardPanel className="flex-1 pt-0">{body}</CardPanel>
      <CardFooter>
        <Link
          to="/users"
          className="flex items-center gap-1 text-sm font-medium hover:underline"
        >
          Open users
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function NewestCard() {
  const users = useQuery(newestUsersQuery);
  // The fetch time, not `Date.now()`, so the render stays pure.
  const now = new Date(users.dataUpdatedAt);

  let body;
  if (users.isPending) {
    body = (
      <ul className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: NEWEST_USERS_COUNT }, (_, index) => (
          <li key={index} className="flex items-center gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (users.isError) {
    body = <CardFailure label="Not loaded" error={users.error} />;
  } else if (users.data.users.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">Nobody has signed up yet.</p>
    );
  } else {
    // The api answers newest first (`sortBy=createdAt&sortDirection=desc`), so the rows
    // render in the order they arrive.
    body = (
      <ul className="flex flex-col gap-3">
        {users.data.users.map((user) => (
          <li key={user.id} className="flex items-center gap-3">
            <Avatar className="size-7">
              <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p
                dir="auto"
                title={user.name}
                className="truncate text-sm font-medium"
              >
                {user.name}
              </p>
              <time
                dateTime={user.createdAt}
                className="text-muted-foreground block text-xs tabular-nums"
              >
                {whenLabel(user.createdAt, now, { withTime: false })}
              </time>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Newest sign-ups</CardDescription>
      </CardHeader>
      <CardPanel className="pt-0">{body}</CardPanel>
    </Card>
  );
}

function Dashboard() {
  return (
    // No `detail` prop here: the overview has nothing to select, so PageLayout renders a
    // single column. /users is the screen that passes one.
    <PageLayout>
      <PageHeader title="Overview" />

      <PageBody>
        {/* Each card reads its own query and owns its own loading and failure, so one
            slow or failed request never blanks the other two. The users and newest
            cards share one request. `grid-cols-1` gives the single column a zero
            minimum, so a long name truncates inside its card instead of widening
            every card past a phone screen. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <HealthCard />
          <UsersCard />
          <NewestCard />
        </div>
      </PageBody>
    </PageLayout>
  );
}

// A real render failure, not a down api: the cards above catch every request failure
// themselves, so this boundary only sees a throw from rendering. The retry re-runs the
// match in place.
function DashboardError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Overview" />
      <ErrorState
        code={errors.renderFailure.code}
        title={errors.renderFailure.title}
        description={errors.renderFailure.description}
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
