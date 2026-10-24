import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { allows } from "@repo/auth/permission-rules";
import type { PrincipalLike } from "@repo/auth/permission-rules";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { PageSkeleton } from "@repo/ui/blocks/shell/page-skeleton";
import { errors } from "@repo/ui/content/errors";

import { RoleWorkspace } from "@admin/components/role-workspace";
import { organizationQuery, tenantQuery } from "@admin/lib/tenant";

// `/roles` — the active organization's roles, and who holds them.
//
// It reads `GET /tenant` once and runs the SAME `can()` the api runs, from
// `@repo/auth/permission-rules`. That file is import-free, so the browser gets the rule without
// the auth instance behind it, and there is no second permission implementation to drift.
// `checkRolePermission` from the Better Auth client is deliberately not used: it knows the
// static roles only, so it answers wrongly for every custom role this screen exists to
// manage.
//
// THE HIDE IS COSMETIC AND THE 403 IS THE GATE. Every endpoint the workspace calls checks
// the `ac` statement itself, and `roleLockGuard()` refuses a base role name whatever
// arrives. Nothing here is load-bearing security.
//
// The screen is scoped to the caller's active organization, behind the site-admin root
// guard, exactly as `/teams` is. An organization picker over the superadmin bypass is a
// filed follow-up.
//
// The route decides `canManage` and nothing else. RoleWorkspace renders the whole page
// inside the frame the root route provides — the header, the tables, the detail panel and
// the create dialog — because the selection and every mutation live there.

export const Route = createFileRoute("/roles")({
  // The organization's name waits on the tenant's id, so the two reads run in turn. Both
  // land before the first render, and the header never shows an id or a placeholder.
  loader: async ({ context }) => {
    // oxlint-disable-next-line typescript/no-deprecated -- every admin loader reads its cache this way; moving to `query()` is one change across all of them
    const tenant = await context.queryClient.ensureQueryData(tenantQuery);
    // oxlint-disable-next-line typescript/no-deprecated -- as above
    await context.queryClient.ensureQueryData(
      organizationQuery(tenant.organizationId)
    );
  },
  component: Roles,
  errorComponent: RolesError,
});

function Roles() {
  const tenant = useQuery(tenantQuery);
  const organization = useQuery({
    ...organizationQuery(tenant.data?.organizationId ?? ""),
    enabled: tenant.data !== undefined,
  });
  // The loader resolved both, so the guard only covers a refetch that dropped the cache.
  // It shows the router's own skeleton rather than a sentence of its own.
  if (!tenant.data || !organization.data) {
    return <PageSkeleton />;
  }

  // The api returns the principal as JSON, so the literal `kind` narrows back to the
  // union the rule file takes. `PrincipalLike` is structural on purpose: nothing here
  // imports the server's `Principal`, which names `TenantId` from `@repo/db`.
  const principal = tenant.data.principal as PrincipalLike;

  // `ac: ["create"]` is the statement Better Auth checks on `createRole`, `updateRole`
  // and `deleteRole`. One question, asked once, for every write control on the screen.
  const canManage = allows(principal, { ac: ["create"] });

  return (
    <RoleWorkspace
      organization={{
        id: organization.data.id,
        name: organization.data.name,
      }}
      canManage={canManage}
    />
  );
}

function RolesError({ error, reset }: ErrorComponentProps) {
  // `no active organization` is the fixed message from `@repo/auth/tenant`. It is the one
  // failure with an obvious next step, so it gets its own copy rather than the generic
  // "check that the api is running". The router types `error` as `unknown`, so only a
  // real Error has a message to compare or show.
  const message = error instanceof Error ? error.message : undefined;
  const needsOrganization = message === "no active organization";
  return (
    <>
      <PageHeader title="Roles" />
      <ErrorState
        code={errors.renderFailure.code}
        title={
          needsOrganization ? "No active organization" : "Roles did not load"
        }
        description={
          needsOrganization
            ? "Choose an organization on the Teams screen, then come back."
            : "Check that the api is running, then try again."
        }
        detail={needsOrganization ? undefined : message}
        primaryAction={{
          label: errors.renderFailure.retryLabel,
          onClick: reset,
        }}
        // No link to /teams: that route belongs to the teams module, which this one
        // does not depend on, so the copy names the screen instead.
        secondaryAction={null}
      />
    </>
  );
}
