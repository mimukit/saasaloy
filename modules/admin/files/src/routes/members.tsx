import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  PlusIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@repo/ui/components/shell/alert-dialog";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import { Checkbox } from "@repo/ui/components/shell/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/shell/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import { Label } from "@repo/ui/components/shell/label";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/shell/select";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { Tabs, TabsList, TabsTab } from "@repo/ui/components/shell/tabs";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";
import { useCommands } from "@repo/ui/lib/shell/commands";
import type { Command } from "@repo/ui/lib/shell/commands";

import {
  ACTIVITY_KEY,
  agoLabel,
  dateLabel,
  whenLabel,
} from "@admin/lib/activity";
import { memberActivityQuery } from "@admin/lib/activity-query";
import { api } from "@admin/lib/api";
import { ADMIN_ROLE, SUPERADMIN_ROLE } from "@admin/lib/auth";
import { initialsOf } from "@admin/lib/initials";
import { failureMessage, membersQuery } from "@admin/lib/members-query";
import type {
  ActiveMember,
  RemovedMember,
  Viewer,
} from "@admin/lib/members-query";

// The Members screen at `/members`: the admin group, the people who sign in to this app.
// Users lists every account; this screen manages the admin group only.
//
// Two tabs, Active and Removed. Removing a member bans the account rather than deleting
// it, so their audit rows keep naming a real person, and a superadmin restores them from
// the Removed tab with the same account and password. The Removed tab's date and name
// come from the `member.remove` audit row.
//
// Who may do what is the api's rule (`apps/api/src/routes/admin-members.ts`), and this
// screen only hides what the api would refuse: a member changes their own name and
// password; a superadmin also adds members, resets another member's password, and
// removes and restores members. Every save reports in a toast, and the remove asks
// first in an alert dialog.

export const Route = createFileRoute("/members")({
  loader: ({ context }) => context.queryClient.ensureQueryData(membersQuery),
  component: Members,
  errorComponent: MembersError,
});

type Tab = "active" | "removed";

type DialogKind = "add" | "name" | "password" | "reset" | "remove";

const ROLE_ITEMS = [
  { label: "Admin", value: ADMIN_ROLE },
  { label: "Superadmin", value: SUPERADMIN_ROLE },
];

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function RolePill({ role }: { role: string }) {
  return <StatusPill label={role} tone="open" />;
}

function PersonCell({
  name,
  email,
  you,
}: {
  name: string;
  email: string;
  you: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span dir="auto" title={name} className="truncate font-medium">
            {name}
          </span>
          {you ? (
            <Badge variant="outline" size="sm">
              You
            </Badge>
          ) : null}
        </span>
        <span
          dir="auto"
          title={email}
          className="text-muted-foreground truncate text-xs"
        >
          {email}
        </span>
      </div>
    </div>
  );
}

