import { createFileRoute } from "@tanstack/react-router";

// The dashboard. Living under `_authed/` is what puts it behind the session guard —
// the folder adds no URL segment, so this is still served at /. `staticData.nav` is
// the worked example of the extension point: a feature module adds a page by dropping
// one file next to this one, declaring its own `nav` entry, and editing nothing else.
// `order: 0` keeps the dashboard first.
export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
  staticData: { nav: { label: "Dashboard", order: 0 } },
});

function Dashboard() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        The admin shell is up. Add a page by creating a file in <code>src/routes/</code>.
      </p>
    </main>
  );
}
