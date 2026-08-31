import type { QueryClient } from "@tanstack/react-query";
import {
  ErrorComponent,
  Outlet,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { AccessDenied } from "@admin/components/access-denied";
import { AppShell } from "@admin/components/app-shell";
import { isAdmin, loadSession } from "@admin/lib/auth";
import type { AdminSession } from "@admin/lib/auth";

const LOGIN_PATH = "/login";

/**
 * Thrown by the guard for a signed-in account that does not carry the admin role. It is an
 * error rather than a redirect on purpose: a throw stops the router before any child route's
 * `loader` runs, and the root route's `errorComponent` turns it into a terminal panel. A
 * redirect would bounce off the valid session and ping-pong the address bar.
 */
export class NotAdminError extends Error {
  readonly session: AdminSession;

  constructor(session: AdminSession) {
    super("This account does not carry the admin role.");
    this.name = "NotAdminError";
    this.session = session;
  }
}

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
//   signed in, no role → throw NotAdminError; the errorComponent renders AccessDenied
//   signed in as admin → render the shell
//
// The middle case is the one worth stating out loud. A non-admin holds a valid session, so
// /login would immediately bounce them back and the browser would ping-pong. They get a
// terminal screen with a sign-out button instead.
//
// Every deny is a throw from `beforeLoad`, which is what makes the gate hold for data and
// not only for pixels. `beforeLoad` resolves top-down and a throw ends the match, so no
// child route's `loader` runs for a visitor this guard turns away — not for the anonymous
// one and not for the signed-in non-admin. A component-level deny would let those loaders
// fire first. The server still authorizes every request; this only stops admin-app code
// from asking on a denied visitor's behalf.
export const Route = createRootRouteWithContext<AdminRouterContext>()({
  beforeLoad: async ({ location }) => {
    const session = await loadSession();
    const onLoginPage = location.pathname === LOGIN_PATH;

    if (!session) {
      if (onLoginPage) {
        return { session: null };
      }
      // Carry where they were going, so login.tsx can send them there instead of to /.
      // `href` is the pathname with its search and hash, which is what a deep link into a
      // filtered list needs. login.tsx re-validates it; nothing here trusts it.
      throw redirect({
        to: LOGIN_PATH,
        search: { redirect: location.href },
      });
    }

    // The role check comes before the login-page redirect, so a signed-in non-admin who
    // opens /login is denied where they stand instead of being sent to / to be denied there.
    if (!isAdmin(session)) {
      throw new NotAdminError(session);
    }

    // Already signed in as an admin and asking for the login screen: nothing to do there.
    if (onLoginPage) {
      throw redirect({ to: "/" });
    }

    return { session };
  },
  component: RootLayout,
  errorComponent: RootError,
});

function RootLayout() {
  const { session } = Route.useRouteContext();

  // Only /login reaches this branch: every other path redirected in beforeLoad. A non-admin
  // never reaches this component at all — the guard threw before it rendered.
  if (!session) {
    return <Outlet />;
  }

  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  );
}

// The root route's error boundary, and the second half of the guard. A NotAdminError is the
// deny path, so it renders the panel rather than a stack trace; anything else is a real
// failure and gets the router's own error screen.
function RootError({ error }: ErrorComponentProps) {
  if (error instanceof NotAdminError) {
    return <AccessDenied session={error.session} />;
  }
  return <ErrorComponent error={error} />;
}
