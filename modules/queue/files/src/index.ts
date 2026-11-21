import { defineQueue } from "./define";
import { exampleJob } from "./jobs/example";
import type { JobContext, QueueEnv } from "./provider";
import { queueJobs } from "./jobs.generated";
import { queueProviders } from "./providers.generated";
import { queueSchedules } from "./schedules.generated";

export { matchesCron, matchesParsed, parseCron } from "./cron";
export type { ParsedCron } from "./cron";
export { defineJob, defineQueue, defineSchedule } from "./define";
export type { QueueClient, QueueConfig, QueueRegistry } from "./define";
export { QueueError } from "./provider";
export type {
  EnqueueOptions,
  Job,
  JobConfig,
  JobContext,
  QueueEnv,
  QueueErrorCode,
  QueueErrorOptions,
  QueueProvider,
  Schedule,
  ScheduleConfig,
  StandardSchema,
  StandardSchemaIssue,
  StandardSchemaResult,
} from "./provider";

// The three registration tables. A module adds rows to `queue.providers`, `queue.jobs`
// and `queue.schedules`, and the CLI writes `./providers.generated.ts`,
// `./jobs.generated.ts` and `./schedules.generated.ts` from them on every run:
// `saasaloy add queue-cloudflare` adds `cloudflare()` to `providers`, and a feature that
// ships background work adds `myJob()` to `jobs` and `mySchedule()` to `schedules`.
// `saasaloy remove` takes the row back out. A job or schedule of your own goes after the
// spread, never in a generated file: the CLI overwrites it, and `saasaloy update` refuses
// when it was edited.
export const queue = defineQueue({
  jobs: [exampleJob(), ...queueJobs],
  providers: [...queueProviders],
  schedules: [...queueSchedules],
});

/**
 * Get an enqueuer for this request's environment. Mirrors `createEmail(c.env)`: it takes
 * the whole `env`, because which key the active provider reads — a `JOBS` queue binding,
 * an API token, nothing — is precisely what a calling route isn't supposed to know.
 *
 * ```ts
 * await createQueue(c.env).enqueue("example", { message: "hello" });
 * ```
 *
 * Throws when `QUEUE_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createQueue(env: QueueEnv) {
  return queue.create(env);
}

/**
 * Run a registered job by name. This is the provider-facing half: a queue consumer calls
 * it once the platform delivers a message, passing the delivery's `attempt` and, where
 * the platform can checkpoint, its own `step` and `sleep`.
 *
 * Throws `QueueError("unknown_job")` for a message naming a job that is no longer
 * registered, and `QueueError("invalid_job")` when the payload fails the job's schema.
 * A consumer sends either straight to the dead-letter queue: neither is retryable.
 */
export function dispatch(
  name: string,
  payload: unknown,
  ctx?: Partial<JobContext>
) {
  return queue.dispatch(name, payload, ctx);
}

/**
 * Every schedule due at this instant, in UTC at minute resolution. A provider's cron tick
 * calls this and enqueues one message per hit.
 */
export function dueSchedules(at: Date) {
  return queue.dueSchedules(at);
}
