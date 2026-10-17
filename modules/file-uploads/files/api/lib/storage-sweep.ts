import { withDb } from "@repo/db/client";
import {
  listAbandonedObjects,
  listDeletingObjects,
  listPurgeableObjects,
  markDeleted,
  purgeObject,
} from "@repo/db/repositories/objects";
import {
  DEFAULT_PURGE_AFTER_DAYS,
  runStorageSweep,
  setSweepRunner,
} from "@repo/file-uploads";
import { createStorage, StorageError } from "@repo/storage";
import { env } from "cloudflare:workers";
import type { SweepPort, SweepResult, SweepRow } from "@repo/file-uploads";

// The `SweepPort` implementation, and the one file that holds the database, the storage
// capability and the sweep at the same time.
//
// `@repo/file-uploads` declares the port and never implements it: the package has zero
// runtime dependencies so that `packages/queue` can import it, and importing `@repo/db`
// there would pull the schema barrel's `import.meta.glob` into a workspace that does not
// compile with Vite's types. `apps/api` is the one workspace that already has both, so the
// queries live here.
//
// **Registered at module load.** `apps/api/src/routes/files.ts` imports this file, and
// `apps/api/src/index.ts` imports that route, so the runner is in place before the Worker's
// queue consumer or cron tick can reach a job.
//
// `env` comes from `cloudflare:workers` rather than from a request: a scheduled run has no
// request to read one off, and `JobContext` carries `attempt`, `step` and `sleep` and
// nothing else. `apps/api/src/billing-store.ts` reaches for the same import for the same
// reason.

setSweepRunner((now) => runSweepNow(now));

/** Build the port over a request-less client and run one pass. */
export function runSweepNow(now: Date): Promise<SweepResult> {
  return runStorageSweep(sweepPort(), now);
}

function sweepPort(): SweepPort {
  const bindings = env as unknown as Record<string, unknown>;
  const storage = createStorage(bindings);

  // `withDb` rather than `getDb`: under `database-postgres` this message owns a real
  // socket and something has to close it. There is no `executionCtx` out here, so the
  // no-op below lets `withDb` take its "nothing to keep alive on" branch — the socket
  // still closes when the body settles, the runtime just is not asked to wait for it.
  const scope = { env: bindings as never, executionCtx: { waitUntil: noop } };

  return {
    async forget(key: string): Promise<void> {
      try {
        await storage.delete(key);
      } catch (error) {
        // A missing object means the outcome already holds. Anything else rethrows, so
        // the message is retried rather than the row being dropped while its object
        // survives.
        if (error instanceof StorageError && error.code === "not_found") {
          return;
        }
        throw error;
      }
    },
    listAbandoned: (before, limit) =>
      withDb(scope, (db) => listAbandonedObjects(db, before, limit)),
    listDeleting: (limit) =>
      withDb(scope, (db) => listDeletingObjects(db, limit)),
    listPurgeable: (before, limit) =>
      withDb(scope, (db) => listPurgeableObjects(db, before, limit)),
    async markDeleted(row: SweepRow): Promise<void> {
      await withDb(scope, (db) => markDeleted(db, row.tenantId, row.id));
    },
    async purge(row: SweepRow): Promise<void> {
      await withDb(scope, (db) => purgeObject(db, row.id));
    },
    purgeAfterDays: purgeAfterDays(bindings),
  };
}

/** `STORAGE_PURGE_AFTER_DAYS`, or 30. An unreadable value throws where the provider does. */
function purgeAfterDays(bindings: Record<string, unknown>): number {
  const raw = bindings.STORAGE_PURGE_AFTER_DAYS;
  if (raw === undefined || raw === "") {
    return DEFAULT_PURGE_AFTER_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `STORAGE_PURGE_AFTER_DAYS is "${String(raw)}", which is not a positive whole number of days.`
    );
  }
  return parsed;
}

function noop(): void {
  // Nothing to keep the isolate alive for; see the comment above.
}
