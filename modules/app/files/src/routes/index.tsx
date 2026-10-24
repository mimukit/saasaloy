import { createFileRoute } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";

import { siteName } from "@repo/ui";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/shell/card";
import { PageBody } from "@repo/ui/containers/shell/page-body";

// The home screen the scaffold ships: a welcome and an empty state. There is no demo
// entity on purpose. Your first feature replaces the empty state; the `saasaloy-feature`
// skill builds one end to end, and "Add a screen" in `saasaloy-app` has the list and form
// recipes.
export const Route = createFileRoute("/")({ component: Home });

function Home() {
  // The root guard put the session in the route context, so this screen never fetches it.
  const { session } = Route.useRouteContext();
  const name = session?.user.name || session?.user.email;

  return (
    <>
      <PageHeader title="Home" />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>
              Welcome to {siteName}
              {name ? `, ${name}` : ""}
            </CardTitle>
            <CardDescription>
              You are signed in as {session?.user.email}.
            </CardDescription>
          </CardHeader>
        </Card>

        <EmptyState
          icon={LayoutGridIcon}
          title="Your product's first screen goes here"
          description={
            <>
              This page is a placeholder. Ask your agent to run the{" "}
              <code className="bg-muted rounded-sm px-1 py-0.5 font-mono text-xs">
                saasaloy-feature
              </code>{" "}
              skill to build the first feature and replace it.
            </>
          }
        />
      </PageBody>
    </>
  );
}
