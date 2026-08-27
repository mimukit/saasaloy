import { useState } from "react";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { Nav } from "../components/nav";
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
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    setPending(true);
    try {
      // Better Auth reports a refused sign-out in the result rather than by throwing,
      // so an ignored return value means clearing the client cache while the server
      // cookie is still live — signed out in this tab, signed in everywhere else.
      // Stay put and say so instead.
      const result = await signOut();
      if (result.error) {
        setError(result.error.message ?? "Could not sign out. Try again.");
        return;
      }
      // Drop the cached session before leaving, or the guard waves the next visit
      // through on an answer the server has already invalidated.
      auth.reset();
      await navigate({ to: "/login" });
    } catch {
      // A dropped connection lands here. Same rule as above: the cookie may well have
      // survived, so do not pretend the session is gone.
      setError("Could not reach the server. Try again.");
    } finally {
      // Without this the button stays disabled until a reload on any failure.
      setPending(false);
    }
  }

  // The shell every guarded page renders inside. `Nav` builds its links from the route
  // tree, so a new page under this folder joins the nav on its own — see
  // src/components/nav.tsx for the convention and _authed/index.tsx for the example.
  return (
    <div className="flex min-h-svh flex-col">
      <Nav
        email={session.user.email}
        onSignOut={handleSignOut}
        signOutPending={pending}
        signOutError={error}
      />
      <Outlet />
    </div>
  );
}
