import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { ToastProvider } from "@repo/ui/components/shell/toast";
import { PageFrame } from "@repo/ui/containers/shell/page-frame";
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

// Every page renders inside PageFrame, which owns the gutter, the height and the last-resort
// error boundary. A module page gets all three from this one place and imports none of
// them. The router's default pending and error components (src/main.tsx) render inside
// the frame too, because they replace the <Outlet /> it wraps.
//
// The toast provider sits above both branches, so a screen and the sign-in form can each
// raise a toast through `toastManager` from @repo/ui/components/shell/toast.
function RootLayout() {
  const { session } = Route.useRouteContext();

  // Only /login reaches this branch: every other path redirected in beforeLoad. A non-admin
  // never reaches this component at all — the guard threw before it rendered.
  if (!session) {
    return (
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AppShell session={session}>
        <PageFrame>
          <Outlet />
        </PageFrame>
      </AppShell>
    </ToastProvider>
  );
}

// What an address that matches no route renders. The router renders the root route's
// not-found component in place of RootLayout's <Outlet />, so it already sits inside
// AppShell and PageFrame: the sidebar stays usable, and the visitor can click their way
// out instead of reaching for the back button. It must not wrap itself in the shell
// again, or the page shows a second sidebar and header inside the first.
//
// Only an admin ever sees this screen, and that is the guard working rather than a hole in
// it. The router resolves `beforeLoad` top-down before it installs the not-found boundary,
// and a redirect thrown there ends the match, so an anonymous visitor asking for an unknown
// path lands on /login and learns nothing about which admin paths exist.
function RootNotFound() {
  return (
    <ErrorState
      code={errors.notFound.code}
      title={errors.notFound.title}
      description={errors.notFound.description}
      primaryAction={{ label: errors.notFound.homeLabel, href: "/" }}
    />
  );
}

// The root route's error boundary, and the second half of the guard. A NotAdminError is the
// deny path, so it renders the panel rather than a stack trace; anything else is a real
// render failure and gets the same ErrorState every other app in the repo shows.
//
// The deny path renders without AppShell, on the login screen's card. The shell holds the
// sidebar, the navigation and the user menu, and an account the guard refused must see none
// of it. The error carries the session only so the panel can name the signed-in email. The
// generic branch below drops the shell too, for its own reason: a render failure may be the
// shell itself, and wrapping the fallback in the thing that just threw would take the
// fallback down with it.
//
// `reset` is the router's own retry: it re-runs the failed match in place, which is the one
// action that can clear a transient render error without a full page load. The home link is
// the way out when it cannot.
function RootError({ error, reset }: ErrorComponentProps) {
  if (error instanceof NotAdminError) {
    return <AccessDenied session={error.session} />;
  }

  return (
    <ErrorState
      code={errors.renderFailure.code}
      title={errors.renderFailure.title}
      description={errors.renderFailure.description}
      detail={error instanceof Error ? error.message : undefined}
      primaryAction={{ label: errors.renderFailure.retryLabel, onClick: reset }}
      secondaryAction={{ label: errors.renderFailure.homeLabel, href: "/" }}
      className="min-h-dvh"
    />
  );
}
