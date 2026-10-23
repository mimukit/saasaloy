// `@repo/file-uploads` — the part of the feature that has to be reachable from more than
// one workspace, and therefore cannot live in `apps/api`.
//
// Today that is the sweep and its job registration, and nothing else. The routes, the
// repository and the two public URLs all live where they are used; this package exists
// because `packages/queue` has to reach the sweep and must not import `@repo/db`. See the
// comments at the top of `./sweep.ts` and `./job.ts` for why.
//
// Zero runtime dependencies, and keep it that way. Anything that needs Drizzle, the
// storage capability or a Worker binding belongs in `apps/api/src/lib/storage-sweep.ts`,
// on the other side of the port.

export {
  STORAGE_SWEEP_CRON,
  STORAGE_SWEEP_JOB,
  STORAGE_SWEEP_SCHEDULE,
  storageSweepJob,
  storageSweepSchedule,
} from "./job";
export type { RegisteredJob, RegisteredSchedule } from "./job";
export {
  ABANDONED_AFTER_MS,
  DEFAULT_PURGE_AFTER_DAYS,
  runStorageSweep,
  setSweepRunner,
  SWEEP_BATCH,
  sweep,
} from "./sweep";
export type { SweepPort, SweepResult, SweepRow, SweepRunner } from "./sweep";
