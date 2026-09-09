import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { BASE_ROLES, roles as baseRoles } from "@repo/auth/access";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import {
  PermissionGrid,
  togglePermission,
} from "@admin/components/permission-grid";
import type {
  PermissionMap,
  ReadonlyPermissionMap,
} from "@admin/components/permission-grid";
import { auth } from "@admin/lib/auth";

// The `/roles` screen's three panels: the locked base roles, the organization's custom
// roles, and the member list that assigns them.
//
// EVERY CONTROL HERE IS COSMETIC. `canManage` hides the create, edit, delete and assign
// controls from a caller `can()` refuses, and hiding is all it does — Better Auth checks
// the `ac` statement on every one of these endpoints, and `roleLockGuard()` refuses a base
// name whatever the screen sent. A build of this file with `canManage` hard-coded true
// would leak nothing.

interface OrganizationSummary {
  id: string;
  name: string;
}

/** A base role flattened out of `access.ts` for the read-only panel. */
const BASE_ROLE_ROWS = BASE_ROLES.map((name) => ({
  name,
  permission: baseRoles[name].statements satisfies ReadonlyPermissionMap,
}));

export function RoleWorkspace({
  organization,
  canManage,
}: {
  organization: OrganizationSummary;
  /** False hides every write control. The server refuses regardless. */
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePermission, setNewRolePermission] = useState<PermissionMap>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionMap>({});

  const rolesQuery = queryOptions({
    queryKey: ["organizations", organization.id, "roles"],
    queryFn: async () => {
      const result = await auth.organization.listRoles({
        query: { organizationId: organization.id },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result.data ?? [];
    },
  });
  const membersQuery = queryOptions({
    queryKey: ["organizations", organization.id, "members"],
    queryFn: async () => {
      const result = await auth.organization.listMembers({
        query: { organizationId: organization.id },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result.data?.members ?? [];
    },
  });

  const customRoles = useQuery(rolesQuery);
  const members = useQuery(membersQuery);

  /**
   * Who holds each role right now. `deleteRole` does NOT check for holders in
   * `better-auth@1.7.2`, and a member left holding a deleted name resolves to no
   * statements at all — a silent lockout rather than a demotion. So delete is disabled
   * while anyone holds the role, and the holders are named so the operator knows who to
   * reassign first.
   */
  const holdersOf = (role: string) =>
    (members.data ?? []).filter((member) => member.role === role);

  /**
   * The owners, counted for the last-owner rule. Better Auth refuses to demote the final
   * owner server-side; the select disables the option so the operator does not have to
   * read an error to learn it.
   */
  const ownerCount = (members.data ?? []).filter(
    (member) => member.role === "owner"
  ).length;

  const refreshRoles = () =>
    queryClient.invalidateQueries({ queryKey: rolesQuery.queryKey });

  const createRole = useMutation({
    mutationFn: async () => {
      const result = await auth.organization.createRole({
        organizationId: organization.id,
        role: newRoleName.trim(),
        permission: newRolePermission,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      setNewRoleName("");
      setNewRolePermission({});
      await refreshRoles();
    },
  });

  const updateRole = useMutation({
    mutationFn: async (roleName: string) => {
      const result = await auth.organization.updateRole({
        organizationId: organization.id,
        roleName,
        data: { permission: draft },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      setEditing(null);
      await refreshRoles();
    },
  });

  const deleteRole = useMutation({
    mutationFn: async (roleName: string) => {
      const result = await auth.organization.deleteRole({
        organizationId: organization.id,
        roleName,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: refreshRoles,
  });

  const assignRole = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string;
      role: string;
    }) => {
      const result = await auth.organization.updateMemberRole({
        organizationId: organization.id,
        memberId,
        role,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
    },
  });

  const submitNewRole = (event: FormEvent) => {
    event.preventDefault();
    createRole.mutate();
  };

  const assignableRoles = [
    ...BASE_ROLES,
    ...(customRoles.data ?? []).map((role) => role.role),
  ];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Base roles</CardTitle>
          <CardDescription>
            The three roles every organization starts with. They are locked:
            edit packages/auth/src/access.ts to change what they hold, and the
            change is reviewed like any other code.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {BASE_ROLE_ROWS.map((role) => (
            <div key={role.name} className="grid gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{role.name}</p>
                <Badge variant="secondary">Locked</Badge>
                <span className="text-muted-foreground text-xs">
                  {holdersOf(role.name).length} member(s)
                </span>
              </div>
              <PermissionGrid
                value={role.permission}
                idPrefix={`base-${role.name}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom roles</CardTitle>
          <CardDescription>
            Roles this organization defined at runtime. A custom role picks from
            the same resources the base roles use.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {customRoles.isPending ? (
            <p className="text-muted-foreground text-sm">Loading roles…</p>
          ) : null}
          {customRoles.data?.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed p-4 text-sm">
              <p className="font-medium">No custom roles yet</p>
              <p className="text-muted-foreground mt-1">
                Create one below to grant a narrower slice than member.
              </p>
            </div>
          ) : null}

          {customRoles.data?.map((role) => {
            const holders = holdersOf(role.role);
            const isEditing = editing === role.role;
            const permission: PermissionMap = role.permission ?? {};
            return (
              <div key={role.role} className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{role.role}</p>
                  <span className="text-muted-foreground text-xs">
                    {holders.length} member(s)
                  </span>
                  {canManage ? (
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 md:min-h-7"
                        onClick={() => {
                          setEditing(isEditing ? null : role.role);
                          setDraft(permission);
                        }}
                      >
                        {isEditing ? "Cancel" : "Edit"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 md:min-h-7"
                        // Held roles cannot be deleted: the plugin would delete it and
                        // leave every holder resolving to no permissions at all.
                        disabled={holders.length > 0 || deleteRole.isPending}
                        onClick={() => deleteRole.mutate(role.role)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                {holders.length > 0 && canManage ? (
                  <p className="text-muted-foreground text-xs">
                    Held by {holders.map((h) => h.user.email).join(", ")}.
                    Reassign them before deleting this role.
                  </p>
                ) : null}
                <PermissionGrid
                  value={isEditing ? draft : permission}
                  idPrefix={`role-${role.role}`}
                  onToggle={
                    isEditing
                      ? (resource, action) =>
                          setDraft((current) =>
                            togglePermission(current, resource, action)
                          )
                      : undefined
                  }
                  disabled={updateRole.isPending}
                />
                {isEditing ? (
                  <div>
                    <Button
                      size="sm"
                      className="min-h-11 md:min-h-7"
                      disabled={updateRole.isPending}
                      onClick={() => updateRole.mutate(role.role)}
                    >
                      Save permissions
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}

          {updateRole.error ? (
            <p className="text-destructive text-sm" role="alert">
              {updateRole.error.message}
            </p>
          ) : null}
          {deleteRole.error ? (
            <p className="text-destructive text-sm" role="alert">
              {deleteRole.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a role</CardTitle>
            <CardDescription>
              Pick a name and the permissions it holds. Owner, admin and member
              are refused: those three are locked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submitNewRole}>
              <div className="grid gap-2">
                <Label htmlFor="new-role-name">Role name</Label>
                <Input
                  id="new-role-name"
                  value={newRoleName}
                  placeholder="viewer"
                  onChange={(event) => setNewRoleName(event.target.value)}
                  required
                />
              </div>
              <PermissionGrid
                value={newRolePermission}
                idPrefix="new-role"
                disabled={createRole.isPending}
                onToggle={(resource, action) =>
                  setNewRolePermission((current) =>
                    togglePermission(current, resource, action)
                  )
                }
              />
              <div>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={
                    createRole.isPending ||
                    newRoleName.trim() === "" ||
                    // The client half of the lock. `roleLockGuard()` is the real one.
                    BASE_ROLES.some((name) => name === newRoleName.trim())
                  }
                >
                  Create role
                </Button>
              </div>
              {createRole.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {createRole.error.message}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Who holds which role in {organization.name}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {members.data?.map((member) => {
            const isLastOwner = member.role === "owner" && ownerCount <= 1;
            return (
              <div
                key={member.id}
                className="border-border flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.user.name || member.user.email}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {member.user.email}
                  </p>
                </div>
                {canManage ? (
                  <select
                    aria-label={`Role for ${member.user.email}`}
                    className="border-border min-h-11 rounded-lg border px-2 text-sm md:min-h-9"
                    value={member.role}
                    // The last owner cannot be demoted. Better Auth refuses it server-side
                    // too; disabling here saves the operator an error they cannot act on.
                    disabled={isLastOwner || assignRole.isPending}
                    onChange={(event) =>
                      assignRole.mutate({
                        memberId: member.id,
                        role: event.target.value,
                      })
                    }
                  >
                    {assignableRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">{member.role}</Badge>
                )}
              </div>
            );
          })}
          {assignRole.error ? (
            <p className="text-destructive text-sm" role="alert">
              {assignRole.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
