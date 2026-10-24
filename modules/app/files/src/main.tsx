import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PageSkeleton } from "@repo/ui/blocks/shell/page-skeleton";
import {
  getStoredTheme,
  hasChosenTheme,
  installThemeToggle,
  setTheme,
} from "@repo/ui/lib/theme";

import { RouteError } from "@app/components/route-error";

import { routeTree } from "./routeTree.gen";
// The one stylesheet for the whole SPA: brand.css, shell.css and this app's canvas
// values. Never admin.css. No route imports a stylesheet of its own.
import "@repo/ui/styles/app.css";

// One QueryClient for the app. A screen that reads the api uses it through
// `useQuery`, and `context.queryClient` reaches every route loader.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: PageSkeleton,
  defaultErrorComponent: RouteError,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Light first. The customer app wears the brand, and the brand starts light, until the
// visitor picks a theme in the account menu. `hasChosenTheme()` separates a first visit
// from a deliberate `system`, which both leave the `theme` key empty.
setTheme(hasChosenTheme() ? getStoredTheme() : "light");

// The OS listener, so a visitor on `system` follows the OS when it changes.
installThemeToggle();

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error('index.html is missing its <div id="root">.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
