import { createQueue, dispatch, dueSchedules } from "../index";
import { QueueError } from "../provider";
import type {
  EnqueueOptions,
  Job,
  QueueEnv,
  QueueErrorCode,
  QueueProvider,
} from "../provider";

// Cloudflare Queues, reached through Worker bindings, plus the one Cron Trigger tick the
// schedule table needs. There is no API token and no secret here — the `queues.producers`
// entries in apps/api/wrangler.jsonc *are* the credential, which is why this module
// declares no envVars of its own.
//
// Three exports' worth of surface in one file, because a provider ships one runtime file
// (ADR 0033): `cloudflare()` is the producer half that registers in the `providers` array
// in packages/queue/src/index.ts, and `cloudflareQueueHandlers()` is the consumer half
// that registers in the `handlers` array in apps/api/src/worker.ts.
//
// `Queue`, `Message`, `MessageBatch`, `ScheduledController` and `ExecutionContext` are
// ambient globals from @cloudflare/workers-types, which packages/queue already carries as
// a devDependency — nothing is imported and there is no npm dependency to add.
//
// The import of `../index` above is circular: the barrel imports this file to register
// the provider. It is safe because every binding used here is a hoisted function
// declaration read inside a function body, never at module evaluation time. Keep it that
// way; a `const` pulled from the barrel would be in its temporal dead zone on load.

/** The value `QUEUE_PROVIDER` must hold for anything in this file to do work. */
const PROVIDER_NAME = "cloudflare";

/** First retry delay, in seconds. Each further attempt doubles it: 30, 60, 120. */
const DEFAULT_BACKOFF_SECONDS = 30;

export interface CloudflareQueueOptions {
  /** Producer binding name in wrangler.jsonc. The module's own patch writes `JOBS`. */
  binding?: string;
  /** Dead-letter producer binding. The module's own patch writes `JOBS_DLQ`. */
  deadLetterBinding?: string;
  /**
   * First retry delay in seconds; each further attempt doubles it. With the patched
   * `max_retries: 3` that is 30, 60 and 120 seconds before the message is dead-lettered.
   * This and `max_retries` in wrangler.jsonc are the two knobs worth turning.
   */
  backoffBaseSeconds?: number;
}

/** What a message carries. Small on purpose: the job table holds everything else. */
export interface QueueMessageBody {
  /** The registered job's name, looked up through the core on delivery. */
  job: string;
  payload: unknown;
}

/**
 * One module's non-`fetch` Worker exports, structurally identical to `HandlerSet` in
 * apps/api/src/worker.ts. Declared here rather than imported because `packages/queue`
 * does not depend on `@repo/api` and must not start (ADR 0033, ADR 0020).
 */
export interface CloudflareHandlerSet {
  queue: (
    batch: MessageBatch<unknown>,
    env: unknown,
    ctx: ExecutionContext
  ) => Promise<void>;
  scheduled: (
    event: ScheduledController,
    env: unknown,
    ctx: ExecutionContext
  ) => Promise<void>;
}

/**
 * Cloudflare's runtime rejects a `send` by throwing an error carrying a `code` or a
 * `name`. Those strings appear nowhere in @cloudflare/workers-types — they are
 * runtime-only values, so this table is ours to keep accurate. Anything unlisted falls
 * through to `provider_error` / `retryable: false`: guessing that an unknown failure is
 * safe to retry is the more expensive mistake, because a job that already ran once runs
 * twice. Add a row when you meet a new code in the wild.
 */
const ERROR_CODES: Record<
  string,
  { code: QueueErrorCode; retryable: boolean }
> = {
  // The 128 KB per-message and 256 KB per-batch limits. The same bytes fail forever.
  QUEUE_BATCH_TOO_LARGE: { code: "too_large", retryable: false },
  QUEUE_MESSAGE_TOO_LARGE: { code: "too_large", retryable: false },
  // Backlog full, or the per-queue write ceiling. Both clear on their own.
  QUEUE_FULL: { code: "rate_limited", retryable: true },
  QUEUE_RATE_LIMITED: { code: "rate_limited", retryable: true },
  // Cloudflare's own fault rather than the message's, so re-sending is not doomed.
  QUEUE_INTERNAL_ERROR: { code: "provider_error", retryable: true },
};

/**
 * The producer half. Registered in the `providers` array in packages/queue/src/index.ts
 * and selected when `QUEUE_PROVIDER=cloudflare`.
 */
