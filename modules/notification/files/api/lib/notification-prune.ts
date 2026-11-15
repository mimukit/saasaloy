import { withDb } from "@repo/db/client";
import { pruneNotifications } from "@repo/db/repositories/notifications";
import { setNotificationPruneRunner } from "@repo/queue/jobs/notifications";
import { env } from "cloudflare:workers";
import type { HandlerSet } from "../worker";

// The half of the daily prune that touches the database. It ships only when `queue` is
// installed, beside `packages/queue/src/jobs/notifications.ts`, which holds the job and
// cannot import `@repo/db` itself (that file says why).
//
// It registers through the Worker's handler table rather than an import in a route file:
// the route ships in every project and this file does not, so the route cannot name it.
// `notificationPruneHandlers()` is called once, when `worker.ts` builds the table, and the
// set it returns declares no hook of its own. The cron tick and the queue consumer come
// from the queue provider; this file only hands the job its runner.
//
// `env` comes from `cloudflare:workers` rather than from a request, because a scheduled run
// has no request to read one off. `apps/api/src/lib/storage-sweep.ts` does the same.

/** Register the prune runner with the job, and add nothing else to the Worker. */
export function notificationPruneHandlers(): HandlerSet {
  setNotificationPruneRunner((now) => {
    // `withDb` rather than `getDb`: under `database-postgres` the run owns a real socket
    // and something has to close it. There is no `executionCtx` out here, so the no-op
    // lets `withDb` close the socket when the body settles without asking the runtime
    // to wait.
    const scope = { env: env as never, executionCtx: { waitUntil: noop } };
    return withDb(scope, (db) => pruneNotifications(db, now));
  });
  return {};
}

function noop(): void {
  // Nothing to keep the isolate alive for; see the comment above.
}
