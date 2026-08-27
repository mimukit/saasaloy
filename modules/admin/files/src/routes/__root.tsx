import { Outlet, createRootRoute } from "@tanstack/react-router";

// The document frame every route renders inside. It owns nothing but the outlet: the
// <html>/<head>/<body> shell is index.html, the theme is resolved before this ever
// runs (see the theme plugin in vite.config.ts), and the signed-in chrome belongs to
// the `_authed` layout so the login and signup screens do not inherit it.
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
