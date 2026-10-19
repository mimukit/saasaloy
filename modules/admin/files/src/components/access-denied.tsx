import { ShieldAlertIcon } from "lucide-react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/admin/empty";

import type { AdminSession } from "@admin/lib/auth";
import { SignOutButton } from "@admin/components/sign-out-button";

// What a signed-in user without the admin role sees. It renders in place and does not
// redirect: bouncing this user to /login would send them straight back here the moment the
// guard reads their valid session, which is a loop the address bar makes look like a bug.
// Telling them plainly that the account lacks the role, and offering the one action that
// can change the outcome, ends the interaction instead of spinning it.
//
// It renders inside AppShell, in the content panel, like every other screen. The sidebar
// around it is inert for this visitor — every link it holds re-runs the guard
// and lands back here — but a screen that drops the shell reads as a crash rather than a
// refusal, and the guard, not the chrome, is what keeps the data out of reach.
export function AccessDenied({ session }: { session: AdminSession }) {
  return (
    // A `div`, not a `main`: this renders inside AppShell's content panel, which is
    // already the document's `<main>`, and a nested main landmark breaks landmark
    // navigation for a screen reader. Empty renders a div.
    <Empty className="min-h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlertIcon />
        </EmptyMedia>
        <EmptyTitle>This account cannot open the admin app</EmptyTitle>
        <EmptyDescription>
          You are signed in as {session.user.email}, but the account does not
          carry the admin role. Ask an existing admin to grant it, then sign in
          again.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <SignOutButton variant="outline" />
      </EmptyContent>
    </Empty>
  );
}
