import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { UsersRoundIcon } from "lucide-react";
import { useState } from "react";

import { DataTable } from "@repo/ui/blocks/admin/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/admin/data-table";
import { DetailPanel } from "@repo/ui/blocks/admin/detail-panel";
import { EmptyState } from "@repo/ui/blocks/admin/empty-state";
import { ErrorState } from "@repo/ui/blocks/admin/error-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/admin/avatar";
import { Button } from "@repo/ui/components/admin/button";
import { StatusPill } from "@repo/ui/components/admin/status-pill";
import { toastManager } from "@repo/ui/components/admin/toast";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";
import { errors } from "@repo/ui/content/errors";

import { OrganizationCreateForm } from "@admin/components/organization-create-form";
import { OrganizationWorkspace } from "@admin/components/organization-workspace";
import { auth, forgetSession } from "@admin/lib/auth";
import { initialsOf } from "@admin/lib/initials";

// The teams screen, at `/teams`: the organizations the signed-in account belongs to, as a
// table, with the selected one open in a detail panel. It renders inside the page frame
// the root route provides, so it writes no padding of its own.
//
// "Active" is the session's organization, the one member and invitation actions use. The
// panel switches it, and only the active organization's panel carries the members and
// invitations workspace, because those calls act on the session's organization.
const organizationsQuery = queryOptions({
  queryKey: ["organizations"],
  queryFn: async () => {
    const result = await auth.organization.list();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.data ?? [];
  },
});

const sessionQuery = queryOptions({
  queryKey: ["session", "active-organization"],
  queryFn: async () => {
    const result = await auth.getSession();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.data ?? null;
  },
});

export const Route = createFileRoute("/teams")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(organizationsQuery),
      context.queryClient.ensureQueryData(sessionQuery),
    ]),
  component: Teams,
  errorComponent: TeamsError,
});

type Organization = Awaited<
  ReturnType<NonNullable<typeof organizationsQuery.queryFn>>
>[number];

// A table row is the organization plus whether it is the session's active one. The flag
// is folded in here because a column's `value` sees only its row, and the Status column
// needs to sort on it.
type OrganizationRow = Organization & { isActive: boolean };

// The active organization is the live one and takes the `ok` tone; every other one is
// simply not in use, so it stays neutral rather than reading as a fault.
function ActiveStatus({ active }: { active: boolean }) {
  return active ? (
    <StatusPill label="Active" tone="ok" />
  ) : (
    <StatusPill label="Not active" tone="neutral" />
  );
}

// The table's shape, at module scope, so it is a constant rather than an array rebuilt
// every render, and the `cell` renderers stay out of the render pass.
const COLUMNS: readonly DataTableColumn<OrganizationRow>[] = [
  {
    id: "name",
    header: "Name",
    value: (organization) => organization.name,
    sortable: true,
    cell: (organization) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="size-7">
          <AvatarFallback>{initialsOf(organization.name)}</AvatarFallback>
        </Avatar>
        <span className="truncate font-medium">{organization.name}</span>
      </div>
    ),
  },
  {
    id: "slug",
    header: "Slug",
    value: (organization) => organization.slug,
    sortable: true,
    cell: (organization) => (
      <code className="font-mono text-xs">{organization.slug}</code>
    ),
  },
  {
    id: "status",
    header: "Status",
    value: (organization) => organization.isActive,
    sortable: true,
    cell: (organization) => <ActiveStatus active={organization.isActive} />,
  },
  {
    id: "created",
    header: "Created",
    // better-auth hands back a Date, or an ISO string when the client skips date parsing.
    // `new Date` accepts both, and a Date is what sorts and formats correctly.
    value: (organization) => new Date(organization.createdAt),
    sortable: true,
    align: "end",
  },
];

function Teams() {
  const queryClient = useQueryClient();
  const organizations = useQuery(organizationsQuery);
  const session = useQuery(sessionQuery);
  const activeOrganizationId =
    session.data?.session.activeOrganizationId ?? null;

  // The selection is screen state, so it lives here and not in DataTable. It starts
  // empty: opening a panel on load would cover the list with a sheet below `md`.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows: OrganizationRow[] = (organizations.data ?? []).map(
    (organization) => ({
      ...organization,
      isActive: organization.id === activeOrganizationId,
    })
  );
  const selected = rows.find((organization) => organization.id === selectedId);

  const refreshOrganizations = async () => {
    forgetSession();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationsQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }),
    ]);
  };

  const switchOrganization = useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await auth.organization.setActive({ organizationId });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      toastManager.add({
        type: "success",
        title: "Active organization changed",
        description: "Member and invitation actions now use this organization.",
      });
      await refreshOrganizations();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The organization did not switch",
        description: error.message,
      });
    },
  });

  const closeDetail = () => {
    setSelectedId(null);
  };

  return (
    <PageLayout
      detailLabel={selected?.name}
      onDetailClose={closeDetail}
      detail={
        selected === undefined ? undefined : (
          <DetailPanel
            title={selected.name}
            description={selected.slug}
            media={
              <Avatar className="size-10">
                <AvatarFallback>{initialsOf(selected.name)}</AvatarFallback>
              </Avatar>
            }
            status={<ActiveStatus active={selected.isActive} />}
            onClose={closeDetail}
            attributes={[
              { label: "Slug", value: selected.slug },
              { label: "Organization id", value: selected.id },
              {
                label: "Created",
                value: new Date(selected.createdAt).toLocaleString(),
              },
            ]}
            actions={
              selected.isActive ? (
                // The `key` remounts the workspace when the active organization changes,
                // so a half-typed email or a minted invitation ID never carries over to a
                // different organization.
                <OrganizationWorkspace
                  key={selected.id}
                  organization={selected}
                />
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">
                    Use this organization before you manage its members and
                    invitations.
                  </p>
                  <Button
                    variant="outline"
                    className="self-start"
                    loading={switchOrganization.isPending}
                    onClick={() => {
                      switchOrganization.mutate(selected.id);
                    }}
                  >
                    Use organization
                  </Button>
                </>
              )
            }
          />
        )
      }
    >
      <PageHeader
        title="Teams"
        count={organizations.data?.length}
        description="Create organizations and manage the organizations you belong to."
        actions={<OrganizationCreateForm onCreated={refreshOrganizations} />}
      />

      <DataTable
        caption="Your organizations, with their slug, whether each is active, and when it was created."
        columns={COLUMNS}
        rows={rows}
        rowId={(organization) => organization.id}
        selectedId={selectedId}
        onRowClick={(organization) => {
          setSelectedId(organization.id);
        }}
        emptyState={
          <EmptyState
            icon={UsersRoundIcon}
            title="Create your first organization"
            description="The new organization becomes active after you create it. Use New organization above."
          />
        }
      />
    </PageLayout>
  );
}

// The router's default error screen would do, but this one keeps the page's header and
// names the likely cause: every call on this screen goes through better-auth on the api.
function TeamsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Teams" />
      <ErrorState
        code={errors.renderFailure.code}
        title="Teams did not load"
        description="Check that the api is running, then try again."
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
