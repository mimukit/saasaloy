import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LockIcon, PlusIcon, ShieldIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { SubmitEvent } from "react";

import { BASE_ROLES, roles as baseRoles } from "@repo/auth/access";
import { DataTable } from "@repo/ui/blocks/admin/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/admin/data-table";
import { DetailPanel } from "@repo/ui/blocks/admin/detail-panel";
import { EmptyState } from "@repo/ui/blocks/admin/empty-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/admin/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/admin/alert-dialog";
import { Badge } from "@repo/ui/components/admin/badge";
import { Button } from "@repo/ui/components/admin/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/admin/dialog";
import { Field, FieldLabel } from "@repo/ui/components/admin/field";
import { Input } from "@repo/ui/components/admin/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/admin/select";
import { StatusPill } from "@repo/ui/components/admin/status-pill";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@repo/ui/components/admin/tabs";
import { toastManager } from "@repo/ui/components/admin/toast";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";

import {
  PERMISSION_COUNT,
  PermissionGrid,
  countHeld,
  togglePermission,
} from "@admin/components/permission-grid";
import type {
  PermissionMap,
  ReadonlyPermissionMap,
} from "@admin/components/permission-grid";
import { auth } from "@admin/lib/auth";

// The whole `/roles` page below the frame: the header with its "New role" action, a tab
// strip, the roles table with the selected role's detail panel, and the member table that
// assigns them. It renders PageLayout itself because the selection, the dialog and every
// mutation live here; the route only decides `canManage`.
//
// Base and custom roles share ONE table. A base role is a locked row whose panel shows its
// grid read-only; a custom role's panel carries the editor, the save and the delete. The
// permission grid stays this module's own component, inside the panel and the create
// dialog, because no admin primitive is a resource-by-action matrix.
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

/** One row of the roles table: a base role from `access.ts` or a custom one. */
interface RoleRow {
  /** `base:` or `custom:` plus the name, so the two kinds can never share a row id. */
  id: string;
  name: string;
  locked: boolean;
  permission: ReadonlyPermissionMap;
  /** The emails of the members holding this role right now. */
  holders: readonly string[];
}

/** What a member row's role picker needs. */
interface MemberAssignment {
  roles: readonly string[];
  disabled: boolean;
  onChange: (role: string) => void;
}

/** One row of the members table, flattened out of the plugin's member record. */
interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  /** The role picker's inputs, or `null` when the caller may not assign. */
  assignment: MemberAssignment | null;
}

/** A base role flattened out of `access.ts` for the locked rows. */
const BASE_ROLE_ROWS = BASE_ROLES.map((name) => ({
  name,
  permission: baseRoles[name].statements satisfies ReadonlyPermissionMap,
}));

const TAB_ROLES = "roles";
const TAB_MEMBERS = "members";

// The roles table's shape, at module scope: it reads only the row, so it is a constant
// rather than an array rebuilt every render.
const ROLE_COLUMNS: readonly DataTableColumn<RoleRow>[] = [
  {
    id: "name",
    header: "Role",
    value: (role) => role.name,
    sortable: true,
    cell: (role) => <span className="font-medium">{role.name}</span>,
  },
  {
    id: "kind",
    header: "Type",
    value: (role) => (role.locked ? "base" : "custom"),
    sortable: true,
    // A custom role is the thing this screen exists to manage, so it takes the blue pill;
    // a base role is fixed in code and stays neutral, with the lock beside it.
    cell: (role) =>
      role.locked ? (
        <Badge variant="secondary">
          <LockIcon />
          Base
        </Badge>
      ) : (
        <StatusPill label="custom" tone="open" />
      ),
  },
  {
    id: "permissions",
    header: "Permissions",
    value: (role) => countHeld(role.permission),
    sortable: true,
    align: "end",
    cell: (role) => (
      <span className="tabular-nums">
        {countHeld(role.permission)} of {PERMISSION_COUNT}
      </span>
    ),
  },
  {
    id: "members",
    header: "Members",
    value: (role) => role.holders.length,
    sortable: true,
    align: "end",
    cell: (role) => <span className="tabular-nums">{role.holders.length}</span>,
  },
];

