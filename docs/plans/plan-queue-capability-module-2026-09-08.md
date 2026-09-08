# Plan: `queue` capability with `queue-cloudflare` and `queue-memory` providers

Grilled: 2026-09-08

Issue: [#125](https://github.com/mimukit/saasaloy/issues/125). Source: `docs/plans/plan-module-catalog-2026-09-07.md` (P0 #1), `docs/research/research-module-libraries-2026-09-07.md`.

## Context

Eleven catalog modules (`audit-log`, `notifications`, `usage-metering`, `webhooks-out`, `webhooks-in`, `data-export`, `import`, `trials`, `dunning`, `backups`, `newsletter`) wait on a way to run work outside the request. The catalog listed `queue`, `cron`, `workflows` and `job-dashboard` as four modules. To a consumer they are one thing, so this plan builds one capability with one contract: define a job once, enqueue it, schedule it, or run it as a durable multi-step job, and never learn which provider carries it.

The capability follows the `email` shape (AGENTS.md "portable capabilities, swappable providers"): a vendor-blind core in `packages/queue`, provider modules that drop one file into `providers/` and register through a `plugin-array` patch, `QUEUE_PROVIDER` selecting at runtime, and a local provider so a project develops with no Cloudflare account.

A queue holds data, and ADR 0001's 2026-08-04 amendment allows provider modules only for stateless services. Phase 1 settles that with an ADR before any code lands.

Success means: `saasaloy add queue queue-cloudflare` produces a project where a route enqueues a job, a consumer runs it, a cron runs a scheduled job, and `wrangler deploy` ships it; setting `QUEUE_PROVIDER=memory` and adding `queue-memory` runs the same code inline with no binding; a third provider needs one file and registration patches.

Platform facts checked on 2026-09-08 against the Cloudflare docs: Queues is on the Workers Free plan (10,000 operations a day, 24-hour retention) and the Paid plan (1,000,000 a month, up to 14-day retention). `send()` and `retry()` accept `delaySeconds` up to 24 hours. `max_retries` defaults to 3, `max_batch_size` to 10, `max_batch_timeout` to 5 seconds. A message reaches the dead-letter queue only after it exhausts `max_retries`. Cron Triggers per account: 5 on Free, 250 on Paid.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| One capability, not four modules | `queue`, `cron` and `workflows` merge into `queue`. A consumer sees `enqueue`, a schedule table and a durable job on one client, with one error type. `job-dashboard` is a later `admin` feature, out of scope here. |
| Provider, not driver, and the test that decides it | ADR 0033 states the system-of-record test: a capability takes drivers (`conflictsWith`, `requiresOneOf`, one installed) when the project queries and migrates the state it holds; it takes providers (`<CAP>_PROVIDER`, several coexist) when the platform owns transient state or the service is stateless. `queue`, `kv`, `email`, `sms`, `logger` take providers. `database` and `storage` take drivers. ADR 0026's corollary stays: a driver replaces files, a provider adds one. |
| Handler exports register through a Worker entry table | `modules/api` gains `apps/api/src/worker.ts`, the new wrangler `main`: `export const worker = defineWorker({ fetch: app.fetch, handlers: [] }); export default worker;`. `defineWorker` is a local function in that file, not a package. It merges each handler set's `queue` and `scheduled` into the exported object. `queue-cloudflare` appends `cloudflareQueueHandlers()` through `plugin-array`. `src/index.ts` keeps `export default app` and `AppType`, so ADR 0028's `chained-route` codemod is untouched. |
| Nested wrangler keys extend `wrangler-binding` | `bindingType` accepts a dotted path (`queues.producers`, `queues.consumers`, `triggers.crons`, `workflows`). The codemod splits on the dot, creates missing parents, and removes back to byte-identical. No new patch kind. |
| Schedules are declared in code, and the Cloudflare tick is generic | A feature declares `defineSchedule({ name, cron, job })` in its job factory file. `queue-cloudflare` patches one `triggers.crons` entry, `* * * * *`, and its `scheduled()` handler matches each schedule against the tick time truncated to the minute with a five-field matcher in the core. A feature never patches `wrangler.jsonc`. A schedule finer than one minute is unsupported. The tick costs 1,440 invocations a day. |
| The tick enqueues, never runs inline | `scheduled()` sends one message per due schedule to the `JOBS` binding, so a scheduled run gets the same retries, backoff and DLQ as any job. `queue-memory` exposes `runDue(now)` and runs the due job inline. |
| Durable jobs: contract now, Cloudflare later | Every job handler receives `ctx` with `step(name, fn)`, `sleep(duration)` and `attempt`. `queue-memory` runs `step` once and records its name; `sleep` records the duration and returns at once. `queue-cloudflare` rejects a job declared `durable: true` with `QueueError("provider_error")` and a message naming the follow-up issue. The Workflows implementation is a follow-up issue filed from this plan. |
| Non-retryable failure goes to the DLQ at once | The consumer acks a message whose failure is `retryable: false` and sends it to the DLQ through a second producer binding `JOBS_DLQ`. A retryable failure calls `retry({ delaySeconds: 30 * 2 ** attempt })`. After `max_retries` the platform writes it to the DLQ. Every failure ends in one place. `queue-memory` mirrors this with an in-memory `failed` list. |
| Retry defaults | `max_retries: 3`, `max_batch_size: 10`, `max_batch_timeout: 5`, `dead_letter_queue: app-jobs-dlq`, backoff base 30 seconds (30, 60, 120). The backoff base and `max_retries` are the two documented knobs. |
| No `dedupeKey` in v1 | Cloudflare Queues has no deduplication, and a contract option one provider ignores misleads the caller. A job that needs idempotency checks a table in its handler; the skill shows the pattern. Revisit with #110. |
| Job and schedule tables register by `plugin-array` | `packages/queue/src/index.ts` exports `queue = defineQueue({ providers: [], jobs: [], schedules: [] })`. A feature ships `@queue/jobs/<name>.ts` exporting `nameJob()` and, when scheduled, `nameSchedule()`, and registers both by `plugin-array`. No folder glob (ADR 0028's argument). `queue-memory` dispatches by name from this table; the Cloudflare consumer looks a job up the same way. |
| Payload validation by optional Standard Schema | `defineJob({ name, schema?, handler })` accepts any object with a `~standard.validate` method, so the core stays dependency-free and a project passes a zod schema. Validation runs at `enqueue` and again in the consumer. A failure is `QueueError("invalid_job")`, not retryable. |
| Error codes | `invalid_job`, `unknown_job`, `too_large`, `rate_limited`, `provider_error`. `unknown_job` is a message naming a job no longer registered; the consumer sends it straight to the DLQ so a removed feature's in-flight work is kept. Providers map vendor codes, keep the raw value in `providerCode`, and set `retryable` honestly. The core never retries. |
| `QueueEnv` is opaque, no `Bindings` patch | `QueueEnv` carries `QUEUE_PROVIDER?` and an index signature, the same as `EmailEnv`. The provider file casts its own binding. `apps/api/src/index.ts` is not patched. |
| Handlers gate on `QUEUE_PROVIDER` | `queue()` and `scheduled()` in the Cloudflare handler set return with one warn log unless `QUEUE_PROVIDER === "cloudflare"`. The env var is the single switch in both directions. The tick still counts as an invocation while the provider is installed. |
| The core ships an example job | `@queue/jobs/example.ts` is scaffolded and registered in `index.ts`, the way `email` ships `templates/welcome.ts`. A project deletes it by hand. |
| `infra` translator is a separate issue | `translate.ts` supports only `d1_databases` and `vars`, and already refuses `send_email`. A follow-up issue adds `send_email`, `queues`, `triggers` and `workflows`. The skill states the gap. |
| Per-job cron lock deferred | Cloudflare runs a Cron Trigger once per scheduled time. The remaining risk is a long job overlapping its next tick, and a lock needs shared storage the core cannot own. The lock waits for the `kv` capability (#129). The skill states the overlap rule. |

## Approach

Reuses, by name: `modules/email/files/src/{define,provider,index}.ts` as the core template; `packages/cli/src/lib/patch/ts-module.ts` (`plugin-array`) for every registration; `packages/cli/src/lib/patch/jsonc.ts` (`wrangler-binding`) extended for nested keys; `modules/email-cloudflare/files/cloudflare.ts` for the error-mapping shape; `modules/email-console/files/console.ts` for the local provider; `.agents/skills/create-provider/SKILL.md` gains a `queue` mode; ADR 0026 "Driver, not provider" as the line the new ADR sharpens.

Rejected alternatives, one line each:

- Drivers (`conflictsWith`, one installed) for `queue`. Loses the local provider beside the real one, which is the main reason the shape exists.
- Changing `index.ts` to `export default { fetch, ... }`. Forces a rewrite of the `chained-route` codemod that follows `export default app`.
- A separate Worker entry per provider (`queue-cloudflare` ships `src/worker.ts` and repoints `main`). Two modules write one path, and `wrangler-binding` cannot set a scalar.
- Per-schedule cron triggers patched by each feature. Puts a Cloudflare key into every vendor-blind feature module.
- Schedules that re-enqueue themselves with a delay. No anchor for a missed run, and the delay caps at 24 hours.
- Retrying every failure until `max_retries`. Makes `retryable` meaningless on Cloudflare and gives a bad payload three runs.
- Workflows as the only runner. Queues are fan-out and buffering; Workflows are ordered runs with sleeps. Different cost and different consumers.

### Phase 1: ADR and glossary

- [ ] Write ADR 0033 "Transient-state capabilities take providers": amends ADR 0001's amendment and ADR 0026. States the system-of-record test, lists `queue`, `kv`, `email`, `sms`, `logger` on the provider side and `database`, `storage` on the driver side, and states that `database` stays on drivers.
- [ ] The ADR states how a binding provider registers a handler export: through the `handlers` table in `apps/api/src/worker.ts` via `plugin-array`, never through `infra`, and that a binding provider may carry several patches (`email-cloudflare` already carries two).
- [ ] The ADR records the `wrangler-binding` dotted-path extension and the `worker.ts` entry split as consequences.
- [ ] Update `CONTEXT.md` "Provider module" and "Driver module" to the ADR's test, and add "Job", "Schedule" and "Handler set" entries.
- [ ] `AGENTS.md` already states the philosophy (commit f7d7f9d). Verify its `queue` sentence matches the ADR and adjust if not.
- [ ] File the two follow-up issues: `infra` translator support for `send_email`, `queues`, `triggers`, `workflows`; and Cloudflare Workflows behind `durable: true` in `queue-cloudflare`.

### Phase 2: CLI and `api` groundwork

- [ ] `wrangler-binding` accepts a dotted `bindingType` (`queues.producers`, `queues.consumers`, `triggers.crons`, `workflows`), creates missing parents, and removes back to byte-identical. The schema description and `docs` for the patch kind say so. Tests in `jsonc.test.ts` and `remover.test.ts`.
- [ ] `modules/api` ships `src/worker.ts` with a local `defineWorker` and points `wrangler.jsonc` `main` at it. `src/index.ts` is unchanged. The `saasaloy-api` skill and `create-module` explain the handler table.
- [ ] `vite.config.ts` and any build entry that names `src/index.ts` still resolve. Existing api tests pass.

### Phase 3: the neutral core (`packages/queue`)

- [ ] `modules/queue/registry-item.json`: `saasaloy:capability`, `dependsOn: ["api"]`, `envVars.QUEUE_PROVIDER` (`cloudflare` or `memory`, always required), scaffold `packages/queue` with alias `@queue`, patch `@repo/queue` into `apps/api/package.json`.
- [ ] `provider.ts`: `QueueProvider` (`name`, `enqueue(env, job, payload, options)`), `QueueEnv`, `Job`, `Schedule`, `JobContext` (`step`, `sleep`, `attempt`), `EnqueueOptions` (`delaySeconds`), `QueueError` with the five codes.
- [ ] `define.ts`: `defineQueue({ providers, jobs, schedules })`, `create(env)` selecting on `QUEUE_PROVIDER` with the same throw-never-fall-back rule as `email`, `defineJob` with optional Standard Schema, `defineSchedule`, and `dispatch(name, payload, ctx)` for providers to call, which validates and raises `unknown_job`.
- [ ] `cron.ts`: five-field matcher with tests. Zero dependencies.
- [ ] `index.ts` barrel with `queue = defineQueue({ providers: [], jobs: [exampleJob()], schedules: [] })` and `createQueue(env)`. `src/providers/.gitkeep` and `src/jobs/example.ts`.
- [ ] `package.json` exports `.`, `./providers/*` and `./jobs/*`; `clean` script with pinned `rimraf`.
- [ ] Unit tests: selection, unknown job, invalid payload, `QueueError` wrapping of a raw throw, cron matcher.

### Phase 4: `queue-cloudflare`

- [ ] `modules/queue-cloudflare`: one file `files/cloudflare.ts` at `@queue/providers/cloudflare.ts`, exporting `cloudflare()` (the provider) and `cloudflareQueueHandlers()` (the handler set).
- [ ] Patches: `queues.producers` bindings `JOBS` (`app-jobs`) and `JOBS_DLQ` (`app-jobs-dlq`); `queues.consumers` entry for `app-jobs` with `max_retries: 3`, `max_batch_size: 10`, `max_batch_timeout: 5`, `dead_letter_queue: app-jobs-dlq`; `triggers.crons` `* * * * *`; `plugin-array` into `queue.providers`; `plugin-array` into `worker.handlers`.
- [ ] Producer: `enqueue` sends `{ name, payload }` to `JOBS`, honours `delaySeconds`, maps Queues errors to `QueueError`, and rejects `durable: true` with a message naming the follow-up issue.
- [ ] Consumer: `queue(batch, env)` returns with a warn log unless `QUEUE_PROVIDER === "cloudflare"`, dispatches each message through the core, acks on success, calls `retry({ delaySeconds: 30 * 2 ** attempt })` when `retryable`, and acks plus sends to `JOBS_DLQ` when not.
- [ ] `scheduled(event, env)` gates the same way and enqueues one message per schedule whose expression matches the tick.
- [ ] The `saasaloy-queue` skill documents `wrangler queues create app-jobs` and `app-jobs-dlq`, the retry and backoff knobs, the tick cost, the overlap rule, the handler-side idempotency pattern, and that `infra` refuses the new keys until the follow-up lands.

### Phase 5: `queue-memory` and the consumer convention

- [ ] `modules/queue-memory`: one file `files/memory.ts` at `@queue/providers/memory.ts`. `memory()` runs the job inline through `dispatch`, records `step` names and `sleep` durations, keeps a `failed` list, records each schedule, and exposes `runDue(now)`.
- [ ] `.agents/skills/create-provider/SKILL.md` gains a `queue` mode; `create-module` documents the job and schedule registration patches and the `@queue/jobs/<name>.ts` shape.
- [ ] End-to-end in `.dev`: `saasaloy add queue queue-cloudflare` typechecks and `wrangler dev` runs a consumer; `saasaloy add queue-memory` plus `QUEUE_PROVIDER=memory` runs the same job inline; `saasaloy remove queue-cloudflare` leaves `worker.ts`, `index.ts` and `wrangler.jsonc` byte-identical.
- [ ] `saasaloy-queue` skill: contract, both providers, how to write a third.

## Open questions

None left open by the grill on 2026-09-08. Two items are deferred by decision, not by doubt: Cloudflare Workflows behind `durable: true`, and the `infra` translator, both as follow-up issues filed in Phase 1.

## Non-goals

- `job-dashboard` (queue depth, failed jobs, retry from admin). A later `admin` feature.
- Cloudflare Workflows implementation. The contract ships here; the provider path is a follow-up issue.
- A per-job lock against overlapping scheduled runs. Waits for `kv` (#129).
- `dedupeKey` or any provider-side idempotency.
- `queue-upstash`, `queue-sqs`. Future providers; the contract must admit them, this plan does not build them.
- Human-approval steps in Workflows.
- Migrating in-flight messages between providers, and any `saasaloy migrate`.
- `infra` translator support for the new binding kinds.
