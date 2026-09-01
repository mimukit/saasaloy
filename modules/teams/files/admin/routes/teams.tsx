import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

import { OrganizationCreateForm } from "@admin/components/organization-create-form";
import { OrganizationWorkspace } from "@admin/components/organization-workspace";
import { auth, forgetSession } from "@admin/lib/auth";

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

function Teams() {
  const queryClient = useQueryClient();
  const organizations = useQuery(organizationsQuery);
  const session = useQuery(sessionQuery);
  const activeOrganizationId =
    session.data?.session.activeOrganizationId ?? null;
  const activeOrganization = organizations.data?.find(
    (organization) => organization.id === activeOrganizationId
  );

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
    onSuccess: refreshOrganizations,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Teams</h1>
        <p className="text-muted-foreground text-sm">
          Create organizations and manage the organizations you belong to.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Your organizations</CardTitle>
              <CardDescription>
                Choose the organization that member and invitation actions use.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {organizations.data?.length ? (
                <div className="grid gap-2">
                  {organizations.data.map((organization) => {
                    const isActive = organization.id === activeOrganizationId;
                    return (
                      <div
                        key={organization.id}
                        className="border-border flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {organization.name}
                            </p>
                            {isActive ? (
                              <Badge variant="secondary">Active</Badge>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">
                            {organization.slug}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 md:min-h-7"
                          disabled={isActive || switchOrganization.isPending}
                          onClick={() =>
                            switchOrganization.mutate(organization.id)
                          }
                        >
                          {isActive ? "Selected" : "Use organization"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border-border rounded-lg border border-dashed p-4 text-sm">
                  <p className="font-medium">Create your first organization</p>
                  <p className="text-muted-foreground mt-1">
                    The new organization becomes active after you create it.
                  </p>
                </div>
              )}
              {switchOrganization.error ? (
                <p className="text-destructive mt-3 text-sm" role="alert">
                  {switchOrganization.error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {activeOrganization ? (
            <OrganizationWorkspace organization={activeOrganization} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No active organization</CardTitle>
                <CardDescription>
                  Select an organization before you manage members and
                  invitations.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        <OrganizationCreateForm onCreated={refreshOrganizations} />
      </div>
    </main>
  );
}

function TeamsError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Teams did not load</CardTitle>
          <CardDescription>
            {error.message} Check that the api is running, then try again.
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
