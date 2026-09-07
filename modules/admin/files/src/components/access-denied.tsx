import { ShieldAlertIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

import type { AdminSession } from "@admin/lib/auth";
import { SignOutButton } from "@admin/components/sign-out-button";

// What a signed-in user without the admin role sees. It renders in place and does not
// redirect: bouncing this user to /login would send them straight back here the moment the
// guard reads their valid session, which is a loop the address bar makes look like a bug.
// Telling them plainly that the account lacks the role, and offering the one action that
// can change the outcome, ends the interaction instead of spinning it.
//
// It renders inside AppShell, in the content panel, like every other screen. The rail and
// nav panel around it are inert for this visitor — every link they hold re-runs the guard
// and lands back here — but a screen that drops the shell reads as a crash rather than a
// refusal, and the guard, not the chrome, is what keeps the data out of reach.
export function AccessDenied({ session }: { session: AdminSession }) {
  return (
    <main className="mx-auto flex h-full max-w-lg items-center px-6 py-10">
      <Card className="w-full">
        <CardHeader>
          <ShieldAlertIcon className="text-muted-foreground size-5" />
          <CardTitle>This account cannot open the admin app</CardTitle>
          <CardDescription>
            You are signed in as {session.user.email}, but the account does not
            carry the admin role. Ask an existing admin to grant it, then sign
            in again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton variant="outline" />
        </CardContent>
      </Card>
    </main>
  );
}
