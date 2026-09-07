import { createFileRoute } from "@tanstack/react-router";

// The users screen, at `/users`. `createFileRoute("/users")` is generated from this file's
// path under src/routes/ — the router plugin writes the id, so never rename the call by
// hand, and never hand-edit src/routeTree.gen.ts.
//
// This file is also what makes the "Users" row in NAV_AREAS type-check. Nav entries are
// checked against the generated route tree, so the row and the route arrive together or
// neither does.
export const Route = createFileRoute("/users")({
  component: Users,
});

function Users() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Users</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        The accounts <code className="font-mono">GET /admin/users</code>{" "}
        returns.
      </p>
    </main>
  );
}
