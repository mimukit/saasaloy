import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { IdCardIcon, RefreshCwIcon, ShieldIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback } from "@repo/ui/components/avatar";
import { Button } from "@repo/ui/components/button";

import { DataTable } from "@admin/components/data-table";
import type { DataTableColumn } from "@admin/components/data-table";
import { DetailPanel } from "@admin/components/detail-panel";
import { FilterChips } from "@admin/components/filter-chips";
import { PageHeader } from "@admin/components/page-header";
import { PageLayout } from "@admin/components/page-layout";
import { StatusPill } from "@admin/components/status-pill";
import { api } from "@admin/lib/api";
import { initialsOf } from "@admin/lib/initials";

// The worked example of a real admin screen, at `/users`. It is the one place in the
// scaffold where every page primitive appears at once: a header with a count, a chip row,
// a sortable table, and a route-owned detail panel.
//
// `createFileRoute("/users")` is generated from this file's path under src/routes/ — the
// router plugin writes the id, so never rename the call by hand, and never hand-edit
// src/routeTree.gen.ts.
//
// This file is also what makes the "Users" row in NAV_AREAS type-check. Nav entries are
// checked against the generated route tree, so the row and the route arrive together or
// neither does.
//
// Every row here is real: `GET /admin/users` is served by apps/api/src/routes/admin-users.ts
// behind `requireAdmin`, and `hc<AppType>` types the answer. There are no demo rows to
// delete before this screen means anything.
const usersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => {
    const res = await api.admin.users.$get();
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
});

export const Route = createFileRoute("/users")({
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery),
  component: Users,
  errorComponent: UsersError,
});

/**
 * One row of the table, taken from the query's own return type rather than redeclared.
 * Writing the fields out by hand would compile happily after the api dropped one of them;
 * this way a change in apps/api lands as a typecheck failure in this file.
 */
type AdminUser = Awaited<
  ReturnType<NonNullable<(typeof usersQuery)["queryFn"]>>
>["users"][number];

/** The chips above the table. `all` is the resting state, so it is listed first. */
const ROLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "admin", label: "Admins" },
  { id: "user", label: "Users" },
] as const;

type RoleFilter = (typeof ROLE_FILTERS)[number]["id"];

/**
 * better-auth leaves `role` nullable — a row created before the admin plugin was enabled
 * carries none — so the filter reads a missing role as the ordinary "user". One place
 * decides that, and both the chips and the pill below go through it.
 */
function roleOf(user: AdminUser): string {
  return user.role ?? "user";
}

// The table's shape, at module scope. It depends on no state, so hoisting it out of the
// component keeps it a constant instead of an array rebuilt every render — and it is what
// keeps the `cell` renderers out of the render pass, which the react lint rule against
// components defined during render would otherwise flag.
const COLUMNS: readonly DataTableColumn<AdminUser>[] = [
  {
    id: "name",
    header: "Name",
    value: (user) => user.name,
    sortable: true,
    // The reference pairs a small avatar with the first cell's label. Everything richer
    // than a string is a `cell`; `value` stays the plain sort key above.
    cell: (user) => (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
        </Avatar>
        <span className="truncate font-medium">{user.name}</span>
      </div>
    ),
  },
  {
    id: "email",
    header: "Email",
    value: (user) => user.email,
    sortable: true,
  },
  {
    id: "role",
    header: "Role",
    value: roleOf,
    sortable: true,
    // Admin is the live state on this screen, so it takes the blue pill and every other
    // role stays neutral. The mapping is here, in the screen that knows what the values
    // mean, rather than inside StatusPill.
    cell: (user) => {
      const role = roleOf(user);

      return (
        <StatusPill label={role} tone={role === "admin" ? "open" : "neutral"} />
      );
    },
  },
  {
    id: "verified",
    header: "Verified",
    // No `cell`: DataTable renders a boolean as Yes/No, so the column needs no renderer.
    value: (user) => user.emailVerified,
    sortable: true,
  },
  {
    id: "created",
    header: "Created",
    // A Date, not the raw string: it is what sorts correctly and what DataTable formats
    // for the cell.
    value: (user) => new Date(user.createdAt),
    sortable: true,
    align: "end",
  },
];

