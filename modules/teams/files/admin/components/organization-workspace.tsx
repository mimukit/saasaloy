import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

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

import { auth } from "@admin/lib/auth";

interface OrganizationSummary {
  id: string;
  name: string;
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
      setEmail("");
      setInvitationId(invitation?.id ?? null);
      setCopyStatus("");
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
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
      setMemberToRemove(null);
      await queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
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
      setInvitationToRevoke(null);
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      });
    },
  });

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
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

  const error =
    members.error ??
    invitations.error ??
    removeMember.error ??
    revokeInvitation.error;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            People in {organization.name} and their organization role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.isPending ? (
            <p className="text-muted-foreground text-sm" role="status">
              Loading members…
            </p>
          ) : members.data?.length ? (
            <div className="divide-border divide-y">
              {members.data.map((member) => (
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{member.role}</Badge>
                    {memberToRemove === member.id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="min-h-11 md:min-h-7"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate(member.id)}
                        >
                          Confirm removal
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 md:min-h-7"
                          disabled={removeMember.isPending}
                          onClick={() => setMemberToRemove(null)}
                        >
                          Keep member
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="min-h-11 md:min-h-7"
                        onClick={() => setMemberToRemove(member.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              This organization has no members.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Invite a member and copy the returned Invitation ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={handleInvite}
          >
            <div className="grid flex-1 gap-2">
              <Label htmlFor="invitation-email">Email</Label>
              <Input
                id="invitation-email"
                className="min-h-11 md:min-h-8"
                type="email"
                value={email}
                required
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="min-h-11 md:min-h-8"
              disabled={!email || inviteMember.isPending}
            >
              {inviteMember.isPending
                ? "Issuing invitation…"
                : "Issue invitation"}
            </Button>
          </form>

          {inviteMember.error ? (
            <p className="text-destructive text-sm" role="alert">
              {inviteMember.error.message}
            </p>
          ) : null}

          {invitationId ? (
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
                className="min-h-11 justify-self-start md:min-h-7"
                onClick={async () => {
                  await copyInvitationId(invitationId);
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
          ) : null}

          {invitations.isPending ? (
            <p className="text-muted-foreground text-sm" role="status">
              Loading invitations…
            </p>
          ) : pendingInvitations?.length ? (
            <div className="divide-border divide-y">
              {pendingInvitations.map((invitation) => (
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
                  <div className="flex items-center gap-2">
                    {invitationToRevoke === invitation.id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="min-h-11 md:min-h-7"
                          disabled={revokeInvitation.isPending}
                          onClick={() => revokeInvitation.mutate(invitation.id)}
                        >
                          Confirm revoke
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 md:min-h-7"
                          disabled={revokeInvitation.isPending}
                          onClick={() => setInvitationToRevoke(null)}
                        >
                          Keep invitation
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="min-h-11 md:min-h-7"
                        onClick={() => setInvitationToRevoke(invitation.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              This organization has no pending invitations.
            </p>
          )}

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