// The members table's shape. The role cell reads the picker's inputs off the row, so no
// column needs the screen's state and no component is defined during render.
const MEMBER_COLUMNS: readonly DataTableColumn<MemberRow>[] = [
  {
    id: "name",
    header: "Name",
    value: (member) => member.name,
    sortable: true,
    cell: (member) => <span className="font-medium">{member.name}</span>,
  },
  {
    id: "email",
    header: "Email",
    value: (member) => member.email,
    sortable: true,
  },
  {
    id: "role",
    header: "Role",
    value: (member) => member.role,
    sortable: true,
    cell: (member) =>
      member.assignment === null ? (
        <Badge variant="secondary">{member.role}</Badge>
      ) : (
        <MemberRoleSelect
          role={member.role}
          email={member.email}
          {...member.assignment}
        />
      ),
  },
];

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionMap>({});
  const [tab, setTab] = useState<string>(TAB_ROLES);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
   * The owners, counted for the last-owner rule. Better Auth refuses to demote the final
   * owner server-side; the select disables itself so the operator does not have to read
   * an error to learn it.
   */
  const ownerCount = (members.data ?? []).filter(
    (member) => member.role === "owner"
  ).length;

  const refreshRoles = async () => {
    await queryClient.invalidateQueries({ queryKey: rolesQuery.queryKey });
  };

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
      toastManager.add({
        type: "success",
        title: "Role created",
        description: `${newRoleName.trim()} can now be assigned to a member.`,
      });
      setNewRoleName("");
      setNewRolePermission({});
      setCreateOpen(false);
      await refreshRoles();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The role was not created",
        description: error.message,
      });
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
    onSuccess: async (_data, roleName) => {
      toastManager.add({
        type: "success",
        title: "Permissions saved",
        description: `${roleName} takes the new permissions on the next request.`,
      });
      setEditing(null);
      await refreshRoles();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The permissions were not saved",
        description: error.message,
      });
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
    onSuccess: async (_data, roleName) => {
      toastManager.add({
        type: "success",
        title: "Role deleted",
        description: `${roleName} is gone from this organization.`,
      });
      // The row is about to leave the table, so its panel closes with it.
      setSelectedId(null);
      setEditing(null);
      await refreshRoles();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The role was not deleted",
        description: error.message,
      });
    },
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
    onSuccess: async (_data, { role }) => {
      toastManager.add({
        type: "success",
        title: "Role changed",
        description: `The member now holds ${role}.`,
      });
      await queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The role was not changed",
        description: error.message,
      });
    },
  });

  const submitNewRole = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    createRole.mutate();
  };

  const assignableRoles = [
    ...BASE_ROLES,
    ...(customRoles.data ?? []).map((role) => role.role),
  ];

  // Base rows first, in `access.ts` order, then the custom ones. The holder emails are
  // folded into the row so the table and the panel read the same list.
  const roleRows = useMemo<readonly RoleRow[]>(() => {
    /**
     * Who holds each role right now. `deleteRole` does NOT check for holders in
     * `better-auth@1.7.2`, and a member left holding a deleted name resolves to no
     * statements at all — a silent lockout rather than a demotion. So delete is disabled
     * while anyone holds the role, and the holders are named so the operator knows who to
     * reassign first.
     */
    const holderEmails = (role: string) =>
      (members.data ?? [])
        .filter((member) => member.role === role)
        .map((member) => member.user.email);
    return [
      ...BASE_ROLE_ROWS.map((role) => ({
        id: `base:${role.name}`,
        name: role.name,
        locked: true,
        permission: role.permission,
        holders: holderEmails(role.name),
      })),
      ...(customRoles.data ?? []).map((role) => ({
        id: `custom:${role.role}`,
        name: role.role,
        locked: false,
        permission: (role.permission ?? {}) satisfies PermissionMap,
        holders: holderEmails(role.role),
      })),
    ];
  }, [customRoles.data, members.data]);

  // Each row carries its own role picker's inputs — the roles on offer, whether it is
  // locked, what a pick does — so the column shape below can stay at module scope while
  // the cell still reads the screen's state. `null` is the read-only caller's badge.
  const memberRows: readonly MemberRow[] = (members.data ?? []).map(
    (member) => ({
      id: member.id,
      name: member.user.name || member.user.email,
      email: member.user.email,
      role: member.role,
      assignment: canManage
        ? {
            roles: assignableRoles,
            // The last owner cannot be demoted. Better Auth refuses it server-side
            // too; disabling here saves the operator an error they cannot act on.
            disabled:
              (member.role === "owner" && ownerCount <= 1) ||
              assignRole.isPending,
            onChange: (role: string) => {
              assignRole.mutate({ memberId: member.id, role });
            },
          }
        : null,
    })
  );

  const selected = roleRows.find((role) => role.id === selectedId);

  const closePanel = () => {
    setSelectedId(null);
    setEditing(null);
  };

  return (
    <PageLayout
      detailLabel={selected?.name}
      onDetailClose={closePanel}
      detail={
        selected === undefined ? undefined : (
          <RolePanel
            role={selected}
            canManage={canManage}
            isEditing={editing === selected.name}
            draft={draft}
            saving={updateRole.isPending}
            saveError={updateRole.error?.message}
            deleting={deleteRole.isPending}
            onClose={closePanel}
            onEdit={() => {
              const isEditing = editing === selected.name;
              setEditing(isEditing ? null : selected.name);
              setDraft(
                customRoles.data?.find((role) => role.role === selected.name)
                  ?.permission ?? {}
              );
            }}
            onToggle={(resource, action) => {
              setDraft((current) =>
                togglePermission(current, resource, action)
              );
            }}
            onSave={() => {
              updateRole.mutate(selected.name);
            }}
            onDelete={() => {
              deleteRole.mutate(selected.name);
            }}
          />
        )
      }
    >
      {/* The count waits for the custom roles: a header reading "3" that jumps to "5" a
          moment later would be stating a number it did not have yet. */}
      <PageHeader
        title="Roles"
        count={customRoles.isPending ? undefined : roleRows.length}
        description={`Permissions for ${organization.name}. Base roles are locked; custom roles take effect on the next request.`}
        actions={
          canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <PlusIcon />
              New role
            </Button>
          ) : undefined
        }
      />

      {canManage ? null : (
        <div className="border-border shrink-0 border-b px-(--page-gutter) py-3">
          {/* `status`, not the Alert's default `alert`: this is a standing fact about the
              caller's role, not something that just went wrong. */}
          <Alert variant="info" role="status">
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Your role does not hold ac:create in this organization, so the
              edit controls are hidden. Ask an owner to change a role for you.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(next: string) => {
          setTab(next);
          // The panel belongs to the roles table; it does not follow the visitor into
          // the members tab.
          closePanel();
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-border flex shrink-0 items-center gap-3 border-b px-(--page-gutter) py-2">
          <TabsList>
            <TabsTab value={TAB_ROLES}>Roles</TabsTab>
            <TabsTab value={TAB_MEMBERS}>
              Members
              {members.data === undefined ? null : (
                <span className="text-muted-foreground tabular-nums">
                  {members.data.length}
                </span>
              )}
            </TabsTab>
          </TabsList>
          {customRoles.isPending ? (
            <span className="text-muted-foreground text-xs">
              Loading custom roles…
            </span>
          ) : null}
        </div>

        <TabsPanel value={TAB_ROLES} className="flex min-h-0 flex-1 flex-col">
          <DataTable
            caption="Roles in this organization, with their type, the permissions they hold and how many members hold them."
            columns={ROLE_COLUMNS}
            rows={roleRows}
            rowId={(role) => role.id}
            selectedId={selectedId}
            onRowClick={(role) => {
              setSelectedId(role.id);
              setEditing(null);
            }}
            // The three base roles are always rows, so this shows only if `access.ts`
            // declares none.
            emptyState={
              <EmptyState
                icon={ShieldIcon}
                title="No roles to show"
                description="packages/auth/src/access.ts declares the base roles. Add one there to see it here."
              />
            }
          />
          {customRoles.data?.length === 0 ? (
            <p className="border-border text-muted-foreground shrink-0 border-t px-(--page-gutter) py-3 text-sm">
              No custom roles yet.{" "}
              {canManage
                ? "Use New role to grant a narrower slice than member."
                : "An owner can create one to grant a narrower slice than member."}
            </p>
          ) : null}
        </TabsPanel>

        <TabsPanel value={TAB_MEMBERS} className="flex min-h-0 flex-1 flex-col">
          <DataTable
            caption={`Who holds which role in ${organization.name}.`}
            columns={MEMBER_COLUMNS}
            rows={memberRows}
            rowId={(member) => member.id}
            emptyState={
              members.isPending ? (
                <EmptyState icon={UsersIcon} title="Loading members…" />
              ) : (
                <EmptyState
                  icon={UsersIcon}
                  title="No members yet"
                  description={`A member appears here once they join ${organization.name}.`}
                />
              )
            }
          />
        </TabsPanel>
      </Tabs>

      {canManage ? (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogPopup>
            <form className="flex min-h-0 flex-col" onSubmit={submitNewRole}>
              <DialogHeader>
                <DialogTitle>New role</DialogTitle>
                <DialogDescription>
                  Pick a name and the permissions it holds. Owner, admin and
                  member are refused: those three are locked.
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="grid gap-4">
                <Field>
                  <FieldLabel>Role name</FieldLabel>
                  <Input
                    value={newRoleName}
                    placeholder="viewer"
                    onChange={(event) => {
                      setNewRoleName(event.target.value);
                    }}
                    required
                  />
                </Field>
                <PermissionGrid
                  value={newRolePermission}
                  idPrefix="new-role"
                  disabled={createRole.isPending}
                  onToggle={(resource, action) => {
                    setNewRolePermission((current) =>
                      togglePermission(current, resource, action)
                    );
                  }}
                />
                {createRole.error ? (
                  <p
                    className="text-destructive-foreground text-sm"
                    role="alert"
                  >
                    {createRole.error.message}
                  </p>
                ) : null}
              </DialogPanel>
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" />}>
                  Cancel
                </DialogClose>
                <Button
                  type="submit"
                  loading={createRole.isPending}
                  disabled={
                    createRole.isPending ||
                    newRoleName.trim() === "" ||
                    // The client half of the lock. `roleLockGuard()` is the real one.
                    BASE_ROLES.some((name) => name === newRoleName.trim())
                  }
                >
                  Create role
                </Button>
              </DialogFooter>
            </form>
          </DialogPopup>
        </Dialog>
      ) : null}
    </PageLayout>
  );
}

/**
 * The selected role's panel: who holds it, its permission grid, and — for a custom role a
 * caller may manage — the edit, save and delete controls. It holds no state; the
 * workspace owns the draft and every mutation.
 */
function RolePanel({
  role,
  canManage,
  isEditing,
  draft,
  saving,
  saveError,
  deleting,
  onClose,
  onEdit,
  onToggle,
  onSave,
  onDelete,
}: {
  role: RoleRow;
  canManage: boolean;
  isEditing: boolean;
  draft: PermissionMap;
  saving: boolean;
  saveError: string | undefined;
  deleting: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggle: (resource: string, action: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const editable = canManage && !role.locked;
  const held = role.holders.length > 0;

  return (
    <DetailPanel
      title={role.name}
      description={role.locked ? "Base role, locked" : "Custom role"}
      onClose={onClose}
      attributes={[
        {
          label: "Type",
          value: role.locked ? (
            <Badge variant="secondary">
              <LockIcon />
              Base
            </Badge>
          ) : (
            <StatusPill label="custom" tone="open" />
          ),
        },
        {
          label: "Permissions",
          value: `${countHeld(role.permission)} of ${PERMISSION_COUNT}`,
        },
        { label: "Held by", value: role.holders.join(", ") },
      ]}
      actions={
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-medium">Permissions</p>
            {editable ? (
              <Button variant="outline" size="sm" onClick={onEdit}>
                {isEditing ? "Cancel" : "Edit"}
              </Button>
            ) : null}
          </div>

          {role.locked ? (
            <p className="text-muted-foreground text-xs">
              Edit packages/auth/src/access.ts to change what this role holds,
              and the change is reviewed like any other code.
            </p>
          ) : null}

          <PermissionGrid
            value={isEditing ? draft : role.permission}
            idPrefix={`${role.locked ? "base" : "role"}-${role.name}`}
            onToggle={isEditing ? onToggle : undefined}
            disabled={saving}
          />

          {isEditing ? (
            <Button
              size="sm"
              className="self-start"
              loading={saving}
              disabled={saving}
              onClick={onSave}
            >
              Save permissions
            </Button>
          ) : null}
          {saveError === undefined ? null : (
            <p className="text-destructive-foreground text-sm" role="alert">
              {saveError}
            </p>
          )}

          {editable ? (
            <div className="border-border flex flex-col gap-2 border-t pt-3">
              {held ? (
                <p className="text-muted-foreground text-xs">
                  Held by {role.holders.join(", ")}. Reassign them before
                  deleting this role.
                </p>
              ) : null}
              <AlertDialog>
                <AlertDialogTrigger
                  // Held roles cannot be deleted: the plugin would delete it and leave
                  // every holder resolving to no permissions at all.
                  disabled={held || deleting}
                  render={
                    <Button
                      variant="destructive-outline"
                      size="sm"
                      className="self-start"
                    />
                  }
                >
                  Delete role
                </AlertDialogTrigger>
                <AlertDialogPopup>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Nobody holds this role, so no member loses access. A
                      deleted role is not restored; create it again to bring it
                      back.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="ghost" />}>
                      Cancel
                    </AlertDialogClose>
                    <AlertDialogClose
                      render={<Button variant="destructive" />}
                      onClick={onDelete}
                    >
                      Delete role
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogPopup>
              </AlertDialog>
            </div>
          ) : null}
        </>
      }
    />
  );
}

/** The role picker in a member's row. Picking a role assigns it at once, as before. */
function MemberRoleSelect({
  role,
  email,
  roles,
  disabled,
  onChange,
}: MemberAssignment & {
  /** The role the member holds now. */
  role: string;
  email: string;
}) {
  return (
    <Select
      value={role}
      disabled={disabled}
      onValueChange={(next: string | null) => {
        if (next !== null && next !== role) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Role for ${email}`}
        className="w-40"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {roles.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