export function cloudflare(
  options: CloudflareQueueOptions = {}
): QueueProvider {
  const bindingName = options.binding ?? "JOBS";

  return {
    async enqueue(
      env: QueueEnv,
      job: Job,
      payload: unknown,
      enqueueOptions: EnqueueOptions
    ): Promise<void> {
      // Refuse rather than quietly downgrade. A handler written against `ctx.step` and
      // enqueued as a plain message still runs, but it loses the replay the caller asked
      // for, and it loses it silently — which is exactly the failure a `durable` flag
      // exists to prevent.
      if (job.durable) {
        throw new QueueError(
          "provider_error",
          `Job "${job.name}" asks for a durable run, which Cloudflare Queues cannot ` +
            "give it. The Cloudflare Workflows path is tracked in issue #131. Until it " +
            "lands, drop `durable: true` and keep the handler's `ctx.step` calls — they " +
            "run inline and become replayable when the provider gains the capability."
        );
      }

      const producer = readQueue(env, bindingName);
      if (!producer) {
        throw new QueueError(
          "provider_error",
          `No \`${bindingName}\` Queues binding on this Worker's env. Check the ` +
            "queues.producers entry in apps/api/wrangler.jsonc, and that the queue " +
            "exists — `wrangler queues create app-jobs`."
        );
      }

      const body: QueueMessageBody = { job: job.name, payload };
      try {
        await producer.send(
          body,
          enqueueOptions.delaySeconds === undefined
            ? undefined
            : { delaySeconds: enqueueOptions.delaySeconds }
        );
      } catch (error) {
        throw normalize(error);
      }
    },
    name: PROVIDER_NAME,
  };
}

/**
 * The consumer half: the `queue` and `scheduled` Worker exports. Registered in the
 * `handlers` array in apps/api/src/worker.ts.
 *
 * Both hooks gate on `QUEUE_PROVIDER` and return after one warn line when it names
 * anything else. The module is installed as a unit — bindings, trigger and handlers — so
 * a project that switches to another provider without removing this one would otherwise
 * run every job twice, once here and once there.
 */
export function cloudflareQueueHandlers(
  options: CloudflareQueueOptions = {}
): CloudflareHandlerSet {
  const dlqBinding = options.deadLetterBinding ?? "JOBS_DLQ";
  const backoffBase = options.backoffBaseSeconds ?? DEFAULT_BACKOFF_SECONDS;

  return {
    async queue(batch: MessageBatch<unknown>, env: unknown): Promise<void> {
      const queueEnv = env as QueueEnv;
      if (!isSelected(queueEnv, "queue consumer")) {
        return;
      }

      // Sequential on purpose. A batch is at most `max_batch_size` messages, and each
      // handler owns its own subrequests; running ten at once is the quickest way to
      // hit the Worker's subrequest ceiling on the batch that mattered.
      for (const message of batch.messages) {
        await handle(message, queueEnv, dlqBinding, backoffBase);
      }
    },

    async scheduled(event: ScheduledController, env: unknown): Promise<void> {
      const queueEnv = env as QueueEnv;
      if (!isSelected(queueEnv, "cron tick")) {
        return;
      }

      const due = dueSchedules(new Date(event.scheduledTime));
      if (due.length === 0) {
        return;
      }

      // The tick enqueues; it never runs a job inline. A job that runs inside the
      // scheduled handler gets no retry, no dead-lettering and the tick's own CPU
      // budget. Going through the queue gives a scheduled run exactly the same
      // treatment as one a route enqueued.
      const client = createQueue(queueEnv);
      for (const schedule of due) {
        try {
          await client.enqueue(schedule.job, schedule.payload);
        } catch (error) {
          // One unenqueueable schedule must not cost the others their tick, and there
          // is no caller to throw at. The next minute tries again.
          console.error(
            `[queue] schedule "${schedule.name}" could not enqueue job "${schedule.job}"`,
            error
          );
        }
      }
    },
  };
}

/**
 * One message: dispatch it through the core, then ack, retry with backoff, or
 * dead-letter. Every branch ends with the message settled, because a message left
 * neither acked nor retried is redelivered when the batch's visibility timeout expires,
 * which reads as a job that runs twice for no reason.
 */
