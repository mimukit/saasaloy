import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { allows } from "@repo/auth/rbac-rules";
import type { PrincipalLike } from "@repo/auth/rbac-rules";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

import { RoleWorkspace } from "@admin/components/role-workspace";
import { tenantQuery } from "@admin/lib/tenant";

// `/roles` — the active organization's roles, and who holds them.
//
// It reads `GET /tenant` once and runs the SAME `can()` the api runs, from
// `@repo/auth/rbac-rules`. That file is import-free, so the browser gets the rule without
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

export const Route = createFileRoute("/roles")({
  loader: ({ context }) => context.queryClient.ensureQueryData(tenantQuery),
  component: Roles,
  errorComponent: RolesError,
});

function Roles() {
  const tenant = useQuery(tenantQuery);
  if (!tenant.data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-muted-foreground text-sm">Loading roles…</p>
      </main>
    );
  }

  // The api returns the principal as JSON, so the literal `kind` narrows back to the
  // union the rule file takes. `PrincipalLike` is structural on purpose: nothing here
  // imports the server's `Principal`, which names `TenantId` from `@repo/db`.
  const principal = tenant.data.principal as PrincipalLike;

  // `ac: ["create"]` is the statement Better Auth checks on `createRole`, `updateRole`
  // and `deleteRole`. One question, asked once, for every write control on the screen.
  const canManage = allows(principal, { ac: ["create"] });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Roles</h1>
        <p className="text-muted-foreground text-sm">
          Permissions for {tenant.data.organizationId}. Base roles are locked;
          custom roles are defined here and take effect on the next request.
        </p>
      </div>

      {canManage ? null : (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Read-only</CardTitle>
            <CardDescription>
              Your role does not hold ac:create in this organization, so the
              edit controls are hidden. Ask an owner to change a role for you.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <RoleWorkspace
        organization={{
          id: tenant.data.organizationId,
          name: "this organization",
        }}
        canManage={canManage}
      />
    </main>
  );
}

function RolesError({ error, reset }: ErrorComponentProps) {
  // `no active organization` is the fixed message from `@repo/auth/tenant`. It is the one
  // failure with an obvious next step, so it gets its own copy rather than the generic
  // "check that the api is running".
  const needsOrganization = error.message === "no active organization";
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {needsOrganization
              ? "No active organization"
              : "Roles did not load"}
          </CardTitle>
          <CardDescription>
            {needsOrganization
              ? "Choose an organization on the Teams screen, then come back."
              : `${error.message} Check that the api is running, then try again.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
