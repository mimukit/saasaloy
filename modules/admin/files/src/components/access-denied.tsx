import { ShieldAlertIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";

import type { AdminSession } from "@admin/lib/auth";
import { SignOutButton } from "@admin/components/sign-out-button";

// What a signed-in user without the admin role sees. It renders in place and does not
// redirect: bouncing this user to /login would send them straight back here the moment the
// guard reads their valid session, which is a loop the address bar makes look like a bug.
// Telling them plainly that the account lacks the role, and offering the one action that
// can change the outcome, ends the interaction instead of spinning it.
export function AccessDenied({ session }: { session: AdminSession }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <ShieldAlertIcon className="text-muted-foreground size-5" />
          <CardTitle>This account cannot open the admin app</CardTitle>
          <CardDescription>
            You are signed in as {session.user.email}, but the account does not carry the admin
            role. Ask an existing admin to grant it, then sign in again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton variant="outline" />
        </CardContent>
      </Card>
    </main>
  );
}
