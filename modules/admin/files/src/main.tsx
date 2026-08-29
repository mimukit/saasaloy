import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
// The one import of the shared theme, for the whole SPA. packages/ui owns Tailwind's
// entrypoint, its @source globs and the token set; no route may import globals.css again.
import "@repo/ui/globals.css";

// One QueryClient for the app, created at module scope so a React re-render never swaps
// the cache out from under an in-flight query.
//
// `retry: 1` and a 30s `staleTime` are backoffice defaults, not universal ones. An admin
// clicks between a handful of screens, so a short stale window keeps a revisit instant
// without ever showing minutes-old numbers. The default three retries would sit on a
// down api for several seconds before the screen admits anything is wrong; one retry
// still absorbs a dropped packet.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

// `queryClient` rides the router context so a route's `loader` can prefetch through the
// same cache the component then reads, instead of each route reaching for a module-level
// import. That is what makes the loader + Query pairing work: the loader fills the cache
// before the component mounts, and the component's `useQuery` finds the data already
// there, so the screen paints with data on the first frame.
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

// Registers this router instance's types globally, so `Link`, `useNavigate` and
// `redirect` type-check their `to` against the real route tree instead of `string`.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('index.html is missing its <div id="root">.');

// QueryClientProvider wraps RouterProvider. A loader reads the client from the router
// context above and needs no provider, but every `useQuery` inside a route component
// does, and those components render underneath RouterProvider.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
