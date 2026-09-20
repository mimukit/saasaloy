import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import type { PrincipalLike } from "@repo/auth/permission-rules";
import { ErrorState } from "@repo/ui/blocks/admin/error-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { PageSkeleton } from "@repo/ui/blocks/admin/page-skeleton";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";
import { errors } from "@repo/ui/content/errors";

import { ApiKeyWorkspace } from "@admin/components/api-key-workspace";
import { organizationQuery, tenantQuery } from "@admin/lib/tenant";

// `/api-keys` — the active organization's machine credentials.
//
// The same shape as `/roles`, and for the same reasons: it reads `GET /tenant` once and
// runs the same `can()` the api runs, from `@repo/auth/permission-rules`. There is no second
// permission implementation to drift, and `checkRolePermission` is not used because it
// cannot see a custom role.
//
// THE HIDE IS COSMETIC AND THE 403 IS THE GATE. Better Auth checks `apiKey: [action]` on
// every endpoint the workspace calls, and `apiKeyScopeGuard()` refuses an over-scoped
// request whatever the screen sent.
//
// The screen is scoped to the caller's active organization, behind the site-admin root
// guard, exactly as `/teams` and `/roles` are. An organization picker over the superadmin
// bypass is a filed follow-up.
//
// The route only resolves the caller. The whole page — header, key table, detail panel,
// create dialog — is the workspace's, because the header's count and its "New key"
// button both read state the workspace owns. It renders inside the root's page frame.

export const Route = createFileRoute("/api-keys")({
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
  component: ApiKeys,
  errorComponent: ApiKeysError,
});

function ApiKeys() {
  const tenant = useQuery(tenantQuery);
  const organization = useQuery({
    ...organizationQuery(tenant.data?.organizationId ?? ""),
    enabled: tenant.data !== undefined,
  });
  // The loader resolved both already, so the skeleton shows only if a cache entry was
  // dropped between the loader and the render. It is the router's pending look, reused.
  if (!tenant.data || !organization.data) {
    return <PageSkeleton />;
  }

  // The api returns the principal as JSON, so the literal `kind` narrows back to the
  // union the rule file takes. `PrincipalLike` is structural on purpose: nothing here
  // imports the server's `Principal`, which names `TenantId` from `@repo/db`.
  const principal = tenant.data.principal as PrincipalLike;

  return (
    <ApiKeyWorkspace
      organizationId={tenant.data.organizationId}
      organizationName={organization.data.name}
      principal={principal}
    />
  );
}

function ApiKeysError({ error, reset }: ErrorComponentProps) {
  // `no active organization` is the fixed message from `@repo/auth/tenant`. It is the one
  // failure with an obvious next step, so it gets its own copy rather than the generic
  // "check that the api is running". The router types `error` as unknown, so the message
  // is read only off a real Error.
  const message = error instanceof Error ? error.message : undefined;
  const needsOrganization = message === "no active organization";
  return (
    <PageLayout>
      <PageHeader title="API keys" />
      <ErrorState
        code={errors.renderFailure.code}
        title={
          needsOrganization ? "No active organization" : "API keys did not load"
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
        secondaryAction={null}
      />
    </PageLayout>
  );
}