function activeColumns(
  viewerId: string
): readonly DataTableColumn<ActiveMember>[] {
  return [
    {
      id: "name",
      header: "Name",
      value: (member) => member.name,
      sortable: true,
      cell: (member) => (
        <PersonCell
          name={member.name}
          email={member.email}
          you={member.id === viewerId}
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      card: "trailing",
      value: (member) => member.role,
      sortable: true,
      cell: (member) => <RolePill role={member.role} />,
    },
    {
      id: "added",
      header: "Added",
      value: (member) => new Date(member.createdAt),
      sortable: true,
      cell: (member) => dateLabel(member.createdAt),
    },
    {
      id: "signed-in",
      header: "Last sign-in",
      value: (member) =>
        member.lastSignInAt === null ? null : new Date(member.lastSignInAt),
      sortable: true,
      // A dash, not "Never": Better Auth deletes a session at sign-out, so no open
      // session does not mean the member never signed in.
      cell: (member) =>
        member.lastSignInAt === null
          ? "–"
          : whenLabel(member.lastSignInAt, new Date(), { withTime: false }),
    },
  ];
}

function removedColumns(
  onRestore: ((member: RemovedMember) => void) | null,
  restoring: string | null
): readonly DataTableColumn<RemovedMember>[] {
  const columns: DataTableColumn<RemovedMember>[] = [
    {
      id: "name",
      header: "Name",
      value: (member) => member.name,
      sortable: true,
      cell: (member) => (
        <PersonCell name={member.name} email={member.email} you={false} />
      ),
    },
    {
      id: "role",
      header: "Role",
      value: (member) => member.role,
      cell: (member) => <RolePill role={member.role} />,
    },
    {
      id: "removed",
      header: "Removed",
      value: (member) => new Date(member.removedAt),
      sortable: true,
      cell: (member) => whenLabel(member.removedAt, new Date()),
    },
    {
      id: "removed-by",
      header: "Removed by",
      value: (member) => member.removedBy,
      sortable: true,
      cell: (member) =>
        member.removedBy === null ? null : (
          <span dir="auto">{member.removedBy}</span>
        ),
    },
  ];
  if (onRestore !== null) {
    columns.push({
      id: "restore",
      header: <span className="sr-only">Restore</span>,
      align: "end",
      value: () => null,
      cell: (member) => (
        <Button
          variant="outline"
          size="sm"
          disabled={restoring === member.id}
          // Each row's button names its member, so a screen reader's button list tells
          // two removed members apart.
          aria-label={`Restore ${member.name}`}
          onClick={(event) => {
            // The button restores; it does not also select the row.
            event.stopPropagation();
            onRestore(member);
          }}
        >
          Restore
        </Button>
      ),
    });
  }
  return columns;
}

/** One block of the detail panel: a small heading, a line of help, and its controls. */
function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border flex flex-col items-start gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function RecentActivity({ member }: { member: ActiveMember }) {
  const { data, dataUpdatedAt, isPending, isError } = useQuery(
    memberActivityQuery(member.id)
  );
  // The fetch time, not `Date.now()`, so the render stays pure.
  const now = new Date(dataUpdatedAt);
  let body: ReactNode;
  if (isPending) {
    body = <p className="text-muted-foreground text-sm">Loading…</p>;
  } else if (isError) {
    body = (
      <p className="text-muted-foreground text-sm">
        The recent activity did not load.
      </p>
    );
  } else if (data.events.length === 0) {
    body = <p className="text-muted-foreground text-sm">No changes yet.</p>;
  } else {
    body = (
      <ul className="flex flex-col gap-1.5 text-sm">
        {data.events.map((event) => (
          <li key={event.id} className="text-muted-foreground">
            {event.label}{" "}
            <span dir="auto" className="text-foreground font-medium">
              {event.target.label}
            </span>{" "}
            · {agoLabel(event.createdAt, now)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <PanelSection title="Recent activity">
      {body}
      <Link
        to="/activity"
        search={{ actor: member.id }}
        className="flex items-center gap-1 text-sm font-medium hover:underline"
      >
        View all in Activity
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </PanelSection>
  );
}

function MemberDetail({
  member,
  viewer,
  now,
  onClose,
  onOpen,
}: {
  member: ActiveMember;
  viewer: Viewer;
  /** When the list was fetched, so the render stays pure. */
  now: Date;
  onClose: () => void;
  onOpen: (dialog: DialogKind) => void;
}) {
  const own = member.id === viewer.id;
  const superadmin = viewer.role === SUPERADMIN_ROLE;
  const first = firstName(member.name);
  const added = dateLabel(member.createdAt);

  return (
    <DetailPanel
      title={member.name}
      description={
        <span dir="auto" title={member.email}>
          {member.email}
        </span>
      }
      media={
        <Avatar className="size-10">
          <AvatarFallback>{initialsOf(member.name)}</AvatarFallback>
        </Avatar>
      }
      onClose={onClose}
      attributes={[
        { label: "Role", value: <RolePill role={member.role} /> },
        {
          label: "Added",
          value:
            member.addedBy === null ? added : `${added} by ${member.addedBy}`,
        },
        ...(own
          ? []
          : [
              {
                label: "Last sign-in",
                value:
                  member.lastSignInAt === null
                    ? null
                    : whenLabel(member.lastSignInAt, now),
              },
            ]),
      ]}
      actions={
        own ? (
          <>
            <PanelSection title="Your profile">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpen("name");
                }}
              >
                Edit name
              </Button>
            </PanelSection>
            <PanelSection title="Password">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpen("password");
                }}
              >
                Change password
              </Button>
              {superadmin ? null : (
                <p className="text-muted-foreground text-xs">
                  Only a superadmin can remove a member or reset another
                  member&apos;s password.
                </p>
              )}
            </PanelSection>
          </>
        ) : (
          <>
            {superadmin ? (
              <PanelSection title="Password">
                <p className="text-muted-foreground text-sm">
                  Set a new password for {first}. Their open sessions end.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpen("reset");
                  }}
                >
                  Reset password
                </Button>
              </PanelSection>
            ) : null}
            <RecentActivity member={member} />
            {superadmin ? (
              <PanelSection title="Remove">
                <p className="text-muted-foreground text-sm">
                  {first} can no longer sign in. You can restore them later.
                </p>
                <Button
                  variant="destructive-outline"
                  size="sm"
                  onClick={() => {
                    onOpen("remove");
                  }}
                >
                  Remove member
                </Button>
              </PanelSection>
            ) : (
              <p className="text-muted-foreground text-xs">
                Only a superadmin can remove a member or reset another
                member&apos;s password.
              </p>
            )}
          </>
        )
      }
    />
  );
}

