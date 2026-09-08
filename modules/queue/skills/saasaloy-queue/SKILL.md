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

## Providers

| Module | `QUEUE_PROVIDER` | Carries work with | Use it for |
| --- | --- | --- | --- |
| `queue-cloudflare` | `cloudflare` | Cloudflare Queues and one Cron Trigger | staging and production |
| `queue-memory` | `memory` | the same Worker, inline | local dev and tests |

`QUEUE_PROVIDER` is required in both directions. Install a provider and set the variable; installing one without setting it throws at `createQueue`, and setting it to a provider that is not installed throws too.

## `queue-cloudflare`

```sh
saasaloy add queue queue-cloudflare
```

The module patches `apps/api/wrangler.jsonc` with two producer bindings (`JOBS` → `app-jobs`, `JOBS_DLQ` → `app-jobs-dlq`), one consumer on `app-jobs`, and one `* * * * *` Cron Trigger. It registers `cloudflare()` in the `providers` array in `packages/queue/src/index.ts` and `cloudflareQueueHandlers()` in the `handlers` array in `apps/api/src/worker.ts`. Both handlers gate on `QUEUE_PROVIDER`: when it names anything but `cloudflare` they write one warn line and return, so switching providers without removing this module does not run every job twice.

A job declared `durable: true` is refused at `enqueue` with `QueueError("provider_error")` rather than run as a plain message. Cloudflare Queues cannot checkpoint, and downgrading in silence would drop the replay the handler asked for. The Workflows path is issue #131.

### Create the queues first

The bindings name queues; they do not create them. Run this once per Cloudflare account, before the first deploy:

```sh
wrangler queues create app-jobs
wrangler queues create app-jobs-dlq
```

A binding pointing at a queue that does not exist fails the deploy, not the request, so you find out at `wrangler deploy` rather than in production. Queues need a Workers **paid plan**; `queue-memory` exists so local development needs neither the plan nor the queues.

### The two knobs

Everything else in the consumer entry is Cloudflare's default and is fine. These two are worth turning:

- **`max_retries: 3`** in `apps/api/wrangler.jsonc`. How many deliveries a message gets before the platform routes it to `app-jobs-dlq` itself. Raise it for work that fails on a flaky upstream; lower it for work whose retry costs money.
- **`backoffBaseSeconds`**, the first retry delay, passed to `cloudflareQueueHandlers({ backoffBaseSeconds: 30 })`. Each attempt doubles it, so the default gives 30, 60 and 120 seconds under `max_retries: 3`. A retryable failure is asked for again with that delay; a non-retryable one is sent to `JOBS_DLQ` and acked at once, without burning the attempts.

### What the tick costs

The Cron Trigger fires every minute, which is **1,440 Worker invocations a day** whether a schedule is due or not. A tick with nothing due does one `dueSchedules(now)` call in memory and returns, so the CPU cost is negligible, but the invocation count is real and it is what buys minute resolution for the whole schedule table. If nothing in the project is scheduled, remove the trigger from `apps/api/wrangler.jsonc`; the producer and consumer keep working without it.

### Overlapping runs

Cloudflare gives no lock. A schedule that fires every minute while its job takes 90 seconds has two runs in flight, and a retry can overlap the delivery it is retrying. The tick enqueues rather than running inline, which keeps the tick itself short, but it does not serialize anything. A job that must not overlap takes its own lock — a D1 row, or a KV key with a TTL once the `kv` capability lands (issue #129) — in the handler. The capability ships no lock of its own.

### Write an idempotent handler

Cloudflare Queues is at-least-once. A message can be delivered twice with no failure anywhere, so **every handler must be safe to run twice**. There is no `dedupeKey` and there will not be one: the check belongs where the work is, because only the handler knows what "already done" means.

```ts
export const chargeInvoiceJob = (): Job =>
  defineJob<{ invoiceId: string }>({
    name: "charge-invoice",
    handler: async ({ invoiceId }, ctx) => {
      const invoice = await ctx.step("load", () => db.invoice(invoiceId));
      if (invoice.chargedAt) return; // a second delivery, or a retry after a timeout
      await ctx.step("charge", () => payments.charge(invoice));
      await ctx.step("mark", () => db.markCharged(invoiceId));
    },
  });
```

Read state and return early, or write through a unique key and let the constraint reject the duplicate. Do not use `ctx.attempt` as the test: attempt 0 can arrive twice.

### `infra` does not know about these bindings yet

`modules/infra` translates `wrangler.jsonc` bindings into provisioning steps. It does not yet handle `queues`, `triggers` or `send_email`, so installing `queue-cloudflare` in a project that uses `infra` gets you the bindings but not the queue creation. Run the two `wrangler queues create` commands by hand until the translator lands (issue #130).

## Write a provider

One file in `src/providers/`, exporting a factory that returns a `QueueProvider`: a `name` and an `enqueue(env, job, payload, options)`. Read the binding or secret off `env` inside that file and nowhere else, map every failure onto `QueueError`, and set `retryable` honestly. A provider that also needs a Worker export (a queue consumer, a cron tick) ships a second exported factory returning `{ queue?, scheduled? }` and appends it to the `handlers` array in `apps/api/src/worker.ts`. See `.agents/skills/create-provider/`.
