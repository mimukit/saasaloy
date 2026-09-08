// The provider contract every `queue-<provider>` module implements, the job and
// schedule shapes a feature declares, and the single error type providers normalize
// their failures into. Nothing in this file imports a vendor SDK or a Workers binding —
// the core of `packages/queue` is provider-agnostic and has zero runtime dependencies
// (ADR 0033, ADR 0020).

/**
 * The Worker environment, handed to `createQueue(env)` whole rather than one binding at
 * a time. Deliberately opaque: *which* key a provider reads (a `JOBS` queue binding, an
 * API token, nothing at all) is exactly what the calling route must not have to know for
 * providers to stay swappable. The core never reads `process.env`.
 */
export interface QueueEnv {
  /** Which registered provider carries the work. Always required — there is no default. */
  QUEUE_PROVIDER?: string;
  [key: string]: unknown;
}

/**
 * The slice of [Standard Schema](https://standardschema.dev) the core uses. Declared
 * structurally rather than imported, so `packages/queue` keeps zero runtime
 * dependencies and a project can still hand `defineJob` a zod, valibot or arktype
 * schema.
 */
export interface StandardSchema<Output = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) =>
      StandardSchemaResult<Output> | PromiseLike<StandardSchemaResult<Output>>;
  };
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly unknown[];
}

export interface StandardSchemaResult<Output = unknown> {
  readonly value?: Output;
  readonly issues?: readonly StandardSchemaIssue[];
}

/**
 * What a handler receives besides its payload. `step` and `sleep` are the durable half
 * of the contract: a provider that can checkpoint (Cloudflare Workflows, tracked in
 * issue #131) records each step's result and resumes after a sleep, and a provider that
 * cannot runs the step inline and returns from the sleep at once. Writing a handler
 * against `ctx` therefore costs nothing today and is what makes `durable: true`
 * portable later.
 */
export interface JobContext {
  /** How many times this payload has been delivered before. First delivery is `0`. */
  readonly attempt: number;
  /**
   * Run one named unit of work. A durable provider runs it once and replays the
   * recorded result on a later attempt; every other provider just calls `fn`.
   */
  step<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T>;
  /** Wait this many seconds. A non-durable provider returns immediately. */
  sleep(seconds: number): Promise<void>;
}

/** What a caller passes `defineJob`. `Payload` is inferred from `schema` or declared. */
export interface JobConfig<Payload> {
  /** Stable identifier, carried in the message and looked up on delivery. */
  name: string;
  /** Optional Standard Schema. When present it runs at `enqueue` and again on delivery. */
  schema?: StandardSchema<Payload>;
  /**
   * Ask for a durable, resumable run. A provider that cannot offer one rejects the
   * enqueue rather than silently running the job as a plain message.
   */
  durable?: boolean;
  handler: (payload: Payload, ctx: JobContext) => void | PromiseLike<void>;
}

/**
 * A registered job, with its payload type erased. `defineJob` closes over the typed
 * handler and returns this, so `defineQueue`'s `jobs` table can hold jobs with
 * unrelated payloads and still be a plain array a `plugin-array` patch appends to.
 */
export interface Job {
  readonly name: string;
  readonly durable: boolean;
  /** Validate a payload, or throw `QueueError("invalid_job")`. Returns the parsed value. */
  parse(payload: unknown): Promise<unknown>;
  /** Run the handler. The caller supplies the context; see `JobContext`. */
  run(payload: unknown, ctx: JobContext): Promise<void>;
}

/** What a caller passes `defineSchedule`. */
export interface ScheduleConfig {
  /** Stable identifier for this schedule, distinct from the job's name. */
  name: string;
  /** A five-field cron expression, minute-resolution, evaluated in UTC. */
  cron: string;
  /** The name of the job to enqueue when the expression matches the tick. */
  job: string;
  /** The payload to enqueue. Omit for a job that takes none. */
  payload?: unknown;
}

/** A registered schedule. Same shape as its config; the cron is parsed on definition. */
export interface Schedule extends ScheduleConfig {
  readonly payload: unknown;
}

export interface EnqueueOptions {
  /** Hold the message this long before it becomes deliverable. */
  delaySeconds?: number;
}

export interface QueueProvider {
  /** The value `QUEUE_PROVIDER` must hold to select this provider (e.g. "cloudflare"). */
  name: string;
  /**
   * Hand the work to the underlying service. The core has already looked the job up and
   * validated the payload, so a provider only serializes and sends — and maps its own
   * failures onto `QueueError`.
   */
  enqueue(
    env: QueueEnv,
    job: Job,
    payload: unknown,
    options: EnqueueOptions
  ): Promise<void>;
}

/**
 * Normalized failure codes. Providers map their own vendor codes onto these and keep the
 * raw one in `providerCode`, so a caller can branch on a stable value without learning
 * any provider's error vocabulary.
 */
export type QueueErrorCode =
  /**
   * The payload failed the job's schema. Raised by the core, at `enqueue` and again on
   * delivery, and never retryable — the same bytes fail the same way forever.
   */
  | "invalid_job"
  /**
   * No job with that name is registered. On `enqueue` it is a typo; on delivery it is an
   * in-flight message for a feature that has since been removed, which a consumer sends
   * straight to the dead-letter queue rather than dropping.
   */
  | "unknown_job"
  | "too_large"
  | "rate_limited"
  | "provider_error";

export interface QueueErrorOptions {
  /** Whether running the same work again could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "QUEUE_FULL"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The one error `enqueue` and `dispatch` throw, including the validation the core does
 * before a provider is reached, so a caller's `catch` only ever has one shape to handle.
 * (Selecting the provider happens earlier, in `createQueue(env)`, and a bad
 * `QUEUE_PROVIDER` throws a plain `Error` there: it is a deploy-time misconfiguration,
 * not a failed job.)
 *
 * The package itself never retries. `retryable` is the hook a consumer reads to decide
 * between asking the platform for another delivery and sending the message to the
 * dead-letter queue.
 */
export class QueueError extends Error {
  readonly code: QueueErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: QueueErrorCode,
    message: string,
    options: QueueErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "QueueError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
