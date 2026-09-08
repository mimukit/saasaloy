---
name: saasaloy-queue
description: Runbook for the queue capability — provider-agnostic background work in packages/queue, with a job table, a schedule table and per-provider modules. Use when enqueueing a job from a route, writing a job handler, scheduling one with cron, choosing or switching QUEUE_PROVIDER, reading a QueueError, or writing a custom queue provider.
---

# queue — provider-agnostic background work from `packages/queue`

`packages/queue` (`@repo/queue`) is the capability core: a job table, a schedule table, a five-field cron matcher, and a **provider registry**. It has **zero runtime dependencies** and knows nothing about any particular queue service. Each provider ships as its own module, dropping one file into `src/providers/` and registering itself in the `providers` array in `src/index.ts`.

Callers import `@repo/queue`, call `createQueue(env)`, and never learn which provider carries the work. It is the same shape as `@repo/email`, on purpose (ADR 0033).

## Enqueue from a route

```ts
import { createQueue } from "@repo/queue";

app.post("/digest", async (c) => {
  await createQueue(c.env).enqueue("send-digest", { userId: c.get("userId") });
  return c.json({ queued: true });
});
```

`createQueue(env)` takes the whole environment. Which key the active provider reads is precisely what the route must not know. It throws a plain `Error` when `QUEUE_PROVIDER` is unset or names a provider that is not installed — there is no default in either direction.

`enqueue(name, payload?, options?)` accepts `{ delaySeconds }`. It throws `QueueError("unknown_job")` for an unregistered name and `QueueError("invalid_job")` when the payload fails the job's schema; neither reaches a provider and neither is retryable.

## Write a job

A job lives in `@queue/jobs/<name>.ts` and exports a **factory**, because the `jobs` table registers a call and that is what an install patch appends and a `remove` takes back out. `src/jobs/example.ts` is the worked example; copy it.

```ts
import { defineJob } from "../define";
import type { Job } from "../provider";

export const sendDigestJob = (): Job =>
  defineJob<{ userId: string }>({
    name: "send-digest",
    schema: digestPayload, // optional; any Standard Schema (zod, valibot, arktype)
    handler: async ({ userId }, ctx) => {
      const user = await ctx.step("load-user", () => loadUser(userId));
      await ctx.step("send", () => sendMail(user));
    },
  });
```

Then add `sendDigestJob()` to the `jobs` array in `src/index.ts`.

`ctx` carries `attempt`, `step(name, fn)` and `sleep(seconds)`. `step` and `sleep` are the durable half of the contract: a provider that can checkpoint replays a recorded step and resumes after a sleep, and one that cannot runs the step inline and returns from the sleep at once. Writing a handler against `ctx` costs nothing now and is what makes `durable: true` portable when the Cloudflare Workflows path lands (issue #131).

There is no `dedupeKey`. A job that must not run twice checks its own table in the handler.

## Schedule a job

```ts
export const nightlyDigest = () =>
  defineSchedule({ name: "nightly-digest", cron: "0 2 * * *", job: "send-digest" });
```

Add the call to the `schedules` array in `src/index.ts`. The expression is five fields, UTC, minute resolution: `*`, a number, `a-b`, `a,b,c`, `*/n` and `a-b/n`. Named months and weekdays, `?`, `L`, `W` and `#` are rejected at `defineSchedule`, so a malformed expression throws at module load rather than never firing. A schedule finer than one minute is not supported.

A provider's cron tick calls `dueSchedules(now)` and enqueues one message per hit. The tick never runs a job inline, so a scheduled run gets the same retries and dead-lettering as any other.

## `QueueError`

One error shape, five codes.

| Code | Retryable | Raised by |
| --- | --- | --- |
| `invalid_job` | no | the core, when a payload fails the job's schema |
| `unknown_job` | no | the core, when no job is registered under the name |
| `too_large` | no | a provider, when the payload exceeds the service's limit |
| `rate_limited` | usually | a provider |
| `provider_error` | provider's call | a provider, or the core wrapping a raw throw |

A provider maps its vendor code onto one of these and keeps the raw value in `providerCode`. The core never retries: `retryable` is the flag a consumer reads to choose between another delivery and the dead-letter queue.

## Write a provider

One file in `src/providers/`, exporting a factory that returns a `QueueProvider`: a `name` and an `enqueue(env, job, payload, options)`. Read the binding or secret off `env` inside that file and nowhere else, map every failure onto `QueueError`, and set `retryable` honestly. A provider that also needs a Worker export (a queue consumer, a cron tick) ships a second exported factory returning `{ queue?, scheduled? }` and appends it to the `handlers` array in `apps/api/src/worker.ts`. See `.agents/skills/create-provider/`.
