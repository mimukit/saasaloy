import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
// The one import of the shared theme, for the whole SPA. packages/ui owns Tailwind's
// entrypoint, its @source globs and the token set; no route may import globals.css again.
import "@repo/ui/globals.css";

const router = createRouter({
  routeTree,
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

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
