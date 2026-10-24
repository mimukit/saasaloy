import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { IdCardIcon, ShieldIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Button } from "@repo/ui/components/shell/button";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";
import { useCommands } from "@repo/ui/lib/shell/commands";
import type { Command } from "@repo/ui/lib/shell/commands";

import { ADMIN_ROLE } from "@admin/lib/auth";
import { initialsOf } from "@admin/lib/initials";
import { usersQuery } from "@admin/lib/users-query";
import type { AdminUser } from "@admin/lib/users-query";

// The worked example of a real admin screen, at `/users`. It is the one place in the
// scaffold where every page block appears at once: a header with a count, a chip row, a
// sortable table with its empty state, a route-owned detail panel, and an error screen of
// its own. It renders inside the page frame the root route provides.
//
// `createFileRoute("/users")` is generated from this file's path under src/routes/ — the
// router plugin writes the id, so never rename the call by hand, and never hand-edit
// src/routeTree.gen.ts.
//
// This file is also what makes the "Users" row in NAV_AREAS type-check. Nav entries are
// checked against the generated route tree, so the row and the route arrive together or
// neither does. The request itself lives in src/lib/users-query.ts, because the overview
// reads it too.
export const Route = createFileRoute("/users")({
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery),
  component: Users,
  errorComponent: UsersError,
});

/**
 * The chips above the table. `all` is the resting state, so it is listed first. The admin
 * chip filters on `ADMIN_ROLE`, the string `config.auth.adminRole` holds, so a project
 * that renames the role keeps a working chip.
 */
const ROLE_FILTERS = [
  { id: "all", label: "All" },
  { id: ADMIN_ROLE, label: "Admins" },
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

/**
 * A verified address is the settled state and takes the `ok` tone; an unverified one is
 * waiting on the user, so it reads as `warn` (pending) rather than `bad`. The Verified
 * column and the panel's Access group both render it, so the rule lives once.
 */
function VerifiedStatus({ verified }: { verified: boolean }) {
  return verified ? (
    <StatusPill label="Verified" tone="ok" />
  ) : (
    <StatusPill label="Pending" tone="warn" />
  );
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
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="size-7">
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
    card: "trailing",
    value: roleOf,
    sortable: true,
    // Admin is the live state on this screen, so it takes the blue pill and every other
    // role stays neutral. The mapping is here, in the screen that knows what the values
    // mean, rather than inside StatusPill.
    cell: (user) => {
      const role = roleOf(user);

      return (
        <StatusPill
          label={role}
          tone={role === ADMIN_ROLE ? "open" : "neutral"}
        />
      );
    },
  },
  {
    id: "verified",
    header: "Verified",
    value: (user) => user.emailVerified,
    sortable: true,
    cell: (user) => <VerifiedStatus verified={user.emailVerified} />,
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

  // This page's commands. They drive the same state the chips and the panel's close
  // button do, and the palette lists them first, under "Users". Each one hides while it
  // would do nothing. With no `command` module installed, the call does nothing.
  //
  // Escape closes the panel through the table's `onDismiss` below: the table owns Escape
  // in its `data-table` scope, so a second Escape here would be a conflict. "Close user
  // details" stays as a palette row for a person who reaches the page by the palette.
  const commands: Command[] = [
    {
      id: "admin.show-admins",
      title: "Show admins",
      group: "page",
      keywords: ["filter", "role"],
      icon: ShieldIcon,
      when: () => roleFilter !== ADMIN_ROLE,
      run: () => {
        setRoleFilter(ADMIN_ROLE);
      },
    },
    {
      id: "admin.show-all-users",
      title: "Show all users",
      group: "page",
      keywords: ["filter", "clear"],
      icon: UsersIcon,
      when: () => roleFilter !== "all",
      run: () => {
        setRoleFilter("all");
      },
    },
    {
      id: "admin.close-user-details",
      title: "Close user details",
      group: "page",
      when: () => selectedId !== null,
      run: () => {
        setSelectedId(null);
      },
    },
  ];
  useCommands(commands, { scope: "route", label: "Users" });

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
            description={selected.email}
            media={
              <Avatar className="size-10">
                <AvatarFallback>{initialsOf(selected.name)}</AvatarFallback>
              </Avatar>
            }
            // The role is the record's status, so it sits in the header beside the name
            // rather than in an attribute row.
            status={
              <StatusPill
                label={roleOf(selected)}
                tone={roleOf(selected) === ADMIN_ROLE ? "open" : "neutral"}
              />
            }
            onClose={() => {
              setSelectedId(null);
            }}
            attributes={[{ label: "Email", value: selected.email }]}
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
                    value: <VerifiedStatus verified={selected.emailVerified} />,
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
      <PageHeader title="Users" count={data?.total} />

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
        <FilterChips
          chips={chips}
          selectedId={roleFilter}
          label="Filter users by role"
          onSelect={(id) => {
            // The chip ids all come out of ROLE_FILTERS, so this cast is over one of them;
            // FilterChips itself stays generic over plain strings.
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
        onDismiss={() => {
          setSelectedId(null);
        }}
        emptyState={
          roleFilter === "all" ? (
            <EmptyState
              icon={UsersIcon}
              title="No users yet"
              description="An account appears here as soon as someone signs up."
            />
          ) : (
            <EmptyState
              title="No users match this filter"
              description="Nobody has that role yet. Change a role from the user's detail panel."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRoleFilter("all");
                  }}
                >
                  Show all users
                </Button>
              }
            />
          )
        }
      />
    </PageLayout>
  );
}

// A 403 is a real answer here, not only a down api: the route is role-gated on the server
// as well as in the shell, so an account that lost its admin role sees this rather than an
// empty table. It is the worked example of a route overriding the router's default error
// component, which src/main.tsx sets for every other route.
function UsersError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Users" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The user list did not load"
        description="GET /admin/users answers 403 unless the signed-in account has the admin role, and 500 when the api fails."
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
