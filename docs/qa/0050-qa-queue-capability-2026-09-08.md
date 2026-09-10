# QA Plan: Queue capability (`queue`, `queue-cloudflare`, `queue-memory`)

_Generated 2026-09-08 · against `860386f` · covers issue #125, the neutral queue core and its two providers_

## Summary

- The `queue` capability runs background jobs and cron schedules behind a vendor-blind core, with `queue-cloudflare` (Cloudflare Queues plus a Cron Trigger) and `queue-memory` (inline, local) selected by `QUEUE_PROVIDER`.
- "Working" means a job enqueued through the core reaches a handler on both providers, a failure is acked, retried or dead-lettered as declared, and removing a provider restores the project byte for byte.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-125-add-queue-capability` at commit `860386f`.
- Scenario 1 needs no account and no network. Scenario 2 needs a Cloudflare account on a **Workers paid plan**, because Queues is not on the free plan.
- Scenario 2 needs `wrangler` authenticated. Confirm with the command below; it prints your account email.
- No feature flags. `QUEUE_PROVIDER` is the only selector, and each scenario sets it.

```sh
npx wrangler whoami
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: worktree only, no account | The `saasaloy-queue` skill reads as a complete guide | 🟡 Normal |
| TC-2.1 | 2: deployed Worker, live queues | A deployed consumer acks, retries and dead-letters | 🔴 Critical |
| TC-2.2 | 2: deployed Worker, live queues | The deployed Cron Trigger fires and enqueues | 🔴 Critical |
| TC-2.3 | 2: deployed Worker, live queues | The same job runs inline under `queue-memory` | 🟡 Normal |

## Scenario 1: worktree only, no account

**Setup.** Run once, for every case in this scenario.

1. Check out the branch under test.

```sh
git switch issue-125-add-queue-capability && git log -1 --format=%h
```

- [ ] Setup complete

### TC-1.1: The `saasaloy-queue` skill reads as a complete guide · 🟡 Normal

**Goal.** A developer new to the capability can install it, run a job and reason about failure without opening the source.

The automated pass confirmed each required topic is present by `grep`. This case is the editorial judgement no command settles.

**Steps**

1. Open the skill file and read it end to end, in order, without opening any source file it names.

   ```sh
   less modules/queue/skills/saasaloy-queue/SKILL.md
   ```

   - [ ] The reading order works: choosing a provider comes before installing one, and installing comes before writing a job.
   - [ ] Every code sample is copy-paste runnable, with no placeholder the reader must guess at.
2. Follow the `queue-cloudflare` install section as if you were doing it.
   - [ ] The `add` command is correct and takes one module. The text says the `queue` core arrives through `dependsOn`.
   - [ ] The two `wrangler queues create` commands appear, and the paid-plan requirement is stated before the reader spends time.
3. Read the operational sections: retries, tick cost, overlapping runs, idempotency.
   - [ ] A reader can predict what happens to a failing job without reading `cloudflare.ts`.
     - `max_retries: 3` and where to change it
     - `backoffBaseSeconds`, and that attempts double it
     - that a non-retryable failure skips the remaining attempts
     - the 1,440-invocations-a-day cost of the every-minute trigger
     - that nothing serializes an overlapping run, and the handler takes its own lock
4. Read the `queue-memory` section and the provider-switch guidance.
   - [ ] The three documented differences from production are clear, and each says why it is deliberate.
   - [ ] The cost of switching a deployed Worker to `memory` is stated: the gated consumer settles nothing, so `app-jobs` drains into the dead-letter queue.
5. Read the `infra` gap section and the "write a third provider" section.
   - [ ] The reader knows `infra` does not yet create the queues, and knows the manual step to run instead.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** None. This case changes nothing.

## Scenario 2: deployed Worker, live queues

This scenario is the half the automated pass could not reach. It needs a Cloudflare account, a paid plan and a deploy. Every case below runs against the same deployed Worker, so set it up once.

**Setup.** Run once, for every case in this scenario.

1. Create a scratch project and install the capability. Use a directory outside the repo.

