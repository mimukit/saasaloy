import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  getStoredTheme,
  hasChosenTheme,
  installThemeToggle,
  setTheme,
} from "@repo/ui/lib/theme";

import { routeTree } from "./routeTree.gen";
// The one stylesheet import for the whole SPA. admin.css imports @repo/ui/globals.css
// first — packages/ui still owns Tailwind's entrypoint, its @source globs and the base
// layer — and then redeclares the token values for this app. No route imports a
// stylesheet again.
import "./styles/admin.css";

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

// The theme, applied before React renders.
//
// A backoffice is a dark app by default, and only for a visitor who has never said
// otherwise. `getStoredTheme()` cannot tell those two apart on its own: `setTheme("system")`
// DELETES the `theme` key — that is how the shared state machine spells "follow the OS" —
// so a first visit and a deliberate `system` both read as an absent key.
//
// `hasChosenTheme()` is what separates them. It reads the marker `installThemeToggle`
// writes on every press, so the four cases are:
//
//   never pressed                 → first visit, store `dark`
//   pressed, theme=light          → `light`
//   pressed, theme=dark           → `dark`
//   pressed, theme absent         → `system`, resolved against the OS
//
// The last three are one `getStoredTheme()` call, which already answers `system` for an
// absent key.
//
// This is a call in the entry rather than the shared THEME_INIT_SCRIPT, which index.html
// does not emit (plan decision: no Vite plugin, no pasted script). The trade is one frame
// of the light palette on the empty body before this module runs, against a build-time
// plugin the admin app would be the only user of.
function applyStartingTheme(): void {
  setTheme(hasChosenTheme() ? getStoredTheme() : "dark");
}

applyStartingTheme();

// The toggle's behaviour, from @repo/ui rather than re-implemented here. The
// `theme-toggle` block is deliberately inert chrome: its click handling lives in
// THEME_INIT_SCRIPT, which only the Astro host inlines. This app cannot inline it — a
// Vite index.html substitutes only `%VITE_*%` values — so it installs the same delegated
// listener from the same module instead. Nothing else in the app changes the theme, and
// the listener lives for the document's lifetime, so its remover is unused.
installThemeToggle();

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error('index.html is missing its <div id="root">.');
}

// QueryClientProvider wraps RouterProvider. A loader reads the client from the router
// context above and needs no provider, but every `useQuery` inside a route component
// does, and those components render underneath RouterProvider.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