// Each dialog keeps its fields in a child of the popup. The popup unmounts when the dialog
// closes, so the next open starts empty with no reset to remember.

function FormDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogPopup>{children}</DialogPopup>
    </Dialog>
  );
}

function FormError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}

/** The 409 answer for the email of a removed member. */
interface RemovedMatch {
  id: string;
  name: string;
  email: string;
  removedAt: string;
}

type AddResult =
  { kind: "added"; name: string } | { kind: "removed"; member: RemovedMatch };

function AddMemberForm({
  viewer,
  onDone,
  onRestore,
}: {
  viewer: Viewer;
  onDone: (name: string) => Promise<void>;
  onRestore: (member: RemovedMatch) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>(ADMIN_ROLE);
  const [match, setMatch] = useState<RemovedMatch | null>(null);
  const superadmin = viewer.role === SUPERADMIN_ROLE;
  const roles = superadmin
    ? ROLE_ITEMS
    : ROLE_ITEMS.filter((item) => item.value !== SUPERADMIN_ROLE);

  const add = useMutation({
    mutationFn: async (): Promise<AddResult> => {
      const res = await api.admin.members.$post({
        json: { email, name, password, role },
      });
      if (res.status === 201) {
        return { kind: "added", name };
      }
      if (res.status === 409) {
        const body = (await res.json()) as {
          error: { code: string; message: string };
          member?: RemovedMatch;
        };
        if (body.error.code === "member_removed" && body.member) {
          return { kind: "removed", member: body.member };
        }
        throw new Error(body.error.message);
      }
      throw new Error(await failureMessage(res, "The member was not added."));
    },
    onSuccess: async (result) => {
      if (result.kind === "removed") {
        setMatch(result.member);
        return;
      }
      await onDone(result.name);
    },
  });

  if (match !== null) {
    return (
      <div className="flex min-h-0 flex-col">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid gap-2">
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input value={match.email} readOnly aria-invalid />
          </Field>
          <p className="text-destructive text-sm" role="alert">
            {match.name} was removed on {dateLabel(match.removedAt)}.{" "}
            {superadmin
              ? "Restore them instead of adding a new account."
              : "Ask a superadmin to restore them."}
          </p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          {superadmin ? (
            <Button
              onClick={() => {
                onRestore(match);
              }}
            >
              Restore {firstName(match.name)}
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add member</DialogTitle>
        <DialogDescription>
          They sign in to this admin app with the email and password you set.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            required
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <FieldDescription>
            At least 8 characters. Share it with them yourself.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Role</FieldLabel>
          <Select
            items={roles}
            value={role}
            onValueChange={(next: string | null) => {
              if (next !== null) {
                setRole(next);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {roles.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldDescription>
            Superadmin can add and remove members and reset their passwords.
          </FieldDescription>
        </Field>
        <FormError message={add.error?.message ?? null} />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add member"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditNameForm({
  member,
  onDone,
}: {
  member: ActiveMember;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(member.name);
  const save = useMutation({
    mutationFn: async () => {
      const res = await api.admin.members[":id"].$patch({
        json: { name },
        param: { id: member.id },
      });
      if (res.status !== 200) {
        throw new Error(await failureMessage(res, "The name was not saved."));
      }
    },
    onSuccess: onDone,
  });

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit name</DialogTitle>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <FormError message={save.error?.message ?? null} />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ChangePasswordForm({
  member,
  onDone,
}: {
  member: ActiveMember;
  onDone: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const change = useMutation({
    mutationFn: async () => {
      const res = await api.admin.members[":id"].password.$post({
        json: {
          currentPassword,
          newPassword,
          revokeOtherSessions: signOutOthers,
        },
        param: { id: member.id },
      });
      if (res.status !== 200) {
        throw new Error(
          await failureMessage(res, "The password was not changed.")
        );
      }
    },
    onSuccess: onDone,
  });

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        change.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Change password</DialogTitle>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Current password</FieldLabel>
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>New password</FieldLabel>
          <Input
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
          />
        </Field>
        {/* The Checkbox is a Base UI control, not an <input>, so the label wraps it. */}
        <Label className="gap-2 font-normal">
          <Checkbox
            checked={signOutOthers}
            onCheckedChange={(checked) => {
              setSignOutOthers(checked);
            }}
          />
          Sign out my other sessions
        </Label>
        <FormError message={change.error?.message ?? null} />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? "Changing…" : "Change password"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResetPasswordForm({
  member,
  onDone,
}: {
  member: ActiveMember;
  onDone: () => Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState("");
  const first = firstName(member.name);
  const reset = useMutation({
    mutationFn: async () => {
      const res = await api.admin.members[":id"].password.$post({
        json: { newPassword },
        param: { id: member.id },
      });
      if (res.status !== 200) {
        throw new Error(
          await failureMessage(res, "The password was not reset.")
        );
      }
    },
    onSuccess: onDone,
  });

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        reset.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Reset {first}&apos;s password</DialogTitle>
        <DialogDescription>
          {first}&apos;s open sessions end. Tell them the new password yourself.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>New password</FieldLabel>
          <Input
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
          />
        </Field>
        <FormError message={reset.error?.message ?? null} />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending ? "Resetting…" : "Reset password"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Members() {
  const queryClient = useQueryClient();
  const { data, dataUpdatedAt } = useQuery(membersQuery);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  const viewer = data?.me ?? { id: "", role: ADMIN_ROLE };
  const superadmin = viewer.role === SUPERADMIN_ROLE;
  const members = useMemo(() => data?.members ?? [], [data]);
  const removed = useMemo(() => data?.removed ?? [], [data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === ""
      ? members
      : members.filter(
          (member) =>
            member.name.toLowerCase().includes(needle) ||
            member.email.toLowerCase().includes(needle)
        );
  }, [members, search]);

  const selected =
    tab === "active"
      ? members.find((member) => member.id === selectedId)
      : undefined;

  /** Every write changes the list and adds a row to the log. */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: membersQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY }),
    ]);
  };

  const done = async (title: string) => {
    setDialog(null);
    toastManager.add({ title, type: "success" });
    await refresh();
  };

  const fail = (title: string, error: Error) => {
    toastManager.add({ description: error.message, title, type: "error" });
  };

  const remove = useMutation({
    mutationFn: async (member: ActiveMember) => {
      const res = await api.admin.members[":id"].$delete({
        param: { id: member.id },
      });
      if (res.status !== 200) {
        throw new Error(
          await failureMessage(res, "The member was not removed.")
        );
      }
      return member;
    },
    onError: (error) => {
      fail("The member was not removed", error);
    },
    onSuccess: async (member) => {
      setSelectedId(null);
      setTab("removed");
      await done(`${member.name} removed`);
    },
  });

  const restore = useMutation({
    mutationFn: async (member: { id: string; name: string }) => {
      const res = await api.admin.members[":id"].restore.$post({
        param: { id: member.id },
      });
      if (res.status !== 200) {
        throw new Error(
          await failureMessage(res, "The member was not restored.")
        );
      }
      return member;
    },
    onError: (error) => {
      fail("The member was not restored", error);
    },
    onSuccess: async (member) => {
      await done(`${member.name} restored`);
    },
  });

  const activeCols = useMemo(() => activeColumns(viewer.id), [viewer.id]);
  const removedCols = useMemo(
    () =>
      removedColumns(
        superadmin
          ? (member) => {
              restore.mutate(member);
            }
          : null,
        restore.isPending ? (restore.variables?.id ?? null) : null
      ),
    [superadmin, restore]
  );

  // "Add member" is a superadmin's alone. The rank guard refuses an admin any create
  // that grants an admin-group role, so an admin would only ever see a 403. The button and
  // its command are both left out for them, and the api's 403 stays the rule.
  const addCommand: Command[] = superadmin
    ? [
        {
          id: "admin.add-member",
          title: "Add member",
          group: "page",
          keywords: ["invite", "new"],
          icon: UserPlusIcon,
          run: () => {
            setDialog("add");
          },
        },
      ]
    : [];
  const commands: Command[] = [
    ...addCommand,
    {
      id: "admin.show-removed-members",
      title: "Show removed members",
      group: "page",
      when: () => tab !== "removed",
      run: () => {
        setTab("removed");
      },
    },
    {
      id: "admin.show-active-members",
      title: "Show active members",
      group: "page",
      when: () => tab !== "active",
      run: () => {
        setTab("active");
      },
    },
    {
      id: "admin.close-member-details",
      title: "Close member details",
      group: "page",
      when: () => selected !== undefined,
      run: () => {
        setSelectedId(null);
      },
    },
  ];
  useCommands(commands, { scope: "route", label: "Members" });

  const close = () => {
    setDialog(null);
  };

  return (
    <PageLayout
      detailLabel={selected?.name}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <>
            <MemberDetail
              member={selected}
              viewer={viewer}
              now={new Date(dataUpdatedAt)}
              onClose={() => {
                setSelectedId(null);
              }}
              onOpen={setDialog}
            />
            <FormDialog open={dialog === "name"} onClose={close}>
              <EditNameForm
                member={selected}
                onDone={() => done("Name saved")}
              />
            </FormDialog>
            <FormDialog open={dialog === "password"} onClose={close}>
              <ChangePasswordForm
                member={selected}
                onDone={() => done("Password changed")}
              />
            </FormDialog>
            <FormDialog open={dialog === "reset"} onClose={close}>
              <ResetPasswordForm
                member={selected}
                onDone={() => done(`${selected.name}'s password reset`)}
              />
            </FormDialog>
            <AlertDialog
              open={dialog === "remove"}
              onOpenChange={(next) => {
                if (!next) {
                  close();
                }
              }}
            >
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {selected.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {firstName(selected.name)} is signed out everywhere and can
                    no longer sign in to the admin app. Their past activity
                    stays in the log. You can restore them from the Removed tab.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="ghost" />}>
                    Cancel
                  </AlertDialogClose>
                  <Button
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate(selected);
                    }}
                  >
                    Remove member
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>
          </>
        )
      }
    >
      <PageHeader
        title="Members"
        count={members.length}
        actions={
          superadmin ? (
            <Button
              size="sm"
              onClick={() => {
                setDialog("add");
              }}
            >
              <PlusIcon />
              Add member
            </Button>
          ) : undefined
        }
      />

      {superadmin ? (
        <FormDialog open={dialog === "add"} onClose={close}>
          <AddMemberForm
            viewer={viewer}
            onDone={(name) => done(`${name} added`)}
            onRestore={(member) => {
              setDialog(null);
              restore.mutate(member);
            }}
          />
        </FormDialog>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(next: Tab) => {
          setSelectedId(null);
          setTab(next);
        }}
        className="border-border shrink-0 border-b px-(--page-gutter)"
      >
        <TabsList variant="underline">
          <TabsTab value="active">
            Active <span className="tabular-nums">{members.length}</span>
          </TabsTab>
          <TabsTab value="removed">
            Removed <span className="tabular-nums">{removed.length}</span>
          </TabsTab>
        </TabsList>
      </Tabs>

      {tab === "active" ? (
        <>
          <div className="border-border flex shrink-0 items-center gap-2 border-b px-(--page-gutter) py-2">
            <InputGroup className="max-w-72">
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                dir="auto"
                aria-label="Search name or email"
                placeholder="Search name or email"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </InputGroup>
          </div>
          <DataTable
            caption="Members of the admin group, with their role, when they were added and their last sign-in."
            columns={activeCols}
            rows={rows}
            rowId={(member) => member.id}
            selectedId={selectedId}
            onRowClick={(member) => {
              setDialog(null);
              setSelectedId(member.id);
            }}
            onDismiss={() => {
              setSelectedId(null);
            }}
            emptyState={
              <EmptyState
                icon={UsersIcon}
                title="No members match"
                description="Nobody in the admin group has that name or email."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                    }}
                  >
                    Clear search
                  </Button>
                }
              />
            }
          />
        </>
      ) : (
        <DataTable
          caption="Removed members, with when and by whom they were removed."
          columns={removedCols}
          rows={removed}
          rowId={(member) => member.id}
          emptyState={
            <EmptyState
              icon={UsersIcon}
              title="No removed members"
              description="A member you remove shows here, and you can restore them."
            />
          }
        />
      )}
    </PageLayout>
  );
}

// The api answers 403 to a signed-in account outside the admin group and 500 when it
// fails, so the screen says which route it asked.
function MembersError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Members" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The member list did not load"
        description="GET /admin/members answers 403 unless the signed-in account is an admin or a superadmin, and 500 when the api fails."
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
