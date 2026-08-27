import { useState } from "react";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { Button } from "@repo/ui/components/button";
import { signOut } from "../lib/auth";

// The session gate, and the reason a page belongs under `src/routes/_authed/`. The
// leading underscore makes this a pathless layout: it adds no segment to any URL, so
// `routes/_authed/billing.tsx` is served at /billing and inherits this guard without
// declaring anything. Dropping a page outside this folder opts it out — which is how
// /login and /signup stay reachable while signed out.
//
// The guard is UX, not enforcement. The session cookie is httpOnly, so the client can
// never truly be the gate; the api rejects an unauthenticated request on its own, and
// lib/api.ts turns that 401 into a trip back here. What this saves is the flash of an
// empty dashboard before that happens.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.auth.load();
    if (!session) {
      // `location.href` is the path plus search the user was aiming for. Login reads
      // it back off the `redirect` param and finishes the trip.
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    // Returned context merges into every route below, so a page reads the signed-in
    // user with `Route.useRouteContext().session` and never refetches it.
    return { session };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { auth, session } = Route.useRouteContext();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();
    // Drop the cached session before leaving, or the guard waves the next visit
    // through on an answer the server has already invalidated.
    auth.reset();
    await navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-end gap-3 border-b px-6 py-3">
        <span className="text-sm text-muted-foreground">{session.user.email}</span>
        <Button variant="outline" onClick={handleSignOut} disabled={pending}>
          Sign out
        </Button>
      </header>
      <Outlet />
    </div>
  );
}
