import { createQueue, dueSchedules } from "../index";
import { QueueError } from "../provider";
import type {
  EnqueueOptions,
  Job,
  JobContext,
  QueueEnv,
  QueueProvider,
} from "../provider";

// The local provider: the same Worker runs the job, inline, the moment it is enqueued.
// No account, no paid plan, no binding, no network — which is what makes `pnpm dev` and
// `pnpm test` work on a machine that cannot reach Cloudflare Queues (AGENTS.md, "Ship a
// local provider").
//
// Set `QUEUE_PROVIDER=memory` to select it. It registers in the `providers` array in
// packages/queue/src/index.ts exactly like any other provider, so the job lookup, the
// schema validation and the error normalization under test are the real ones; only the
// transport differs.
//
// It also records what it did. `ran`, `failed`, `steps`, `sleeps` and `scheduled` are
// the assertion surface a test reads instead of scraping the log, and `reset()` clears
// them between cases.
//
// The import of `../index` above is circular: the barrel imports this file to register
// the provider. It is safe because `createQueue` and `dueSchedules` are hoisted function
// declarations read inside a function body, never at module evaluation time. Keep it
// that way; a `const` pulled from the barrel would be in its temporal dead zone on load.

/** The value `QUEUE_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "memory";

export interface MemoryQueueOptions {
  /**
   * Re-throw a handler's failure out of `enqueue` instead of only recording it.
   *
   * Off by default, because that is what production does: a real `enqueue` returns as
   * soon as the service accepts the message, and the handler's failure surfaces later,
   * on the consumer. A route that behaves differently under `memory` than under
   * `cloudflare` would defeat the point of developing against this provider. Turn it on
   * in a test that wants the throw at the call site.
   */
  rethrow?: boolean;
}

/** One inline run, successful or not. */
export interface MemoryQueueRun {
  /** The registered job's name. */
  job: string;
  payload: unknown;
  /** What the caller asked to wait, in seconds. Recorded, never slept. */
  delaySeconds?: number;
  /** Each `ctx.step` name the handler reached, in order. */
  steps: string[];
  /** Each `ctx.sleep` duration the handler asked for, in seconds. */
  sleeps: number[];
}

/** A run whose handler threw, with the failure normalized the way a consumer sees it. */
export interface MemoryQueueFailure extends MemoryQueueRun {
  error: QueueError;
}

/** What `runDue` did with one due schedule. */
export interface MemoryQueueTick {
  /** The schedule's own name. */
  schedule: string;
  /** The job it enqueued. */
  job: string;
}

/**
 * The provider plus its recorder. The extra members are deliberately not on
 * `QueueProvider`: the core knows nothing about them, and a test reaches them through
 * the value this factory returned, not through `createQueue(env)`.
 */
export interface MemoryQueue extends QueueProvider {
  /** Every job that ran, in enqueue order, whether or not its handler threw. */
  readonly ran: MemoryQueueRun[];
  /** The subset whose handler threw. Never empty by accident — assert on it. */
  readonly failed: MemoryQueueFailure[];
  /** Every `ctx.step` name across every run, flattened, in order. */
  readonly steps: string[];
  /** Every `ctx.sleep` duration across every run, flattened, in order. */
  readonly sleeps: number[];
  /** Every schedule `runDue` fired, in order. */
  readonly scheduled: MemoryQueueTick[];
  /**
   * Run the schedules due at this instant, standing in for a provider's cron tick. Like
   * the real tick it enqueues rather than calling the handler itself, so a scheduled run
   * goes through the same path as one a route enqueued.
   *
   * `env` defaults to selecting this provider, so a test that has registered nothing
   * else can call `runDue(new Date(...))` with no argument.
   */
  runDue(at: Date, env?: QueueEnv): Promise<MemoryQueueTick[]>;
  /** Drop every recording. Call it between tests. */
  reset(): void;
}

/**
 * Build the in-process provider.
 *
 * ```ts
 * const jobs = memory();
 * await createQueue({ QUEUE_PROVIDER: "memory" }).enqueue("example", { message: "hi" });
 * assert.deepEqual(jobs.steps, ["log"]);
 * ```
 */
