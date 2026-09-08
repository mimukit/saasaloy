import { matchesParsed, parseCron } from "./cron";
import { QueueError } from "./provider";
import type {
  EnqueueOptions,
  Job,
  JobConfig,
  JobContext,
  QueueEnv,
  QueueProvider,
  Schedule,
  ScheduleConfig,
  StandardSchema,
} from "./provider";

// The provider registry, the job and schedule tables, and the `createQueue(env)` factory
// behind them. This file holds everything that is true of *every* provider — selection,
// job lookup, payload validation, error normalization, schedule matching — so a provider
// module only ever ships an `enqueue()`.

export interface QueueConfig {
  providers: QueueProvider[];
  jobs: Job[];
  schedules: Schedule[];
}

/** What a caller enqueues with. Returned by `createQueue(env)`. */
export interface QueueClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  /**
   * Hand a job to the provider. Throws `QueueError("unknown_job")` when nothing is
   * registered under `name`, and `QueueError("invalid_job")` when the payload fails the
   * job's schema. Neither is retryable.
   */
  enqueue(
    name: string,
    payload?: unknown,
    options?: EnqueueOptions
  ): Promise<void>;
}

export interface QueueRegistry {
  providers: QueueProvider[];
  jobs: Job[];
  schedules: Schedule[];
  create(env: QueueEnv): QueueClient;
  dispatch(
    name: string,
    payload: unknown,
    ctx?: Partial<JobContext>
  ): Promise<void>;
  dueSchedules(at: Date): Schedule[];
}

/**
 * Build the registry. All three arrays are patch points: `providers` for every
 * `queue-<provider>` module, `jobs` and `schedules` for every feature that declares
 * background work. See `src/index.ts`.
 */
export function defineQueue(config: QueueConfig): QueueRegistry {
  const { jobs, providers, schedules } = config;

  const find = (name: string): Job => {
    const job = jobs.find((candidate) => candidate.name === name);
    if (!job) {
      const registered = jobs.map((candidate) => candidate.name);
      throw new QueueError(
        "unknown_job",
        `No job named "${name}" is registered. ${
          registered.length > 0
            ? `Registered jobs: ${registered.join(", ")}.`
            : "The jobs table in packages/queue/src/index.ts is empty."
        }`
      );
    }
    return job;
  };

  return {
    create(env: QueueEnv): QueueClient {
      const provider = selectProvider(providers, env.QUEUE_PROVIDER);

      return {
        async enqueue(
          name: string,
          payload?: unknown,
          options: EnqueueOptions = {}
        ): Promise<void> {
          // Lookup and validation sit outside the `try` on purpose: an unregistered name
          // or a payload the schema refuses is the caller's mistake, not the provider's,
          // and wrapping either as `provider_error` would blame the wrong layer. Both
          // still throw a `QueueError`, because `enqueue` promises exactly one error
          // shape.
          const job = find(name);
          const parsed = await parse(job, payload);

          try {
            await provider.enqueue(env, job, parsed, options);
          } catch (error) {
            throw normalize(error, `${provider.name}: enqueue failed`);
          }
        },
        provider: provider.name,
      };
    },
    /**
     * Run a job by name. This is the entry a provider's consumer calls once the platform
     * delivers a message: it re-validates the payload (the message may predate a schema
     * change), builds the context the handler sees, and normalizes whatever the handler
     * throws.
     */
    async dispatch(
      name: string,
      payload: unknown,
      ctx: Partial<JobContext> = {}
    ): Promise<void> {
      const job = find(name);
      const parsed = await parse(job, payload);

      try {
        await job.run(parsed, resolveContext(ctx));
      } catch (error) {
        throw normalize(error, `job "${name}" failed`);
      }
    },
    /**
     * Every schedule whose expression matches this instant, in UTC and at minute
     * resolution. A provider's cron tick calls this and enqueues one message per hit; it
     * never runs the job inline, so a scheduled run gets the same retries and
     * dead-lettering as any other.
     */
    dueSchedules(at: Date): Schedule[] {
      return schedules.filter((schedule) =>
        matchesParsed(parseCron(schedule.cron), at)
      );
    },
    jobs,
    providers,
    schedules,
  };
}

