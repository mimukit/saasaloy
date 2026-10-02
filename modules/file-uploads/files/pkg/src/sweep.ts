// The housekeeping sweep, written against a port rather than against the database.
//
// This package has **zero runtime dependencies** and that is the whole reason it exists.
// The sweep has to be callable from `packages/queue/src/jobs/storage-sweep.ts`, and a job
// file that imported `@repo/db` would pull the schema barrel — `import.meta.glob`, which
// only Vite understands — into a workspace that does not compile with Vite's types. So the
// port is declared here, `apps/api/src/lib/storage-sweep.ts` implements it over the real
// Drizzle client, and the job file sees neither. Same arrangement, and the same reason, as
// `packages/billing`'s `BillingStore`.

/** One row, reduced to what the sweep actually reads. */
export interface SweepRow {
  id: string;
  key: string;
  tenantId: string;
}

/**
 * Everything the sweep does to the outside world.
 *
 * Deliberately five narrow methods rather than a database handle. A port this small is
 * implementable in a test with a plain object, and it cannot be used to write a query the
 * tenant boundary does not cover.
 */
export interface SweepPort {
  /** Rows stuck in `deleting`, oldest first, at most `limit` of them. */
  listDeleting(limit: number): Promise<SweepRow[]>;
  /** `pending` rows created before `before` — uploads nobody ever completed. */
  listAbandoned(before: Date, limit: number): Promise<SweepRow[]>;
  /** Rows soft-deleted before `before`, for the purge past `STORAGE_PURGE_AFTER_DAYS`. */
  listPurgeable(before: Date, limit: number): Promise<SweepRow[]>;
  /** Mark a row `deleted`, with its `deletedAt`. */
  markDeleted(row: SweepRow): Promise<void>;
  /** Remove a row outright. Only ever called once its object is gone. */
  purge(row: SweepRow): Promise<void>;
  /**
   * Delete the object at `key`, treating "it was not there" as success.
   *
   * Every caller is removing a row whose bytes must not outlive it, so a missing object
   * means the outcome already holds. The implementation is what decides that, because only
   * it knows the capability's error codes.
   */
  forget(key: string): Promise<void>;
  /** `STORAGE_PURGE_AFTER_DAYS`, already read and validated. */
  purgeAfterDays: number;
}

/** How many rows one pass takes. Three passes, so one message does at most 3× this. */
export const SWEEP_BATCH = 100;

/** How long an upload may sit `pending` before the sweep assumes it was abandoned. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Days a soft-deleted row survives when `STORAGE_PURGE_AFTER_DAYS` is unset. */
export const DEFAULT_PURGE_AFTER_DAYS = 30;

/** What one sweep did, for the caller's log and for a test. */
export interface SweepResult {
  /** `deleting` rows whose object delete this pass finished. */
  finished: number;
  /** `pending` rows, and any bytes behind them, this pass removed. */
  abandoned: number;
  /** `deleted` rows past the purge window this pass dropped. */
  purged: number;
}

/**
 * Run one sweep.
 *
 * Three passes, and each one is the recovery for a specific way a request can stop early:
 *
 *   `deleting`  — `DELETE /files/:id` marked the row and then the Worker died before the
 *                 object delete landed. Finish it.
 *   `pending`   — somebody asked for an upload target and never completed the upload.
 *                 After 24 hours, take the row and anything at its key.
 *   `deleted`   — a soft-deleted row past the purge window. Drop it.
 *
 * Each pass takes a bounded batch rather than everything it finds. A sweep that tried to
 * clear an unbounded backlog in one message would exceed the Worker's CPU budget and be
 * retried from the start, forever.
 *
 * `now` is a parameter rather than a `new Date()` inside, so a test can drive the clock
 * across both windows instead of sleeping through them.
 */
export async function runStorageSweep(
  port: SweepPort,
  now: Date
): Promise<SweepResult> {
  const result: SweepResult = { abandoned: 0, finished: 0, purged: 0 };

  for (const row of await port.listDeleting(SWEEP_BATCH)) {
    await port.forget(row.key);
    await port.markDeleted(row);
    result.finished += 1;
  }

  const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
  for (const row of await port.listAbandoned(abandonedBefore, SWEEP_BATCH)) {
    // The object usually is not there — that is what "abandoned" means — and `forget`
    // treats a missing key as done rather than as a failure.
    await port.forget(row.key);
    await port.purge(row);
    result.abandoned += 1;
  }

  const purgeBefore = new Date(
    now.getTime() - port.purgeAfterDays * 24 * 60 * 60 * 1000
  );
  for (const row of await port.listPurgeable(purgeBefore, SWEEP_BATCH)) {
    await port.purge(row);
    result.purged += 1;
  }

  return result;
}

/** How a job reaches a port when nothing else has built one. See `setSweepRunner`. */
export type SweepRunner = (now: Date) => Promise<SweepResult>;

let runner: SweepRunner | undefined;

/**
 * Tell `@repo/file-uploads` how to run a sweep.
 *
 * `apps/api/src/lib/storage-sweep.ts` calls this at module load with a function that opens
 * a request-less database client and builds the port. That file is imported by
 * `apps/api/src/routes/files.ts`, so the registration is in place before any message can
 * arrive. Calling it a second time replaces the runner, which is what a test wants and
 * what nothing else should do.
 */
export function setSweepRunner(run: SweepRunner): void {
  runner = run;
}

/**
 * Run a sweep through whatever `setSweepRunner` registered.
 *
 * Throws when nothing has. That is a wiring mistake rather than a runtime condition — it
 * means `apps/api/src/lib/storage-sweep.ts` was deleted or is no longer imported — so the
 * message fails loudly instead of the sweep silently doing nothing every night.
 */
export function sweep(now: Date): Promise<SweepResult> {
  if (!runner) {
    throw new Error(
      "No storage-sweep runner is registered. `apps/api/src/lib/storage-sweep.ts` registers one at module load; check that `apps/api/src/routes/files.ts` still imports it."
    );
  }
  return runner(now);
}