function Users() {
  // The loader already resolved this, so `data` is present on the first render.
  const { data } = useQuery(usersQuery);

  // Both pieces of screen state live here, not in a primitive. FilterChips reports a
  // press and DataTable reports a click; deciding what either means is this route's job,
  // which is what keeps the primitives reusable by the next screen.
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const users = useMemo(() => data?.users ?? [], [data]);

  // Client side, over the rows already in the cache. The api caps its answer at 100 users
  // and takes no role parameter, so a chip press must not fire a request — it would come
  // back with the same page.
  const rows = useMemo(
    () =>
      roleFilter === "all"
        ? users
        : users.filter((user) => roleOf(user) === roleFilter),
    [users, roleFilter]
  );

  const chips = useMemo(
    () =>
      ROLE_FILTERS.map((filter) => ({
        id: filter.id,
        label: filter.label,
        count:
          filter.id === "all"
            ? users.length
            : users.filter((user) => roleOf(user) === filter.id).length,
      })),
    [users]
  );

  const selected = users.find((user) => user.id === selectedId);

  return (
    <PageLayout
      detailLabel={selected?.name}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.name || selected.email}
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[
              {
                label: "Role",
                value: (
                  <StatusPill
                    label={roleOf(selected)}
                    tone={roleOf(selected) === "admin" ? "open" : "neutral"}
                  />
                ),
              },
              { label: "Email", value: selected.email },
            ]}
            groups={[
              {
                id: "account",
                label: "Account",
                icon: IdCardIcon,
                items: [
                  { label: "Name", value: selected.name },
                  { label: "User id", value: selected.id },
                  {
                    label: "Created",
                    value: new Date(selected.createdAt).toLocaleString(),
                  },
                  {
                    label: "Updated",
                    value: new Date(selected.updatedAt).toLocaleString(),
                  },
                ],
              },
              {
                id: "access",
                label: "Access",
                icon: ShieldIcon,
                items: [
                  { label: "Role", value: roleOf(selected) },
                  {
                    label: "Email verified",
                    value: selected.emailVerified ? "Yes" : "No",
                  },
                ],
              },
            ]}
            // The second tab carries no content on purpose: the reference shows two tabs,
            // and the plan rules an AI panel out of this seed.
            tabs={[{ id: "activity", label: "Activity" }]}
          />
        )
      }
    >
      {/* `total` is the api's own count, not `rows.length` and not `users.length`. The
          route caps its answer at 100, so the loaded page and the real total can differ,
          and the header states the total. */}
      <PageHeader
        title="Users"
        count={data?.total}
        description="Accounts the api returns from GET /admin/users."
      />

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <FilterChips
          chips={chips}
          selectedId={roleFilter}
          label="Filter users by role"
          onSelect={(id) => {
            // The chips are literal ids, so this cast is over a value that came out of
            // ROLE_FILTERS; FilterChips itself stays generic over plain strings.
            setRoleFilter(id as RoleFilter);
          }}
        />
      </div>

      <DataTable
        caption="Users, with their role, verification state and creation date."
        columns={COLUMNS}
        rows={rows}
        rowId={(user) => user.id}
        selectedId={selectedId}
        onRowClick={(user) => {
          setSelectedId(user.id);
        }}
        emptyState={
          roleFilter === "all"
            ? "No users yet."
            : "No users with that role. Pick All to see every account."
        }
      />
    </PageLayout>
  );
}

// A 403 is a real answer here, not only a down api: the route is role-gated on the server
// as well as in the shell, so an account that lost its admin role sees this rather than an
// empty table.
function UsersError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader
        title="Users"
        description="The user list did not load."
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
          {error.message} GET /admin/users answers 403 unless the signed-in
          account has the admin role.
        </div>
      </div>
    </PageLayout>
  );
}
