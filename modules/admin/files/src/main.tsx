import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "@repo/ui/globals.css";
import { createAuthState } from "./lib/auth";
import { routeTree } from "./routeTree.gen";

// The nav contract for the whole app. A page declares its own nav entry in its route
// definition — `staticData: { nav: { label: "Billing", order: 20 } }` — and the shell
// reads it back off the route tree. A page and its nav entry are therefore one file
// that cannot disagree; there is no array to patch and nothing to keep in sync.
//
// Augmenting TanStack's own `StaticDataRouteOption` (rather than declaring a separate
// type) is what makes `staticData` type-checked at the route rather than cast at the
// reader. `nav` stays optional: a route without one is simply not in the nav.
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: {
      /** Text shown in the shell nav. */
      label: string;
      /** Sort key, ascending. The dashboard is 0; leave gaps for later pages. */
      order: number;
    };
  }
}

// One `AuthState` per app load, handed to the router as context. Every guard and page
// reads the session through it, so the app asks the server for it exactly once.
const router = createRouter({ routeTree, context: { auth: createAuthState() } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing its #root element");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
