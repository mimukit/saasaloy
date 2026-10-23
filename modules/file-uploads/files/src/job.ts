import { sweep } from "./sweep";

// The sweep, as the `queue` capability's `jobs` and `schedules` tables register it.
//
// The file lives in this package rather than in `packages/queue/src/jobs/`, and both
// reasons matter. A file entry targeting `@queue/...` cannot be shipped conditionally: the
// applier resolves the alias before it applies `onlyWith`, so a project with no `queue`
// capability would fail `saasaloy add file-uploads` on an unknown alias. And a job file in
// `packages/queue` that reached the database would pull the schema barrel's
// `import.meta.glob` into a workspace that does not compile with Vite's types.
//
// So the job ships here unconditionally and goes nowhere until the two `plugin-array`
// patches register it, exactly as `packages/billing` registers its own. In a project
// without `queue` those patches are skipped with a warning and this file is dead code.
//
// Factories, not bare constants, because the tables register a *call* — that is what the
// patch appends and what `saasaloy remove` takes back out.

/** The job's name, as the schedule below and a `jobs` table trace both spell it. */
export const STORAGE_SWEEP_JOB = "file-uploads.storage-sweep";

/** The schedule's own name, distinct from the job's. Both are required. */
export const STORAGE_SWEEP_SCHEDULE = "file-uploads.storage-sweep.daily";

/** 04:00 UTC daily. Outside the hours a project's own traffic usually peaks in. */
export const STORAGE_SWEEP_CRON = "0 4 * * *";

/**
 * The slice of `@repo/queue`'s `Job` this file implements, declared here rather than
 * imported.
 *
 * This package has zero runtime dependencies and `packages/queue/src/index.ts` imports it
 * to register the job, so importing `@repo/queue` back would put a cycle in the workspace
 * graph for one interface. The shape is structural: let it drift and the scaffolded
 * project's `jobs: [storageSweepJob()]` line fails `pnpm typecheck`, which is where a
 * drift should surface.
 */
export interface RegisteredJob {
  readonly name: string;
  readonly durable: boolean;
  parse(payload: unknown): Promise<unknown>;
  run(payload: unknown, ctx: unknown): Promise<void>;
}

/** The same arrangement for `Schedule`, and for the same reason. */
export interface RegisteredSchedule {
  readonly name: string;
  readonly cron: string;
  readonly job: string;
  readonly payload: unknown;
}

export const storageSweepJob = (): RegisteredJob => ({
  durable: false,
  name: STORAGE_SWEEP_JOB,
  // No Standard Schema. The sweep takes no payload, and a schema would be this package's
  // first npm dependency.
  parse: (payload: unknown) => Promise.resolve(payload),
  // The result is discarded rather than logged: `file-uploads` does not depend on
  // `logger`, and a bare `console.log` is a defect everywhere in this repo that is not a
  // console provider. Call `sweep(now)` yourself if you want the counts — it returns them.
  run: async () => {
    await sweep(new Date());
  },
});

export const storageSweepSchedule = (): RegisteredSchedule => ({
  cron: STORAGE_SWEEP_CRON,
  job: STORAGE_SWEEP_JOB,
  name: STORAGE_SWEEP_SCHEDULE,
  payload: {},
});
