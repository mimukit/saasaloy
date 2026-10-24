import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@repo/ui/components/shell/alert-dialog";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import { Field, FieldLabel } from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { toastManager } from "@repo/ui/components/shell/toast";

import { auth } from "@admin/lib/auth";

// The members and invitations of the active organization. It renders in the actions
// slot of that organization's detail panel on /teams, so it is sized for a narrow column:
// stacked lists and a one-field invite form, no tables.
//
// Removing a member and revoking an invitation each confirm in an AlertDialog. The id
// waiting on the confirm is the dialog's open state, so there is no second boolean to
// keep in step. Every mutation reports its result as a toast.

interface OrganizationSummary {
  id: string;
  name: string;
}

function renderCollectionState(
  isPending: boolean,
  hasItems: boolean,
  loading: ReactNode,
  items: ReactNode,
  empty: ReactNode
): ReactNode {
  if (isPending) {
    return loading;
  }
  return hasItems ? items : empty;
}

/** Two placeholder rows while a list loads, in the shape of the rows that replace them. */
function ListSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-2" role="status" aria-label={label}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function OrganizationWorkspace({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [invitationToRevoke, setInvitationToRevoke] = useState<string | null>(
    null
  );

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
  const invitationsQuery = queryOptions({
    queryKey: ["organizations", organization.id, "invitations"],
    queryFn: async () => {
      const result = await auth.organization.listInvitations({
        query: { organizationId: organization.id },
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result.data ?? [];
    },
  });

  const members = useQuery(membersQuery);
  const invitations = useQuery(invitationsQuery);
  const pendingInvitations = invitations.data?.filter(
    (invitation) => invitation.status === "pending"
  );

  const inviteMember = useMutation({
    mutationFn: async () => {
      const result = await auth.organization.inviteMember({
        email,
        role: "member",
        organizationId: organization.id,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async (invitation) => {
      toastManager.add({
        type: "success",
        title: "Invitation issued",
        description: `Copy the Invitation ID for ${email}.`,
      });
      setEmail("");
      setInvitationId(invitation?.id ?? null);
      setCopyStatus("");
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The invitation was not issued",
        description: error.message,
      });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await auth.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: organization.id,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      toastManager.add({ type: "success", title: "Member removed" });
      setMemberToRemove(null);
      await queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The member was not removed",
        description: error.message,
      });
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: async (id: string) => {
      const result = await auth.organization.cancelInvitation({
        invitationId: id,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      toastManager.add({ type: "success", title: "Invitation revoked" });
      setInvitationToRevoke(null);
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The invitation was not revoked",
        description: error.message,
      });
    },
  });

  const handleInvite = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    inviteMember.mutate();
  };

  const copyInvitationId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopyStatus("Invitation ID copied.");
    } catch {
      setCopyStatus("Copy failed. Select the Invitation ID and copy it.");
    }
  };

  // A list that did not load is not a mutation result, so it stays inline rather than
  // raising a toast. The mutations above report their own failures.
  const loadError = members.error ?? invitations.error;

  const memberPendingRemoval = members.data?.find(
    (member) => member.id === memberToRemove
  );
  const invitationPendingRevoke = pendingInvitations?.find(
    (invitation) => invitation.id === invitationToRevoke
  );

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-labelledby="organization-members">
        <div>
          <h3 id="organization-members" className="text-sm font-medium">
            Members
          </h3>
          <p className="text-muted-foreground text-xs">
            People in {organization.name} and their organization role.
          </p>
        </div>

        {renderCollectionState(
          members.isPending,
          Boolean(members.data?.length),
          <ListSkeleton label="Loading members" />,
          <div className="divide-border divide-y">
            {members.data?.map((member) => (
              <div
                key={member.id}
                className="flex min-h-12 items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.user.name || member.user.email}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {member.user.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{member.role}</Badge>
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    onClick={() => {
                      setMemberToRemove(member.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>,
          <p className="text-muted-foreground text-sm">
            This organization has no members.
          </p>
        )}
      </section>

      <section
        className="grid gap-3"
        aria-labelledby="organization-invitations"
      >
        <div>
          <h3 id="organization-invitations" className="text-sm font-medium">
            Invitations
          </h3>
          <p className="text-muted-foreground text-xs">
            Invite a member and copy the returned Invitation ID.
          </p>
        </div>

        <form className="flex items-end gap-2" onSubmit={handleInvite}>
          <Field className="min-w-0 flex-1">
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              value={email}
              required
              autoComplete="email"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Button
            type="submit"
            loading={inviteMember.isPending}
            disabled={!email}
          >
            Invite
          </Button>
        </form>

        {invitationId === null ? null : (
          <div className="bg-muted grid gap-3 rounded-lg p-3">
            <div>
              <p className="text-sm font-medium">Invitation ID</p>
              <code className="mt-1 block font-mono text-xs break-all">
                {invitationId}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                void copyInvitationId(invitationId);
              }}
            >
              Copy invitation ID
            </Button>
            <p className="text-muted-foreground text-xs">
              A signed-in recipient application accepts it with{" "}
              <code className="font-mono">
                auth.organization.acceptInvitation({"{ invitationId }"})
              </code>
              .
            </p>
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {copyStatus}
            </p>
          </div>
        )}

        {renderCollectionState(
          invitations.isPending,
          Boolean(pendingInvitations?.length),
          <ListSkeleton label="Loading invitations" />,
          <div className="divide-border divide-y">
            {pendingInvitations?.map((invitation) => (
              <div
                key={invitation.id}
                className="flex min-h-12 items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {invitation.email}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {invitation.role} · {invitation.status}
                  </p>
                </div>
                <Button
                  variant="destructive-outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setInvitationToRevoke(invitation.id);
                  }}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>,
          <p className="text-muted-foreground text-sm">
            This organization has no pending invitations.
          </p>
        )}
      </section>

      {loadError ? (
        <p className="text-destructive-foreground text-sm" role="alert">
          {loadError.message}
        </p>
      ) : null}

      {/* Closing the dialog any way but the confirm button clears the id, which is the
          old "Keep member" path. A pending removal holds the dialog open. */}
      <AlertDialog
        open={memberToRemove !== null}
        onOpenChange={(next) => {
          if (!next && !removeMember.isPending) {
            setMemberToRemove(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this member?</AlertDialogTitle>
            <AlertDialogDescription>
              {memberPendingRemoval
                ? `${memberPendingRemoval.user.name || memberPendingRemoval.user.email} loses access to ${organization.name}.`
                : `The member loses access to ${organization.name}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={removeMember.isPending}
            >
              Keep member
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={removeMember.isPending}
              onClick={() => {
                if (memberToRemove !== null) {
                  removeMember.mutate(memberToRemove);
                }
              }}
            >
              Remove member
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={invitationToRevoke !== null}
        onOpenChange={(next) => {
          if (!next && !revokeInvitation.isPending) {
            setInvitationToRevoke(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              {invitationPendingRevoke
                ? `The invitation for ${invitationPendingRevoke.email} stops working.`
                : "The invitation stops working."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={revokeInvitation.isPending}
            >
              Keep invitation
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={revokeInvitation.isPending}
              onClick={() => {
                if (invitationToRevoke !== null) {
                  revokeInvitation.mutate(invitationToRevoke);
                }
              }}
            >
              Revoke invitation
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