async function handle(
  message: Message<unknown>,
  env: QueueEnv,
  dlqBinding: string,
  backoffBase: number
): Promise<void> {
  const body = readBody(message.body);
  if (!body) {
    await deadLetter(message, env, dlqBinding, {
      code: "invalid_job",
      message: "message body carries no `job` name",
    });
    return;
  }

  // Cloudflare counts deliveries from 1; the contract counts prior attempts from 0.
  const attempt = Math.max(0, message.attempts - 1);

  try {
    await dispatch(body.job, body.payload, { attempt });
    message.ack();
  } catch (error) {
    const failure = asQueueError(error);
    if (failure.retryable) {
      // 30, 60, 120 under the patched `max_retries: 3`; the platform dead-letters the
      // message itself once the attempts run out, into the same `app-jobs-dlq`.
      message.retry({ delaySeconds: backoffBase * 2 ** attempt });
      return;
    }
    await deadLetter(message, env, dlqBinding, {
      code: failure.code,
      message: failure.message,
      providerCode: failure.providerCode,
    });
  }
}

interface FailureDetail {
  code: QueueErrorCode;
  message: string;
  providerCode?: string;
}

/**
 * Send a message the platform should stop retrying to the dead-letter queue, then ack
 * it. In that order: an ack the DLQ write never followed would drop the job silently.
 *
 * When the DLQ write itself fails — or the binding is missing — the message is retried
 * instead. That costs the platform's own `max_retries`, at the end of which
 * `dead_letter_queue: app-jobs-dlq` in wrangler.jsonc routes it to the same place. The
 * slow path beats losing the job.
 */
async function deadLetter(
  message: Message<unknown>,
  env: QueueEnv,
  dlqBinding: string,
  failure: FailureDetail
): Promise<void> {
  const dlq = readQueue(env, dlqBinding);
  if (!dlq) {
    console.error(
      `[queue] no \`${dlqBinding}\` binding to dead-letter message ${message.id} into — ` +
        `${failure.code}: ${failure.message}`
    );
    message.retry();
    return;
  }

  try {
    await dlq.send({
      body: message.body,
      failedAt: new Date().toISOString(),
      failure,
      messageId: message.id,
    });
    message.ack();
  } catch (error) {
    console.error(
      `[queue] dead-lettering message ${message.id} failed; leaving it to the platform's retries`,
      error
    );
    message.retry();
  }
}

/**
 * Whether this Worker's env selects the Cloudflare provider. `QUEUE_PROVIDER` is
 * required, has no default, and a mismatch is a warn rather than a throw: the handlers
 * are the Worker's, and throwing here would fail a tick or a batch that another
 * provider is legitimately handling.
 */
function isSelected(env: QueueEnv, what: string): boolean {
  if (env.QUEUE_PROVIDER === PROVIDER_NAME) {
    return true;
  }
  console.warn(
    `[queue] the Cloudflare ${what} is installed but QUEUE_PROVIDER is ` +
      `${env.QUEUE_PROVIDER === undefined ? "unset" : `"${String(env.QUEUE_PROVIDER)}"`}, ` +
      `not "${PROVIDER_NAME}" — doing nothing. Set QUEUE_PROVIDER=${PROVIDER_NAME}, or ` +
      "run `saasaloy remove queue-cloudflare` to take the bindings and this handler out."
  );
  return false;
}

function readQueue(
  env: QueueEnv,
  bindingName: string
): Queue<unknown> | undefined {
  const binding = env[bindingName] as Queue<unknown> | undefined;
  return binding && typeof binding.send === "function" ? binding : undefined;
}

function readBody(body: unknown): QueueMessageBody | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { job, payload } = body as { job?: unknown; payload?: unknown };
  return typeof job === "string" ? { job, payload } : undefined;
}

function asQueueError(error: unknown): QueueError {
  return error instanceof QueueError ? error : normalize(error);
}

function normalize(cause: unknown): QueueError {
  if (cause instanceof QueueError) {
    return cause;
  }

  const providerCode = readCode(cause);
  const mapped = providerCode ? ERROR_CODES[providerCode] : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);

  return new QueueError(mapped?.code ?? "provider_error", message, {
    cause,
    providerCode,
    retryable: mapped?.retryable ?? false,
  });
}

function readCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }
  const { code, name } = cause as { code?: unknown; name?: unknown };
  if (typeof code === "string") {
    return code;
  }
  return typeof name === "string" && name !== "Error" ? name : undefined;
}
