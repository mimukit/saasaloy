import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, redirect } from "@tanstack/react-router";

import { AccessDenied } from "@admin/components/access-denied";
import { AppShell } from "@admin/components/app-shell";
import { isAdmin, loadSession } from "@admin/lib/auth";

const LOGIN_PATH = "/login";

/**
 * What every route's `beforeLoad` and `loader` is handed. `src/main.tsx` supplies the
 * value when it creates the router; this type is what makes `context.queryClient` in a
 * route loader resolve to a real QueryClient instead of `unknown`.
 */
export interface AdminRouterContext {
  queryClient: QueryClient;
}

// The one layout every admin route renders inside, and the one place the access gate is
// written. A feature module that drops src/routes/<feature>.tsx inherits this shell for
// free and needs no patch — the router plugin picks the new file up, rewrites
// src/routeTree.gen.ts, and the new screen is guarded because it is a child of this route.
//
// Default-deny, decided in three cases and nowhere else:
//
//   anonymous          → redirect to /login (except on /login itself, which would loop)
//   signed in, no role → render AccessDenied in place; never redirect
//   signed in as admin → render the shell
//
// The middle case is the one worth stating out loud. A non-admin holds a valid session, so
// /login would immediately bounce them back and the browser would ping-pong. They get a
// terminal screen with a sign-out button instead.
//
// The guard runs in `beforeLoad` rather than in the component, so a non-admin never
// triggers a child route's loader: `beforeLoad` resolves top-down before any loader fires.
export const Route = createRootRouteWithContext<AdminRouterContext>()({
  beforeLoad: async ({ location }) => {
    const session = await loadSession();
    const onLoginPage = location.pathname === LOGIN_PATH;

    if (!session) {
      if (onLoginPage) return { session: null };
      throw redirect({ to: LOGIN_PATH });
    }

    // Already signed in and asking for the login screen. Send them to the dashboard; if the
    // account is not an admin, the component below turns that into AccessDenied, which is a
    // stop rather than another hop.
    if (onLoginPage) throw redirect({ to: "/" });

    return { session };
  },
  component: RootLayout,
});

function RootLayout() {
  const { session } = Route.useRouteContext();

  // Only /login reaches this branch: every other path redirected in beforeLoad.
  if (!session) return <Outlet />;

  if (!isAdmin(session)) return <AccessDenied session={session} />;

  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  );
}
