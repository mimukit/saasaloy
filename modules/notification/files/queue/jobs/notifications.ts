import { defineJob, defineSchedule } from "../define";
import type { Job, Schedule } from "../provider";

// The daily notification prune, as the `jobs` and `schedules` tables register it. It
// ships only when `queue` is installed; without it, call `pruneNotifications` from
// `@repo/db/repositories/notifications` in your own cron.
//
// This file holds no query. A job file in `packages/queue` that imported `@repo/db` would
// pull the schema barrel's `import.meta.glob` into a workspace that does not compile with
// Vite's types. So `apps/api/src/lib/notification-prune.ts` hands in the function that
// opens a database and prunes, through `setNotificationPruneRunner`, when the Worker
// loads. `packages/billing` and `packages/file-uploads` split their jobs the same way.
//
// Factories, not bare constants, because the tables register a *call*: that is what the
// `plugin-array` patch appends and what `saasaloy remove` takes back out.

/** The job's name, as the schedule below and a `jobs` table trace both spell it. */
export const PRUNE_NOTIFICATIONS_JOB = "notification.prune";

/** The schedule's own name, distinct from the job's. Both are required. */
export const PRUNE_NOTIFICATIONS_SCHEDULE = "notification.prune.daily";

/** 03:30 UTC daily, outside the hours a project's own traffic usually peaks in. */
export const PRUNE_NOTIFICATIONS_CRON = "30 3 * * *";

/** Deletes the rows past retention as of `now`, and answers how many went. */
export type NotificationPruneRunner = (now: Date) => Promise<number>;

let runner: NotificationPruneRunner | undefined;

/**
 * Tell the job how to prune. `apps/api/src/lib/notification-prune.ts` calls this once,
 * when `apps/api/src/worker.ts` builds its handler table. A second call replaces the
 * runner, which is what a test wants and what nothing else should do.
 */
export function setNotificationPruneRunner(run: NotificationPruneRunner): void {
  runner = run;
}

export const pruneNotificationsJob = (): Job =>
  defineJob({
    // The job takes no payload, so it declares no schema.
    handler: (_payload, ctx) =>
      ctx.step("prune", async () => {
        // A missing runner throws, so the message retries and lands in the dead-letter
        // queue rather than reporting a prune that never ran.
        if (!runner) {
          throw new Error(
            "notification.prune ran before apps/api registered its runner. Check that apps/api/src/worker.ts lists notificationPruneHandlers() in its handlers."
          );
        }
        await runner(new Date());
      }),
    name: PRUNE_NOTIFICATIONS_JOB,
  });

export const pruneNotificationsSchedule = (): Schedule =>
  defineSchedule({
    cron: PRUNE_NOTIFICATIONS_CRON,
    job: PRUNE_NOTIFICATIONS_JOB,
    name: PRUNE_NOTIFICATIONS_SCHEDULE,
  });