export function memory(options: MemoryQueueOptions = {}): MemoryQueue {
  const rethrow = options.rethrow ?? false;
  const ran: MemoryQueueRun[] = [];
  const failed: MemoryQueueFailure[] = [];
  const scheduled: MemoryQueueTick[] = [];

  const provider: MemoryQueue = {
    async enqueue(
      _env: QueueEnv,
      job: Job,
      payload: unknown,
      enqueueOptions: EnqueueOptions
    ): Promise<void> {
      // A durable job is accepted rather than refused, which is the one place this
      // provider deliberately disagrees with `queue-cloudflare`. Nothing here survives
      // the process, so nothing here is durable either — but refusing would mean a
      // handler written for the Workflows path (issue #131) could not be run locally at
      // all, and a provider that blocks local development is not a local provider. The
      // steps run inline and are recorded; the warn line is the honest part.
      if (job.durable) {
        console.warn(
          `[queue] job "${job.name}" asks for a durable run. The memory provider runs ` +
            "its steps inline and records them, but it checkpoints nothing and replays " +
            "nothing — do not read a passing local run as proof the job resumes."
        );
      }

      // The delay is recorded, not slept. Holding the caller for `delaySeconds` would
      // stall a `pnpm dev` request for as long as production would have queued it, and
      // a test asserting on the delay wants the number, not the wait.
      const run: MemoryQueueRun = {
        job: job.name,
        payload,
        sleeps: [],
        steps: [],
        ...(enqueueOptions.delaySeconds === undefined
          ? {}
          : { delaySeconds: enqueueOptions.delaySeconds }),
      };
      ran.push(run);

      try {
        await job.run(payload, recordingContext(run));
      } catch (error) {
        const failure = asQueueError(error, job.name);
        failed.push({ ...run, error: failure });
        console.error(
          `[queue] job "${job.name}" failed inline (${failure.code})`,
          failure
        );
        if (rethrow) {
          throw failure;
        }
      }
    },

    failed,
    name: PROVIDER_NAME,
    ran,

    reset(): void {
      ran.length = 0;
      failed.length = 0;
      scheduled.length = 0;
    },

    async runDue(at: Date, env?: QueueEnv): Promise<MemoryQueueTick[]> {
      const due = dueSchedules(at);
      if (due.length === 0) {
        return [];
      }

      const client = createQueue(env ?? { QUEUE_PROVIDER: PROVIDER_NAME });
      const fired: MemoryQueueTick[] = [];
      for (const schedule of due) {
        const tick: MemoryQueueTick = {
          job: schedule.job,
          schedule: schedule.name,
        };
        scheduled.push(tick);
        fired.push(tick);
        // One unenqueueable schedule must not cost the others their tick, exactly as in
        // the Cloudflare tick. The recording above already happened, so a test can see
        // that the schedule fired even when its job is gone.
        try {
          await client.enqueue(schedule.job, schedule.payload);
        } catch (error) {
          console.error(
            `[queue] schedule "${schedule.name}" could not enqueue job "${schedule.job}"`,
            error
          );
        }
      }
      return fired;
    },

    scheduled,

    get sleeps(): number[] {
      return ran.flatMap((run) => run.sleeps);
    },

    get steps(): string[] {
      return ran.flatMap((run) => run.steps);
    },
  };

  return provider;
}

/**
 * The context the inline run sees. `step` records the name and calls the function —
 * there is nothing to replay, because the run never survives the process — and `sleep`
 * records the duration and returns at once, because a real wait here would only make a
 * test slow. Both are the honest degenerate behaviour the contract describes for a
 * provider that cannot checkpoint.
 */
function recordingContext(run: MemoryQueueRun): JobContext {
  return {
    attempt: 0,
    sleep(seconds: number): Promise<void> {
      run.sleeps.push(seconds);
      return Promise.resolve();
    },
    async step<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
      run.steps.push(name);
      return await fn();
    },
  };
}

function asQueueError(error: unknown, jobName: string): QueueError {
  if (error instanceof QueueError) {
    return error;
  }
  return new QueueError(
    "provider_error",
    `job "${jobName}" failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error, retryable: false }
  );
}
