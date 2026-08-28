import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";

// The dashboard at `/`. `createFileRoute("/")` is generated from this file's path under
// src/routes/ — the router plugin writes the id, so never rename the call by hand.
export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardDescription>
            The scaffold is live. File-based routing, Tailwind and the shared UI package all resolve.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            Add a screen by dropping <code className="font-mono">src/routes/&lt;feature&gt;.tsx</code>. The router
            plugin rewrites <code className="font-mono">src/routeTree.gen.ts</code> on the next dev or build run.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
