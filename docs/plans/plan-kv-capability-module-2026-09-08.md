# Plan: `kv` capability with `kv-cloudflare`, `kv-memory`, `ratelimit` and `feature-flags`

Grilled: 2026-09-08

Issue: [#129](https://github.com/mimukit/saasaloy/issues/129). Source: `docs/plans/plan-module-catalog-2026-09-07.md` (P0 #7 and #8), `docs/research/research-module-libraries-2026-09-07.md`. Independent of #125, #126, #127 and #128.

## Context

The catalog listed `kv`, `ratelimit`, `cache`, `feature-flags`, `maintenance-mode` and `kill-switches` as six entries under a `platform` grouping. They do not share a provider story. A key-value store has one, an HTTP response cache has another, and flags have none at all. This plan splits them the way the issue does: `kv` owns the contract, `ratelimit` and `feature-flags` are features built on it and ship no providers of their own, and `cache` stays a later module.

The capability follows the `email` shape (AGENTS.md "portable capabilities, swappable providers") and the `queue`, `billing` and `storage` precedents from 2026-09-08: a vendor-blind core in `packages/kv`, one provider file registered by `plugin-array`, `KV_PROVIDER` selecting at runtime, and a local provider so a project develops with no Cloudflare account. ADR 0033 (on the #125 branch) already places `kv` on the provider side of the system-of-record test, so this plan needs no new ADR for the shape.

Success means: `saasaloy add kv kv-cloudflare ratelimit feature-flags` produces a project where a route declares a rate limit policy and a burst gets a 429 with `Retry-After`, an admin toggles a flag in the admin app and the running Worker changes behaviour inside about 70 seconds with no deploy, and `KV_PROVIDER=memory` with `kv-memory` runs the same routes, the same limiter and the same flags with no Cloudflare account and no network.

Platform facts checked against the Cloudflare docs on 2026-09-08. **Workers KV is eventually consistent**: a write is visible at once in its own location and takes **up to 60 seconds** elsewhere. A key caps at 512 bytes, a value at 25 MiB, metadata at 1024 bytes. `expirationTtl` has a **60 second floor**; anything shorter is unsupported. **One write per second to the same key**, and concurrent writes to one key overwrite each other. Free plan: 100,000 reads a day, 1,000 writes a day to distinct keys, 1 GB. Paid plan: unlimited reads and writes. 1,000 KV operations per Worker invocation. Default read `cacheTtl` is 60 seconds, minimum 30.

The **Rate Limiting binding** (GA 2025-09-19) is configured in `wrangler.jsonc` under a top-level `ratelimits` array, each entry carrying `name`, `namespace_id` and `simple: { limit, period }`. `period` is **10 or 60 seconds, nothing else**. `await env.LIMITER.limit({ key })` returns `{ success }` and **nothing more**: no remaining count, no reset time. Limits are **per Cloudflare location, not global**, and the docs call the API "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system".

Those two paragraphs decide most of what follows. KV cannot count, and the binding that can count will not tell you the count.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| `unstorage` is rejected in the core and in the provider | AGENTS.md requires a capability core to hold zero runtime dependencies, and `unstorage` ships every driver. Inside `kv-cloudflare` it buys nothing either: the KV binding is four methods, and `unstorage` would sit between our contract and those four calls for no gain. It also cannot express the limiter policy or the TTL floor, which is where the real work is. Issue Phase 1's last checkbox is satisfied here. |
| Rate limiting is a **named policy**, not a counter | Cloudflare fixes `limit` and `period` in `wrangler.jsonc` per binding, and `limit()` returns only `{ success }`. An `increment(key)` contract method is therefore unimplementable on the default provider. The contract declares an optional `consume({ policy, key })` returning `{ success, remaining?, resetAt? }`. `kv-cloudflare` resolves `policy` to the binding named `RL_<POLICY>`. `kv-memory` counts properly and fills in `remaining` and `resetAt`. |
| `consume` carries the policy **name only**, and `packages/kv` owns the policy table | Sending `limit` and `periodSeconds` on every call would ship a second copy of numbers Cloudflare ignores, and any caller could then quietly disagree with `wrangler.jsonc`. So `defineKv({ providers, policies })` holds them, `definePolicy` is exported from `@kv`, and `ratelimit` registers its three by `plugin-array` — exactly `defineQueue({ providers, jobs, schedules })`. `kv-memory` reads the table it is already part of, so no package depends on an app. The cost is that a vendor-blind core learns the word *policy*, which is accepted. |
| Three policies ship, a fourth is a hand-edit | `strict` (10 per 10 s), `default` (100 per 60 s), `loose` (1000 per 60 s). `kv-cloudflare` patches one `ratelimits` entry per default policy. A project adding a fourth policy adds the wrangler entry by hand, and the skill carries the snippet. `periodSeconds` outside `{10, 60}` throws on the Cloudflare provider when the policy is registered. |
| Rate limit headers are sent only when the provider reports a number | `RateLimit-Limit` and `RateLimit-Remaining` go out only when `consume` returned `remaining`. Cloudflare never does, so it never sends them, and no wrong number can reach a client. This needs no provider flag: the presence of the field is the signal. |
| The numbers can drift between `policies.ts` and `wrangler.jsonc`, and only the names are checked | Editing `strict` to 5 per 10 s in code changes nothing on Cloudflare. A doctor check that compared the numbers would have to parse project TypeScript for literal values, which is a new capability rather than an extension. The check verifies **names** instead: every registered policy has a matching `RL_<NAME>` binding, which is the failure that actually happens. Number drift is a documented hazard in the skill, not a check. |
| Doctor reads the policy names with the parser the patch already uses | `plugin-array` parses `packages/kv/src/index.ts` to patch that array, so the doctor check reads the names from the same file with the same `ts-ast` helpers. Names only, never numbers. A policy a project added itself is therefore covered, which a descriptor-declared list could not do. |
| The limiter's early failure is a first request, not construction | Workers has no `env` at module scope, so `rateLimit({ policy })` cannot call `createKv(env)` when the route file loads. The check runs on the first request through any rate-limited route and caches its result, and `saasaloy doctor` gives the pre-deploy signal. Both, because doctor cannot see a provider swapped by an env var after deploy. |
| The limiter fails open, and says so | When `consume` throws `provider_error`, the middleware logs a warning and lets the request through. `rateLimit({ policy, onError: "deny" })` flips it per route. A KV or binding outage taking the whole API down is worse than a window of unlimited requests, and the choice is stated in the skill rather than buried. |
| `Retry-After` is the honest number the provider gives | With `resetAt` the middleware sends the seconds until reset. Without it, on Cloudflare, `Retry-After` is the policy period read from the `kv` policy table. |
| The default limiter key is policy, route path and IP | Two routes sharing the `default` policy would otherwise share one bucket per client, so burning the budget on `/search` would 429 `/upload`. A per-route default is recoverable by passing an explicit `key`; a shared default is not. `key` stays overridable per route. |
| The per-colo limit is documented as a multiplier, not hidden | The Cloudflare limiter counts per location, so the effective global ceiling is the policy limit times the number of colos serving that client. The skill states it and says that a global limit needs `kv-upstash` or a Durable Object, neither of which this plan builds. |
| TTL below the provider floor throws, it does not round | Each provider declares `minTtlSeconds` (60 on Cloudflare, 0 in memory). `set()` with a shorter TTL raises `KvError("invalid_ttl")` naming the floor and the provider. Silently rounding 5 seconds up to 60 would make a cache-aside call behave differently on two providers with no signal, which is the failure the whole capability exists to prevent. |
| The Cache API is out of scope | An HTTP response cache keys on a `Request`, returns a `Response`, and is per-colo. It is a different contract wearing the same word. The catalog already carries `cache` as a separate P2 module. The issue's `kv-cloudflare` Cache API criterion is dropped, and the follow-up issue is filed in Phase 1. |
| Keys are namespaced by the capability, never by the caller | `buildKey({ namespace, parts })` produces `<KV_KEY_PREFIX><namespace>:<part>:<part>`. A caller passes parts, not a path. The core rejects a namespace or part containing `:`, and rejects a built key over 512 bytes with `invalid_key`. `KV_KEY_PREFIX` (default empty) lets two environments share one namespace. |
| The core owns serialization, and the 25 MiB cap | `get<T>` and `set` take and return values; the core JSON-encodes and decodes, so a provider stores strings only. A value over 25 MiB raises `too_large` in the core, before any provider sees it. |
| `list` ships in v1, and is exercised by a test | Nothing in this plan calls it, so it would ship as an unchecked promise. It stays because it completes the contract and gives `kv-upstash` a `SCAN` target, and a 2,500-key paging test on `kv-memory` makes the cursor real rather than assumed. |
| Cache-aside sits in the core, with its limits named | `cached(key, ttlSeconds, fn)` reads, and on a miss runs `fn`, writes and returns. It gives no stampede protection and no stale-while-revalidate: two concurrent misses both run `fn`, and on KV both writes land within the one-write-per-second cap or the second is dropped. The 60 second TTL floor and the 60 second propagation window mean cache-aside on `kv-cloudflare` suits slow-changing data only. |
| Error codes | `KvError`: `invalid_key`, `invalid_ttl`, `too_large`, `rate_limited`, `not_supported`, `provider_error`. A missing key is not an error; `get` returns `null`. Providers map vendor codes, keep the raw one in `providerCode`, and set `retryable` honestly. The core never retries. |
| `KvEnv` is opaque, no `Bindings` patch | `KV_PROVIDER?`, `KV_KEY_PREFIX?` and an index signature, matching `EmailEnv`, `QueueEnv` and `StorageEnv`. The provider file casts its own bindings. `apps/api/src/index.ts` is not patched. |
| `ratelimit` ships no package and applies nothing globally | It writes `apps/api/src/middleware/ratelimit.ts` and registers three policies into `kv.policies` by `plugin-array`. It patches no `app.use`, so a fresh install rate-limits nothing until a route asks. `dependsOn: ["api", "kv"]`. |
| `namespace_id` ships as `"1001"`, `"1002"`, `"1003"` | The value must be a unique positive integer per Cloudflare account, and the docs do not describe what a collision does. A working `wrangler dev` straight after `saasaloy add` is worth more than guarding an undocumented hazard, and the `kv_namespaces` `id` already forces one manual edit. The skill tells the reader to change them if the account uses them. |
| `feature-flags` does ship a package | Kill switches mean `billing`, `ai` and `email` code will eventually import `assertEnabled`, and `apps/api/src/...` is not a stable import target for another module. It scaffolds `packages/feature-flags` with alias `@flags`. Type stays `saasaloy:feature`. |
| The database is the flag's source of truth, kv is a published read cache | `feature_flag` and `feature_flag_override` tables hold the values. The admin screen reads and writes the tables directly, so it never shows its own write stale. **A write publishes the KV document; a reader never writes on a hit.** Reader write-back would have scaled writes with traffic and colo count, which the free plan's 1,000 writes a day cannot carry. Published this way, KV writes equal toggles. |
| The published document has no TTL, and the isolate cache has a 10 second one | With the admin publishing, the KV document has no reason to expire, so it is written permanently. The isolate-local `Map` is then the only thing between a toggle and a warm Worker, and it has expiry but no invalidation. `FLAGS_ISOLATE_TTL_SECONDS` defaults to **10**, so a toggle lands within about 70 seconds worldwide once KV's own propagation window is added. At 10 seconds a scope costs 8,640 KV reads a day per isolate, well inside the free plan's 100,000. |
| A read before the first publish falls back to the database and publishes | A fresh deploy has an empty namespace and nothing to serve. The reader reads the tables and writes the document. This miss happens once per scope, not once per colo per TTL, so the write-budget problem does not come back through the side door. |
| `flag()` takes its subject and tenant from the caller | `flag(key, { subjectId, tenantId })`, both optional. Reading the tenant from the Hono context would need a convention neither `teams` nor #128 has settled, and adding `teams` to `dependsOn` would force an organization model on a project that only wants flags. A missing `tenantId` resolves the global value, which is correct for a single-tenant project. |
| Flags are declared in code with a default | `defineFlag({ key, type, default })` registered by `plugin-array` gives `flag()` a typed key set and gives a fresh deploy a working value before anyone opens the admin screen. Adding a new flag key needs a deploy; changing any flag's value does not. |
| Resolution order is tenant override, then global row, then code default | Three levels, checked in that order, with the code default as the floor that cannot be missing. |
| Percentage rollout buckets deterministically with a sync hash | FNV-1a 32-bit over `flagKey + ":" + subjectId`, modulo 100. Sync, zero dependencies, and stable, so one user does not flip between requests. Web Crypto was rejected because it is async and would make `flag()` await a digest per call. |
| One cache document per scope, not one key per flag | `flags:v1:global` and `flags:v1:t:<tenantId>` each hold the whole resolved flag set. One KV read serves a request no matter how many flags it checks, which matters against the 1,000-operations-per-invocation cap. |
| Maintenance mode and kill switches are reserved flag keys | `system.maintenance` drives a middleware that serves a 503 page, bypassing for a session whose role is admin and for a configured path list. `kill.<integration>` drives `assertEnabled(name)`, which throws when the switch is off. Neither is a separate module. |
| `auth` stays in `feature-flags`'s `dependsOn`, and the plan says why plainly | The admin bypass on the maintenance middleware needs a session. No cost is actually paid for it: `feature-flags` ships an admin screen, `admin` depends on `auth`, so the dependency arrives transitively regardless. Splitting maintenance mode into a fourth module for one middleware and one page was rejected. |
| `infra` translator stays out of scope | `translate.ts` handles `d1_databases` and `vars` only. `kv_namespaces` and `ratelimits` join the same follow-up issue #125 Phase 1 opened for `send_email`, `queues` and `triggers`. The skill states the gap. |

## Approach

Reuses, by name: `modules/email/files/src/{define,provider,index}.ts` as the core template and the throw-never-fall-back selection rule; `modules/email-cloudflare/files/cloudflare.ts` for the error-mapping shape and `modules/email-console/files/console.ts` for the local provider; `packages/cli/src/lib/patch/ts-module.ts` (`plugin-array`) for provider, policy and flag registration, and its `ts-ast` helpers again for the doctor check; `packages/cli/src/lib/patch/jsonc.ts` (`wrangler-binding`) unchanged, because `kv_namespaces` and `ratelimits` are both top-level arrays and need no dotted path; `packages/cli/src/lib/doctor.ts` `checkProject` as the precedent for a check that reads a consumer project's own files; `chained-route` (ADR 0028) for the `/flags` routes; `const-array` on `NAV_ITEMS` for the admin page, as `modules/teams` does; `modules/auth/files/db/schema/auth.{sqlite,pg}.ts` with `onlyWith` for the two dialect variants; `modules/database`'s repository pattern for the flag reads; `@ui/blocks` (ADR 0030) for the admin toggle block; `.agents/skills/create-provider/SKILL.md` gains a `kv` mode. `saasaloy remove` already refuses while a dependent is installed (`remove.ts:269`), so removal ordering needs no new rule.

Rejected alternatives, one line each:

- `unstorage` as the core, or inside `kv-cloudflare`. A dependency in a zero-dependency core, or an abstraction over four binding calls that still cannot express the policy or the TTL floor.
- An `increment(key, ttl)` counter on the contract. Unimplementable on the default provider, because `limit()` returns no count and KV caps a key at one write a second.
- A read-modify-write limiter on the plain kv contract. Undercounts exactly where it matters, a burst from one client, and burns the free plan's daily write budget.
- `ratelimit` as its own capability with its own providers. Breaks the issue's promise that swapping `kv` swaps the limiter for free, and adds two modules to say the same thing.
- `limit` and `periodSeconds` on every `consume` call. Ships a second copy of numbers Cloudflare ignores, and lets any caller disagree with `wrangler.jsonc` unnoticed.
- The policy table in `apps/api`. Makes `packages/kv` depend on an app to resolve a policy name.
- A doctor check comparing the policy numbers. Needs project TypeScript parsed for literal values, a new capability for a check that catches the rarer of the two failures.
- Failing at middleware construction. There is no `env` at module scope in Workers, so the guarantee is unbuildable as stated.
- The Cache API in the `kv` contract as optional methods. Puts `Request` and `Response` semantics into a value store, and `kv-memory` could only throw.
- KV as the only flag store. The admin screen reads its own write stale, and per-tenant overrides need a key per tenant with no cheap way to list them.
- Readers writing the flag cache back on a miss. Writes scale with traffic and colo count, so the free plan's 1,000 daily writes are gone in an hour.
- A 300 second isolate cache. A toggle would take up to six minutes to reach a warm isolate, which "without a deploy" cannot honestly mean.
- Reading `tenantId` from the Hono context, or depending on `teams`. One needs a convention nobody has settled, the other forces an organization model on a flags-only project.
- Clamping a short TTL up to the Cloudflare floor. Two providers behave differently with no signal to the caller.
- A crypto digest for percentage bucketing. Async, so every `flag()` call would await.
- `"<replace-me>"` for `namespace_id`. Costs a working `wrangler dev` out of the box to guard a hazard the docs do not describe.
- Maintenance mode as a fourth module. A whole descriptor for one middleware and one page, to drop a dependency that arrives through `admin` anyway.

### Phase 1: glossary, scope corrections and follow-ups

- [ ] Confirm ADR 0033 (on the #125 branch) lists `kv` on the provider side and needs no amendment for this capability. Record the check; write no new ADR.
- [ ] Update `CONTEXT.md` with "Namespace", "Policy", "Flag", "Kill switch" and "Maintenance mode" entries.
- [ ] Verify AGENTS.md's `kv` sentence matches this plan; it already names `kv-cloudflare` and `kv-upstash` as the provider pair.
- [ ] Rewrite #129's Phase 2 Cache API criterion and its Phase 3 native-binding criterion to match the decisions above.
- [ ] File the follow-up issues: a `cache` module for HTTP response caching and purge-on-write; `kv-upstash` as the second real provider and the path to a globally exact limiter; `infra` translator support for `kv_namespaces` and `ratelimits`; a per-job cron lock over `kv` for #125.

### Phase 2: the neutral core (`packages/kv`)

- [ ] `modules/kv/registry-item.json`: `saasaloy:capability`, `dependsOn: ["api"]`, `envVars` for `KV_PROVIDER` and `KV_KEY_PREFIX`, scaffold `packages/kv` with alias `@kv`, patch `@repo/kv` into `apps/api/package.json`.
- [ ] `provider.ts`: `KvProvider` (`name`, `minTtlSeconds`, `get`, `set`, `delete`, `list`, optional `consume`), `KvEnv`, `KvListResult` (`keys`, `cursor`, `complete`), `Policy`, `ConsumeRequest` (`policy`, `key`), `ConsumeResult` (`success`, `remaining?`, `resetAt?`), `KvError` with the six codes.
- [ ] `define.ts`: `defineKv({ providers, policies })`, `create(env)` selecting on `KV_PROVIDER` with the same throw-never-fall-back rule as `email`, `definePolicy`, policy lookup by name raising `not_supported` for an unregistered one, JSON encode and decode, the 25 MiB `too_large` check, the `minTtlSeconds` check raising `invalid_ttl`, the `not_supported` throw for a missing `consume`, and the wrap of a raw provider throw into `KvError`.
- [ ] `keys.ts`: `buildKey`, the `:` rejection and the 512-byte check, with tests.
- [ ] `cached.ts`: the cache-aside helper, with its no-stampede-protection behaviour tested rather than assumed.
- [ ] `index.ts` barrel with `export const kv = defineKv({ providers: [], policies: [] })` and `createKv(env)`; `src/providers/.gitkeep`.
- [ ] `package.json` exports `.` and `./providers/*`; `clean` script with pinned `rimraf`.
- [ ] Unit tests: selection, unset and unknown `KV_PROVIDER`, key building and rejection, TTL floor, oversize value, unregistered policy name, `not_supported` from a provider without `consume`, `KvError` wrapping a raw throw, cache-aside hit and miss.

### Phase 3: `kv-cloudflare` and `kv-memory`

- [ ] `modules/kv-cloudflare`: one file `files/cloudflare.ts` at `@kv/providers/cloudflare.ts`, exporting `cloudflare()` with `minTtlSeconds: 60`.
- [ ] Patches: `wrangler-binding` `kv_namespaces` entry `{ binding: "KV", id: "<replace-me>" }` matched on `binding`; three `ratelimits` entries `RL_STRICT`, `RL_DEFAULT`, `RL_LOOSE` with `namespace_id` `"1001"`, `"1002"`, `"1003"` and their `simple` blocks; `plugin-array` into `kv.providers`.
- [ ] `get`, `set`, `delete` and `list` go through the KV binding. `set` passes `expirationTtl`. `list` passes `prefix`, `cursor` and `limit`, and returns the cursor through.
- [ ] `consume` resolves `policy` to `env["RL_" + policy.name.toUpperCase()]`, throws `not_supported` naming the missing binding and the wrangler snippet when it is absent, throws when the policy's `periodSeconds` is not 10 or 60, and returns `{ success }` with no `remaining` and no `resetAt`.
- [ ] Map KV and binding failures onto the six codes, keep the raw code in `providerCode`, set `retryable` honestly.
- [ ] `modules/kv-memory`: one file `files/memory.ts` at `@kv/providers/memory.ts`, `minTtlSeconds: 0`. A `Map` of key to `{ value, expiresAt }`, expiry honoured on read, `list` by prefix with a real cursor, and a `consume` that counts a fixed window from the policy table and fills in `remaining` and `resetAt`.
- [ ] A `kv-memory` test pages through 2,500 keys with `list`, so the cursor is exercised by something rather than shipped unchecked.
- [ ] `.agents/skills/create-provider/SKILL.md` gains a `kv` mode. The `saasaloy-kv` skill documents `wrangler kv namespace create app-kv`, the eventual-consistency window, the 60 second TTL floor, the one-write-per-second key cap, the free-plan daily budgets, what cache-aside is and is not safe for, the per-colo limiter multiplier, changing the `namespace_id` values on a busy account, adding a fourth policy binding by hand, that the policy numbers in code and in `wrangler.jsonc` can drift with no check, and the `infra` translator gap.

### Phase 4: `ratelimit`

- [ ] `modules/ratelimit/registry-item.json`: `saasaloy:feature`, `dependsOn: ["api", "kv"]`, no `envVars`, no scaffold. Three `plugin-array` patches registering `strict`, `default` and `loose` into `kv.policies`.
- [ ] `apps/api/src/middleware/ratelimit.ts`: `rateLimit({ policy, key?, onError? })` returning Hono middleware. `key` defaults to policy name, route path and the `CF-Connecting-IP` header, falling back to a fixed string with a warn log when the header is absent, so a missing header does not silently make every client one bucket.
- [ ] The provider capability check runs on the first request through any rate-limited route and caches its result, throwing `not_supported` naming the provider and the missing method. Not at construction; Workers has no `env` at module scope.
- [ ] A refusal returns 429 with `Retry-After` (seconds to `resetAt`, or the policy period when the provider reports none), plus `RateLimit-Limit` and `RateLimit-Remaining` only when the provider reported `remaining`.
- [ ] Limits apply per route, never globally: the module patches no `app.use`, and the skill shows `app.get("/x", rateLimit({ policy: "strict" }), handler)`.
- [ ] `saasaloy doctor` gains a check that reads the `policies` array from `packages/kv/src/index.ts` with the existing `ts-ast` helpers and verifies each name has an `RL_<NAME>` entry in `wrangler.jsonc`. Names only; it never reads the numbers. Tests in `doctor.test.ts`.
- [ ] Tests over `kv-memory`: under the limit passes, over it returns 429 with a correct `Retry-After`, a `provider_error` passes with `onError` unset and refuses with `onError: "deny"`, two keys do not share a bucket, and two routes on one policy do not share a bucket.
- [ ] The `saasaloy-ratelimit` skill documents the three policies, adding a fourth in both places, the per-colo multiplier, the fail-open default, why the Cloudflare provider sends no remaining count, and that a number edited in `policies.ts` alone changes nothing on Cloudflare.

### Phase 5: `feature-flags`, maintenance mode and kill switches

- [ ] `modules/feature-flags/registry-item.json`: `saasaloy:feature`, `dependsOn: ["api", "database", "auth", "admin", "kv"]`, `envVars.FLAGS_ISOLATE_TTL_SECONDS` (default 10), scaffold `packages/feature-flags` with alias `@flags`, patch `@repo/feature-flags` into `apps/api` and `apps/admin`. A `removeWarnings` entry in the shape `teams` uses: the deployed flag tables survive removal, and the published KV documents survive it too.
- [ ] `feature_flag` and `feature_flag_override` in two dialect variants under one target with `onlyWith`: key, description, type (`boolean` or `percentage`), enabled, percentage, tenantId on the override, timestamps; unique on key and on `(flagKey, tenantId)`.
- [ ] `defineFlag`, the `FLAGS` array registered by `plugin-array`, and the typed `flag(key, { subjectId, tenantId })` helper resolving tenant override, then global row, then code default.
- [ ] `hash.ts`: FNV-1a 32-bit and the modulo-100 bucket, with a test proving the same subject lands in the same bucket across calls and that the distribution across 10,000 subjects is within a stated tolerance.
- [ ] The resolver: isolate-local `Map` with a 10 second TTL, then the published `kv` document (`flags:v1:global`, `flags:v1:t:<tenantId>`), then the database. A database fallback publishes the document, which happens once per scope rather than per colo.
- [ ] Routes at `/flags` by `chained-route`: list, read one, update the global value, set and clear a tenant override. Every write goes to the database and then republishes both documents. The published document carries no TTL.
- [ ] Maintenance middleware on the reserved `system.maintenance` flag: a 503 with a custom page, bypassing for an admin session and for a configured path list. Registered by the project, not globally patched.
- [ ] `assertEnabled(name)` over `kill.<name>` keys, and three seeded switches for payments, AI and email.
- [ ] `@ui/blocks/feature-flags.tsx` and the `apps/admin` `/flags` page, wired into `NAV_ITEMS` by `const-array`: the flag list, a boolean toggle, a percentage slider, per-tenant overrides and a maintenance mode switch. The screen reads the database, never the cache.
- [ ] End-to-end in `.dev`: `saasaloy add kv kv-cloudflare ratelimit feature-flags` typechecks and runs under `wrangler dev`; a burst on a `strict` route returns 429; a toggle in the admin app changes a route's behaviour with no deploy; the same three checks pass under `kv-memory` with `KV_PROVIDER=memory`; `saasaloy remove kv` refuses while `ratelimit` is installed; `saasaloy remove kv-cloudflare` leaves `wrangler.jsonc` and `index.ts` byte-identical.
- [ ] The `saasaloy-feature-flags` skill documents the resolution order, the two cache layers and the roughly 70 second propagation window, that a KV write happens per toggle rather than per read, adding a flag key, and that a new key needs a deploy while a value change does not.

## Open questions

None left open by the grill on 2026-09-08. Four items are deferred by decision, not by doubt, and each is a follow-up issue filed in Phase 1: the `cache` module for HTTP response caching, `kv-upstash` and the globally exact limiter, the `infra` translator's `kv_namespaces` and `ratelimits` support, and the per-job cron lock #125 deferred here.

## Non-goals

- The Cloudflare Cache API, `Cache-Control` helpers, stale-while-revalidate and purge-on-write. A follow-up `cache` module.
- `kv-upstash`, `kv-redis`. The contract must admit them; this plan does not build them.
- A globally exact rate limiter. Cloudflare's binding counts per colo, and nothing in this plan changes that.
- Detecting a rate limit policy whose numbers disagree between `policies.ts` and `wrangler.jsonc`. Documented, not checked.
- Sliding windows, token buckets, and any period other than the provider's own.
- Distributed locks, atomic compare-and-swap, and the per-job cron lock #125 deferred here. All need a primitive Workers KV does not have.
- Stampede protection and stale-while-revalidate in the cache-aside helper.
- An audit trail of who toggled which flag, and flag scheduling.
- A/B testing, variant assignment and exposure events. The catalog lists `ab-testing` separately.
- Client-side or React flag evaluation. `flag()` runs on the server.
- OpenFeature, LaunchDarkly, or any external flag service.
- Copying keys between providers, and any `saasaloy migrate kv`.
- `infra` translator support for `kv_namespaces` and `ratelimits`.
