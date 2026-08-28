import { Outlet, createRootRoute } from "@tanstack/react-router";

// The one layout every admin route renders inside. A feature module that drops
// src/routes/<feature>.tsx inherits this shell for free and needs no patch — the
// router plugin picks the new file up and rewrites src/routeTree.gen.ts.
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-dvh">
      <Outlet />
    </div>
  );
}
