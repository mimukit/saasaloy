import { defineQueue } from "./define";
import { exampleJob } from "./jobs/example";
import type { JobContext, QueueEnv } from "./provider";

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

// The three registration tables, and the patch points every module writes into.
// `saasaloy add queue-cloudflare` adds its import and appends `cloudflare()` to
// `providers`; a feature that ships background work appends `myJob()` to `jobs` and
// `mySchedule()` to `schedules`. Every one of those is idempotent, so a re-run changes
// nothing, and `saasaloy remove` takes the same line back out.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal for each property. The codemod behind the `plugin-array`
// patch kind (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into
// otherwise, and an install fails silently. Never omit an array, even while it's empty.
export const queue = defineQueue({
  jobs: [exampleJob()],
  providers: [],
  schedules: [],
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