```sh
cd /tmp && npx saasaloy init queue-qa && cd queue-qa && ./saasaloy add api --yes && ./saasaloy add queue-cloudflare --yes
```

2. Create the two real queues. The deploy fails without them.

```sh
npx wrangler queues create app-jobs && npx wrangler queues create app-jobs-dlq
```

3. Add a route that enqueues, so you have a way in. Put this in `apps/api/src/routes/`, mount it, and register a job that fails on demand. Give the job a handler that throws a `QueueError` with `retryable: true` when the payload says `retry`, throws a non-retryable one when it says `poison`, and succeeds otherwise.

4. Set the provider and deploy.

```sh
cd apps/api && echo 'QUEUE_PROVIDER = "cloudflare"' >> wrangler.jsonc && npx wrangler deploy
```

5. Record the deployed Worker URL as `$BASE_URL`, and open a log tail in a second terminal. Keep it open for every case.

```sh
npx wrangler tail --format pretty
```

- [ ] Setup complete
- [ ] The deploy succeeded and `wrangler tail` is streaming

### TC-2.1: A deployed consumer acks, retries and dead-letters · 🔴 Critical

**Goal.** The ack, retry and dead-letter split proven against stubs holds against a real queue and a real consumer.

**Steps**

1. Enqueue a job that succeeds.

   ```sh
   curl -i -X POST "$BASE_URL/jobs" -H 'content-type: application/json' -d '{"name":"example","payload":{"mode":"ok"}}'
   ```

   - [ ] The route returns 2xx at once, without waiting for the handler.
   - [ ] Within a few seconds the tail shows the consumer running the handler once, and the message is acked.
   - [ ] The message does not come back. Watch the tail for a full minute.
2. Enqueue a job whose handler fails retryably.

   ```sh
   curl -i -X POST "$BASE_URL/jobs" -H 'content-type: application/json' -d '{"name":"example","payload":{"mode":"retry"}}'
   ```

   - [ ] The tail shows the handler run again after about 30 seconds, then about 60, then about 120.
   - [ ] After the third retry the message stops. It is not retried forever.
3. Read the dead-letter queue.

   ```sh
   npx wrangler queues consumer add app-jobs-dlq --help || npx wrangler tail --format pretty
   ```

   - [ ] The exhausted message reached `app-jobs-dlq`, not silent loss.
4. Enqueue a job whose handler fails non-retryably.

   ```sh
   curl -i -X POST "$BASE_URL/jobs" -H 'content-type: application/json' -d '{"name":"example","payload":{"mode":"poison"}}'
   ```

   - [ ] The handler runs exactly once. The consumer does not retry it.
   - [ ] The message appears in `app-jobs-dlq` promptly, without burning the three attempts.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: The deployed Cron Trigger fires and enqueues · 🔴 Critical

**Goal.** The every-minute trigger runs on Cloudflare's own schedule and enqueues one message per due schedule, rather than running the job inline.

**Steps**

1. Register two schedules before the deploy in Setup: one matching every minute, one matching a minute that will not arrive during the test.
2. Confirm the trigger is installed.

   ```sh
   npx wrangler deployments list
   ```

   - [ ] The deployment lists the `* * * * *` Cron Trigger.
3. Watch the open tail for three full minutes without sending any request.
   - [ ] The `scheduled` handler fires about once a minute, unprompted.
   - [ ] Each tick enqueues the due schedule's job only. The non-due schedule never runs.
   - [ ] The tick itself returns fast. It does not run the handler inline.
4. Compare the handler runs against the tick count.
   - [ ] Three ticks produced three job runs, not six and not one. No tick was silently dropped.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: The same job runs inline under `queue-memory` · 🟡 Normal

**Goal.** Switching the provider changes where the job runs and nothing else, and the Cloudflare handlers stand down instead of running the job twice.

**Steps**

1. Drain `app-jobs` before switching. The gated consumer settles nothing, so anything in flight will dead-letter.
   - [ ] The tail is quiet. No message is in flight.
2. Install the local provider, select it, and redeploy.

   ```sh
   cd /tmp/queue-qa && ./saasaloy add queue-memory --yes && cd apps/api && npx wrangler deploy
   ```

   Set `QUEUE_PROVIDER` to `memory` before the deploy.

