import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { errors } from "@repo/ui/content/errors";

// The router's default error component: what any route shows when its loader throws, for
// example when the api answers 500. src/main.tsx sets it as `defaultErrorComponent`, so a
// module page gets an error state without writing one. It renders inside the page frame,
// because it replaces the <Outlet /> the frame wraps.
//
// A route that needs a different screen sets its own `errorComponent`; /users keeps
// UsersError as the worked example of that.
//
// The router types `error` as `unknown`: a loader can throw anything. Only a real Error
// has a message worth showing, so anything else shows the description alone.

export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <ErrorState
      code={errors.renderFailure.code}
      title={errors.renderFailure.title}
      description={errors.renderFailure.description}
      detail={error instanceof Error ? error.message : undefined}
      primaryAction={{ label: errors.renderFailure.retryLabel, onClick: reset }}
      secondaryAction={{ label: errors.renderFailure.homeLabel, href: "/" }}
    />
  );
}
