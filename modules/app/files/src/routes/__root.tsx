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

import { AppShell } from "@app/components/app-shell";
import { loadSession } from "@app/lib/auth";

// The one guard for the whole app. Every route but the two auth screens needs a session;
// any signed-in account passes. A screen that needs a role checks it itself, and the api
// checks it again on every call, so hiding a screen is never the only gate.

/** The two screens an anonymous visitor may open. */
const AUTH_PATHS = new Set(["/sign-in", "/sign-up"]);

/**
 * What every route's `beforeLoad` and `loader` is handed. `src/main.tsx` supplies the value
 * when it creates the router.
 */
export interface AppRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: async ({ location }) => {
    const session = await loadSession();
    const onAuthPage = AUTH_PATHS.has(location.pathname);

    if (!session) {
      if (onAuthPage) {
        return { session: null };
      }
      // `redirect` carries the page the visitor asked for. The sign-in screen narrows it to
      // a path on this origin before it navigates there (`src/lib/redirect.ts`).
      throw redirect({
        to: "/sign-in",
        search: { redirect: location.href },
      });
    }

    // A signed-in visitor has no business on the auth screens.
    if (onAuthPage) {
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

  // The two auth screens render bare, centred on the shell canvas.
  if (!session) {
    return (
      <ToastProvider>
        <main className="bg-sidebar flex min-h-dvh items-center justify-center p-4">
          <Outlet />
        </main>
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

function RootError({ error, reset }: ErrorComponentProps) {
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