3. Enqueue the same succeeding job used in TC-2.1.

   ```sh
   curl -i -X POST "$BASE_URL/jobs" -H 'content-type: application/json' -d '{"name":"example","payload":{"mode":"ok"}}'
   ```

   - [ ] The handler runs inline, inside the request, before the route responds.
   - [ ] The job runs exactly once. The Cloudflare consumer does not also run it.
4. Read the tail for the gate.
   - [ ] Both Cloudflare handlers write one warn line naming `memory` and return.
   - [ ] The Cron Trigger still fires each minute but enqueues nothing.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd /tmp/queue-qa/apps/api && npx wrangler delete --name api && npx wrangler queues delete app-jobs && npx wrangler queues delete app-jobs-dlq && rm -rf /tmp/queue-qa
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Transcribed from the review pass and the fix round. 26 acceptance checks (C1..C26). At review time 25 passed and 1 failed; the failure was finding B3 and it is now fixed, so the current tree is 26 of 26.

The repo gate, run after the fixes landed:

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm typecheck
```

The capability's own suites:

```sh
node --import ./scripts/ts-resolve-hook.ts --test "modules/queue/files/**/*.test.ts"
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test modules/queue-cloudflare/files/cloudflare.test.ts
```

```sh
node --import ./scripts/ts-resolve-hook.ts --test modules/queue-memory/files/memory.test.ts
```

The scaffolded-project end-to-end, run in `.dev/playground`:

```sh
./saasaloy add api --yes && ./saasaloy add queue-cloudflare --yes && pnpm install && pnpm typecheck && ./saasaloy remove queue-cloudflare --yes
```

Results:

- ✅ `pnpm lint` → exit 0. All four passes green: oxlint type-aware, oxlint plain, Stylelint, and `prettier --check .` reporting `All matched files use Prettier code style!`.
- ✅ `pnpm test` → exit 0. `Test Files 51 passed (51)` for the CLI vitest run and `tests 160 pass 160 fail 0` for the module suites.
- ✅ `pnpm typecheck` → exit 0 across the repo.
- ✅ Queue core suites → 40 of 40 pass. Covers provider selection, unknown job, invalid payload, raw-throw wrapping and the cron matcher. Two cases were added by fix B2 for a schema whose `validate` throws.
- ✅ `queue-cloudflare` suite → 17 of 17 pass. Producer: `delaySeconds` forwarded, a durable job refused naming issue #131, a missing binding explained rather than throwing a `TypeError`, a Queues code mapped with the raw one kept. Consumer: acks on success, backs off 30/60/120, dead-letters a non-retryable failure then acks, dead-letters a bodiless message, retries when the DLQ is unreachable, and settles the whole batch.
- ✅ `queue-memory` suite → 14 of 14 pass. Inline run, recorded steps and sleeps, `delaySeconds` recorded not slept, the `failed` list, `rethrow`, a durable job warning, `reset()` and `runDue`.
- ✅ ADR 0033 and the domain model → the ADR states the system-of-record test and lists which capabilities take providers and which take drivers. `CONTEXT.md` gains `Job`, `Schedule` and `Handler set`. `AGENTS.md` replaces its placeholder sentence with the settled rule.
- ✅ Vendor-blindness → `modules/queue/files/package.json` has an empty `dependencies`. Every import in the core is relative. No vendor SDK and no Workers binding.
- ✅ Provider selection → `QUEUE_PROVIDER` unset, unknown, or unset with exactly one provider registered all throw at construction. No fallback in either direction, confirmed by probe.
- ✅ Error normalization → the code union is exactly `invalid_job`, `unknown_job`, `too_large`, `rate_limited`, `provider_error`. `retryable` defaults to false. A vendor code is kept verbatim in `providerCode`.
- ✅ Cron matcher → 14 probed edges pass, including Sunday as both `0` and `7`, the day-field union, step and range forms, and a rejection table for six fields, `60`, `MON`, `*/0`, `5/` and `bad`.
- ✅ Config patching → the six `wrangler.jsonc` patches land as declared, with comments preserved: two producers, one consumer with `max_batch_size 10`, `max_batch_timeout 5`, `max_retries 3` and `dead_letter_queue app-jobs-dlq`, plus the `* * * * *` trigger and the two `plugin-array` registrations.
- ✅ Scaffolded project → `add` applies 10 files, `pnpm install` and `pnpm typecheck` pass (exit 0, `Tasks: 4 successful`), and `pnpm -C apps/api build --force` reports `✓ built` with `queues` and `triggers` in the emitted `wrangler.json` and both handlers in the bundle.
- ✅ Byte-identical removal → after `remove queue-cloudflare`, `apps/api/src/worker.ts`, `apps/api/src/index.ts` and `apps/api/wrangler.jsonc` are each identical to their pre-add copies. After `remove queue-memory`, `packages/queue/src/index.ts` matches the shipped file byte for byte.
- ✅ Local `wrangler dev` probe → with `--test-scheduled`, `GET /__scheduled?cron=*+*+*+*+*` returned `Ran scheduled event [200]` under `QUEUE_PROVIDER=cloudflare`. Under `memory` the gate wrote its warn line and did nothing. Both `JOBS` and `JOBS_DLQ` bound as local queues. The process was stopped and the port confirmed free.
- ✅ Follow-up issues → #130 (`infra` binding translation) and #131 (durable jobs on Workflows) are both open and both say "Split out of #125".

Fixes applied after the review, each re-verified:

- ✅ B1 → the skill's two `add` fences took two positionals, a form the CLI rejects with `Unknown argument(s)`. Both now take one, and each says the `queue` core arrives through `dependsOn`. The rejection was re-confirmed against the fixed tree.
- ✅ B2 → a Standard Schema whose `validate` threw escaped `enqueue` as a raw `Error`. A `parse` helper now maps it to `QueueError("invalid_job")`, non-retryable, cause kept, on both the `enqueue` and the `dispatch` path. Two tests cover it.
- ✅ B3 → `pnpm typecheck` failed in a scaffolded project because `Bindings` carried no index signature. Adding `[key: string]: unknown` fixed it and rippled no further. This was the one failing check at review time.
- ✅ N1 → `readCode` reported a plain `TypeError` as `providerCode: "TypeError"`. The `name` fallback is gone, so only a real vendor `code` is reported.
- ✅ N2 → the CLI patch test used an import path the real descriptor never emits. It now uses `@repo/queue/providers/cloudflare`.
- ✅ N4 → the skill now warns that switching a deployed Worker to `memory` leaves in-flight messages unsettled, so `app-jobs` drains into the dead-letter queue.

One finding was recorded and deliberately not changed:

- ⚪ N3 → `createQueue` throws a plain `Error` while everything after it throws `QueueError`. This mirrors the `email` capability on purpose. Recorded so a later pass does not "fix" it.

## Not covered / needs human judgment

- **A live Cloudflare Queues consumer, a real `app-jobs` queue, a deployed Cron Trigger and `wrangler deploy`.** This box has no Cloudflare account, no browser and no public IP. Scenario 2 exists to cover exactly this gap, and every case in it is unrun.
- **An end-to-end job run inside the Worker under `QUEUE_PROVIDER=memory`.** No route in the playground enqueues, and the agent did not add one. The provider's own unit tests and the local gate warn line are the only evidence. TC-2.3 covers it.
- **The editorial judgement on the skill and the ADR.** A `grep` proves a topic is present. It cannot judge whether a reader can follow the document. TC-1.1 covers the skill.
- **`saasaloy update` against a project scaffolded before the `worker.ts` split.** ADR 0033 says such projects keep the old shape until `update` reaches them. Not exercised.
- **The `infra` translator against the new `queues` and `triggers` keys.** Known gap, tracked as issue #130.
- **Concurrency and overlapping scheduled runs.** The capability ships no lock by design and the skill says so. Proving the overlap needs a long-running job on a live trigger, which belongs with Scenario 2 if you extend it.
- **Compatibility and accessibility.** Not applicable. The capability ships no UI.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
