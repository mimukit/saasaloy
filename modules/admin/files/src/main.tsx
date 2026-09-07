import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  THEME_ORDER,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEME_TOGGLE_ATTRIBUTE,
  getStoredTheme,
  setTheme,
} from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

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
// A backoffice is a dark app by default. `getStoredTheme()` cannot answer this on its
// own: `setTheme("system")` DELETES the storage key, so an unset key and a deliberate
// `system` are the same value to it. Read the raw key instead — absent means the visitor
// has never chosen, and that first visit stores `dark`. A stored `light` or `dark` wins,
// and a stored `system` (an absent key set by an earlier `system` choice) resolves
// against the OS the way it does everywhere else.
//
// This is a one-line call in the entry rather than the shared THEME_INIT_SCRIPT, which
// index.html does not emit (plan decision: no Vite plugin, no pasted script). The trade
// is one frame of the light palette on the empty body before this module runs, against a
// build-time plugin the admin app would be the only user of.
function applyStartingTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // A throwing localStorage (private mode, blocked storage) is a normal condition
    // here, the same as it is in @repo/ui/lib/theme. Fall through to the default.
  }
  setTheme(stored === null ? "dark" : getStoredTheme());
}

// The toggle's behaviour. The `theme-toggle` block in @repo/ui is deliberately inert
// chrome — its click handling lives in THEME_INIT_SCRIPT, which only the Astro host
// inlines. This is that handler, and nothing else in the app changes the theme.
//
// It cycles from what is PAINTED, not from what is stored, for the reason the shared
// script gives: where storage is unwritable the write is a no-op, so reading storage
// would answer the same value forever and every press would land on the same theme.
function installThemeToggle(): void {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest(`[${THEME_TOGGLE_ATTRIBUTE}]`)) {
      return;
    }
    const root = document.documentElement;
    const painted = root.getAttribute(THEME_ATTRIBUTE) as Theme | null;
    const index = painted === null ? -1 : THEME_ORDER.indexOf(painted);
    // `data-theme` is author-writable, so `painted` can be anything; an unrecognised
    // value gives index -1 and starts the cycle at the head of THEME_ORDER.
    const next = THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "light";
    // `setTheme` writes storage, sets data-theme, toggles `.dark`, and relabels every
    // trigger from THEME_LABELS, so the button's accessible name stays true.
    setTheme(next);
  });
}

applyStartingTheme();
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
