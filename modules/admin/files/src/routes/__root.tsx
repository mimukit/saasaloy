import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { RouterContext } from "../lib/auth";

// The document frame every route renders inside. It owns nothing but the outlet: the
// <html>/<head>/<body> shell is index.html, the theme is resolved before this ever
// runs (see the theme plugin in vite.config.ts), and the signed-in chrome belongs to
// the `_authed` layout so the login and signup screens do not inherit it.
//
// `WithContext` is what types the context object main.tsx passes in, so `_authed`'s
// `beforeLoad` reads `context.auth` with no cast and a typo fails the typecheck.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
