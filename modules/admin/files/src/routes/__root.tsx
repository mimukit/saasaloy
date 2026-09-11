import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorState } from "@repo/ui/blocks/error-state";
import { errors } from "@repo/ui/content/errors";

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
  notFoundComponent: RootNotFound,
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

// What an address that matches no route renders. It sits inside AppShell, so the rail and
// nav panel stay usable and the visitor can click their way out instead of reaching for the
// back button.
//
// Only an admin ever sees this screen, and that is the guard working rather than a hole in
// it. The router resolves `beforeLoad` top-down before it installs the not-found boundary,
// and a redirect thrown there ends the match, so an anonymous visitor asking for an unknown
// path lands on /login and learns nothing about which admin paths exist. The session is
// therefore present in practice; the null branch below is a type guard, not a second case.
function RootNotFound() {
  const { session } = Route.useRouteContext();

  const screen = (
    <ErrorState
      code={errors.notFound.code}
      title={errors.notFound.title}
      description={errors.notFound.description}
      primaryAction={{ label: errors.notFound.homeLabel, href: "/" }}
    />
  );

  if (!session) {
    return screen;
  }

  return <AppShell session={session}>{screen}</AppShell>;
}

// The root route's error boundary, and the second half of the guard. A NotAdminError is the
// deny path, so it renders the panel rather than a stack trace; anything else is a real
// render failure and gets the same ErrorState every other app in the repo shows.
//
// The deny path renders inside AppShell. The error carries the session, so the shell has
// what it needs, and the refusal reads as a screen of this app rather than as a crash. The
// generic branch below does not: a render failure may be the shell itself, and wrapping the
// fallback in the thing that just threw would take the fallback down with it.
//
// `reset` is the router's own retry: it re-runs the failed match in place, which is the one
// action that can clear a transient render error without a full page load. The home link is
// the way out when it cannot.
function RootError({ error, reset }: ErrorComponentProps) {
  if (error instanceof NotAdminError) {
    return (
      <AppShell session={error.session}>
        <AccessDenied session={error.session} />
      </AppShell>
    );
  }

  return (
    <ErrorState
      code={errors.renderFailure.code}
      title={errors.renderFailure.title}
      description={errors.renderFailure.description}
      primaryAction={{ label: errors.renderFailure.retryLabel, onClick: reset }}
      secondaryAction={{ label: errors.renderFailure.homeLabel, href: "/" }}
    />
  );
}
