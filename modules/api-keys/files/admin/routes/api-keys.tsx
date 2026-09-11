import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import type { PrincipalLike } from "@repo/auth/rbac-rules";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

import { ApiKeyWorkspace } from "@admin/components/api-key-workspace";
import { tenantQuery } from "@admin/lib/tenant";

// `/api-keys` — the active organization's machine credentials.
//
// The same shape as `/roles`, and for the same reasons: it reads `GET /tenant` once and
// runs the same `can()` the api runs, from `@repo/auth/rbac-rules`. There is no second
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

export const Route = createFileRoute("/api-keys")({
  loader: ({ context }) => context.queryClient.ensureQueryData(tenantQuery),
  component: ApiKeys,
  errorComponent: ApiKeysError,
});

function ApiKeys() {
  const tenant = useQuery(tenantQuery);
  if (!tenant.data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-muted-foreground text-sm">Loading API keys…</p>
      </main>
    );
  }

  // The api returns the principal as JSON, so the literal `kind` narrows back to the
  // union the rule file takes. `PrincipalLike` is structural on purpose: nothing here
  // imports the server's `Principal`, which names `TenantId` from `@repo/db`.
  const principal = tenant.data.principal as PrincipalLike;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">API keys</h1>
        <p className="text-muted-foreground text-sm">
          Machine credentials for {tenant.data.organizationId}. A key carries a
          fixed scope, chosen when it is issued, and calls the api with{" "}
          <code>Authorization: Bearer</code>.
        </p>
      </div>

      <ApiKeyWorkspace
        organizationId={tenant.data.organizationId}
        principal={principal}
      />
    </main>
  );
}

function ApiKeysError({ error, reset }: ErrorComponentProps) {
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
              : "API keys did not load"}
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
