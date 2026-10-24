import { ShieldAlertIcon } from "lucide-react";

import { siteName } from "@repo/ui";
import { BrandMark } from "@repo/ui/blocks/shell/brand-mark";

import type { AdminSession } from "@admin/lib/auth";
import { SignOutButton } from "@admin/components/sign-out-button";

// What a signed-in account without an admin-app role sees. It renders in place and does
// not redirect: bouncing this user to /login would send them straight back here the moment
// the guard reads their valid session, which is a loop the address bar makes look like a
// bug. Telling them plainly that the account lacks the role, and offering the one action
// that can change the outcome, ends the interaction instead of spinning it.
//
// It renders on its own, on the login screen's card, and never inside AppShell. The shell
// carries the sidebar, the navigation and the user menu, and an account the guard refused
// must not see any of it: the menus name every screen the admin app has, which is more
// than a refused visitor needs to learn. The card is the same surface the visitor signed in
// on, so the refusal still reads as a screen of this app rather than as a crash.
//
// The guard, not the chrome, keeps the data out of reach: every api call this app makes
// opens with an admin gate, so dropping the shell hides navigation, not data.
export function AccessDenied({ session }: { session: AdminSession }) {
  return (
    // A `main`, because no shell wraps this screen and so nothing else gives the page its
    // main landmark.
    <main className="bg-background flex min-h-dvh items-center justify-center p-4">
      <div className="bg-card text-card-foreground border-border w-full max-w-sm rounded-2xl border p-6 shadow-xs/5 sm:p-7">
        <BrandMark className="mb-5" />
        <div className="text-muted-foreground mb-3 flex size-9 items-center justify-center rounded-lg border">
          <ShieldAlertIcon aria-hidden="true" className="size-4.5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          This account cannot open {siteName} admin
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          You are signed in as {session.user.email}, but the account does not
          carry an admin role. Ask an existing admin to grant it, then sign in
          again.
        </p>
        <div className="mt-6">
          <SignOutButton variant="outline" />
        </div>
      </div>
    </main>
  );
}