/**
 * Declare a job. The payload type comes from `schema` when one is given, and from the
 * handler's own annotation when it is not; either way the returned `Job` has it erased,
 * so one `jobs` array holds jobs with unrelated payloads.
 *
 * ```ts
 * export const sendDigest = () =>
 *   defineJob({
 *     name: "send-digest",
 *     schema: z.object({ userId: z.string() }),
 *     handler: async ({ userId }, ctx) => {
 *       await ctx.step("load", () => loadUser(userId));
 *     },
 *   });
 * ```
 */
export function defineJob<Payload>(config: JobConfig<Payload>): Job {
  const { durable = false, handler, name, schema } = config;

  return {
    durable,
    name,
    async parse(payload: unknown): Promise<unknown> {
      return schema ? await validate(name, schema, payload) : payload;
    },
    async run(payload: unknown, ctx: JobContext): Promise<void> {
      await handler(payload as Payload, ctx);
    },
  };
}

/**
 * Declare a schedule. The cron expression is parsed here, so a malformed one throws
 * `QueueError("invalid_job")` at module load rather than never firing in production.
 */
export function defineSchedule(config: ScheduleConfig): Schedule {
  parseCron(config.cron);
  return { ...config, payload: config.payload };
}

/**
 * `QUEUE_PROVIDER` is required even when exactly one provider is installed, and an
 * unknown value is an error rather than a fallback. Both directions of the silent failure
 * are worse than a throw: a production deploy that quietly stops running background work,
 * and a test run that quietly starts sending it to a real queue.
 */
function selectProvider(
  providers: QueueProvider[],
  selected: string | undefined
): QueueProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add queue-memory`.";

  if (!selected) {
    throw new Error(`QUEUE_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `QUEUE_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

async function validate(
  name: string,
  schema: StandardSchema<unknown>,
  payload: unknown
): Promise<unknown> {
  const result = await schema["~standard"].validate(payload);
  if (result.issues && result.issues.length > 0) {
    const detail = result.issues
      .map((issue) => {
        const path = issue.path?.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new QueueError(
      "invalid_job",
      `Payload for job "${name}" failed validation — ${detail}`
    );
  }
  return result.value;
}

/**
 * A provider is contractually responsible for normalizing its own failures, and so is a
 * job handler that knows what its failure means. Neither is guaranteed to: a raw
 * `TypeError` from a failed `fetch` reaching a consumer would break the one-error-shape
 * promise, and a consumer reading `retryable` off it would get `undefined`. Re-throw a
 * well-formed error untouched; wrap anything else, keeping the original in `cause`.
 */
/**
 * Validate a payload and keep the one-error-shape promise. `job.parse` already throws
 * `QueueError("invalid_job")` when the schema *rejects* the payload, but a Standard
 * Schema whose `validate` itself *throws* would otherwise escape as a raw `Error`. A
 * schema that explodes is still the caller's problem, so it maps to `invalid_job` and
 * stays non-retryable; re-running it would explode again.
 */
async function parse(job: Job, payload: unknown): Promise<unknown> {
  try {
    return await job.parse(payload);
  } catch (error) {
    if (error instanceof QueueError) {
      throw error;
    }
    throw new QueueError(
      "invalid_job",
      `Payload for job "${job.name}" could not be validated — the schema threw`,
      { cause: error, retryable: false }
    );
  }
}

function normalize(error: unknown, message: string): QueueError {
  if (error instanceof QueueError) {
    return error;
  }
  return new QueueError("provider_error", message, {
    cause: error,
    retryable: false,
  });
}

/**
 * Fill in the half of the context a provider did not supply. A provider that cannot
 * checkpoint passes nothing and gets the honest degenerate behaviour: the step runs
 * inline, and the sleep returns at once. A handler written against `ctx` therefore runs
 * on every provider, which is the point of shipping `step` and `sleep` in the contract
 * before any provider implements them (issue #131).
 */
function resolveContext(ctx: Partial<JobContext>): JobContext {
  return {
    attempt: ctx.attempt ?? 0,
    sleep: ctx.sleep ?? noSleep,
    step: ctx.step ?? runInline,
  };
}

function noSleep(): Promise<void> {
  return Promise.resolve();
}

async function runInline<T>(
  _name: string,
  fn: () => T | PromiseLike<T>
): Promise<T> {
  return await fn();
}
