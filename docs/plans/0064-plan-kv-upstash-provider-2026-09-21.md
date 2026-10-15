# Plan: kv-upstash, the second real KV vendor and a globally exact limiter

Grilled: 2026-09-21

## Context

`kv` ships today with `kv-cloudflare` and `kv-memory` (#129, [plan 0052](0052-plan-kv-capability-module-2026-09-08.md)). Both were written against the same contract, but neither proves the contract is vendor-blind: one is a Workers binding and the other is a `Map` in the same isolate. Nothing in the repo shows a project moving to a vendor with an account, a secret and a network hop, which is the claim AGENTS.md makes when it names `kv-upstash` as the swap target.

There is also a capability gap only a second vendor closes. Cloudflare's Rate Limiting binding counts inside one colo and returns `{ success }` with no count and no reset time, so `ratelimit` cannot send `RateLimit-Limit` or `RateLimit-Remaining` on the production provider today. A project that needs one global budget — an API key quota, a paid tier's request ceiling — has nowhere to go. Upstash Redis counts once, globally, and reports both numbers.

Success means three things. `saasaloy add kv-upstash` then `KV_PROVIDER=upstash` moves a project across with no edit to `packages/kv`, `ratelimit` or `feature-flags`. `consume` returns a real `remaining` and `resetAt`, and the middleware's header block fires. The build finds no contract change was needed; where it finds pressure, that goes in the report, not in this branch.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Transport | The `@upstash/redis` SDK, added through one `package-json-dependency` patch into `packages/kv/package.json`, the way `billing-stripe` adds `stripe`. The SDK manages the `upstash-sync-token` header, so a read after a write is consistent on a global database with read replicas. |
| Entry point | `@upstash/redis/cloudflare`, the documented Workers build. The bare specifier resolves to `nodejs.mjs`, which is the Node build and may want `nodejs_compat`. Both share the same internal chunk, so the Workers entry is a thin subclass, 2 KB smaller, and its constructor takes `(config, env)`. |
| Limiter | Hand-rolled, not `@upstash/ratelimit`. One `redis.eval` script does `INCR`, `EXPIRE NX` and `PTTL` atomically and returns the count and the remaining milliseconds. It is a fixed window, matching `kv-memory`, so a cross-provider test asserts the same thing. |
| Why the limiter package is out | Not size. `@upstash/ratelimit@2.1.0` declares `"main": "./dist/index.js"` and no `exports` or `module` field, so an ESM Worker bundle pulls the CJS build through interop while `dist/index.mjs` sits beside it unreferenced. It also pulls `@upstash/core-analytics` for a feature this provider turns off. The part we would use is ten lines of Lua. |
| Bundle budget | Settled and not a constraint. Cloudflare's script limit is 64 MiB uncompressed on Free and Paid alike, with no compressed limit; the live constraint is a 1-second startup budget for global scope. Measured with esbuild, minified ESM: `@upstash/redis/cloudflare` is 71.0 KB (16.1 KB gzipped), and adding `@upstash/ratelimit` would have made it 110.0 KB (26.4 KB). |
| Script caching | Plain `EVAL` on every call. Roughly 200 bytes of Lua on a request that already pays a full HTTPS round trip. `EVALSHA` with a `NOSCRIPT` fallback adds a branch that only runs after a Redis restart, so no test would ever exercise it. |
| Pinned version | `@upstash/redis` `1.38.4`. `1.39.0` published 2026-09-21 and sits inside the 4320-minute `minimumReleaseAge` cooldown. `pnpm deps:update` owns the bump after this lands. |
| `list` paging | SCAN's own semantics, passed through. `complete` is `cursor === "0"`, and a page with no keys and a live cursor is returned as-is with `complete: false`. No internal loop: one `list` call stays one round trip. |
| `list` scoping | `KV_KEY_PREFIX` is prepended to the `MATCH` glob, always. Without it, `list({})` scans the whole Redis database and returns foreign keys, which is the failure the required prefix exists to prevent. This diverges from `kv-cloudflare`, where a dedicated namespace already scopes everything, so it is also reported as a contract finding. |
| `KV_KEY_PREFIX` is required | Empty or unset, the provider throws `provider_error` at first use. The core already owns and applies the variable, so this is a precondition check rather than new behaviour. |
| JSON stays the core's | The client is built with `automaticDeserialization: false`. The SDK parses JSON on `get` by default, which would double-decode every value the core encoded. |
| Secrets | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, read off the `env` argument only. Both declared in the descriptor's `envVars` with the same detail as `email-plunk`'s. No `process.env`, no default URL. |
| `minTtlSeconds` | `1`. Redis `EX` takes whole seconds and rejects `0`, so `1` is the true floor. `kv-memory`'s `0` is right for a `Map` and wrong here. |
| Test wiring | The SDK is reached through a **dynamic** `await import()` inside the lazy client factory. The test injects a fake client and never triggers it, so nothing needs adding to the repo root and the file is fully testable. `billing-stripe` hit this same wall and shipped `stripe.ts` with no test at all; this is the pattern that fixes it. |
| Swap proof | A manual QA document, not CI. No CI job has an Upstash account. |
| `doctor` | No change. It lints descriptors and checks Cloudflare `ratelimits` budgets; it has no generic secret-presence check to extend. |

## Approach

One module, `modules/kv-upstash/`, built to `.agents/skills/create-provider/` mode `kv`. It reuses the whole core — key building, JSON encoding, the 25 MiB cap, the TTL floor check, policy resolution and the `KvError` re-throw in `run()` — and adds one runtime file plus its registration. `billing-stripe` is the descriptor model (a dependency patch plus `removeWarnings`); `kv-cloudflare` is the provider-file model (binding lookup replaced by client construction, status mapping replaced by Upstash error mapping); `kv-memory` is the test model (a stub, a shim, a 2,500-key paging test).

### Phase 1: the descriptor (built 2026-09-21)

- Write `modules/kv-upstash/registry-item.json`: `dependsOn: ["kv"]`, the two `envVars`, one `plugin-array` patch appending `upstash()` to `providers` in `packages/kv/src/index.ts`, and the file entry `files/upstash.ts` → `@kv/providers/upstash.ts`.
- Add one `package-json-dependency` patch on `packages/kv/package.json`, section `dependencies`: `@upstash/redis` `1.38.4`.
- Add a `removeWarnings` entry, copying `billing-stripe`'s wording: removing the module leaves `@upstash/redis` in `packages/kv/package.json`, and it does not delete the Upstash database or its keys.
- No `wrangler-binding` patch and no handler registration. An HTTP provider has no binding, so `infra` and `apps/api/src/worker.ts` are untouched.
- Update `KV_PROVIDER`'s description in `modules/kv/registry-item.json` to name `upstash`.

### Phase 2: get, set, delete, list (built 2026-09-21)

- `modules/kv-upstash/files/upstash.ts` exports `upstash(options?: UpstashKvOptions): KvProvider`, with `name: "upstash"` and `minTtlSeconds: 1`.
- Build the client lazily through `await import("@upstash/redis/cloudflare")`, on the first call that needs one, and cache it in a `WeakMap` keyed by the `env` object so one request builds one client and the token never becomes a `Map` key. `UpstashKvOptions.client` short-circuits the import, which is how the test reaches the file without the package.
- Missing URL, missing token or empty `KV_KEY_PREFIX` each throw `provider_error` before any request, naming the variable and the `wrangler secret put` command, in the register `kv-cloudflare` uses for a missing binding.
- `get` → `redis.get<string>(key)`, returning `null` on a miss. `set` → `redis.set(key, value)` with `{ ex: ttlSeconds }` only when the TTL is present. `delete` → `redis.del(key)`, which succeeds on an absent key.
- `list` → `redis.scan(cursor ?? "0", { match: glob(env, prefix), count: limit })`. The glob is `KV_KEY_PREFIX` plus the caller's prefix plus `*`, with `*`, `?`, `[`, `]`, `^` and `\` escaped in both parts first, or a key holding a glob character silently matches the wrong set. Return `{ keys, cursor, complete }`, `complete` true only when the returned cursor is `"0"`.
- Document in the file header that `limit` is a **hint** here: SCAN's `COUNT` is work per iteration, not a page size, so a page may hold more or fewer keys than asked.

### Phase 3: consume (built 2026-09-21)

- One Lua script, sent with `redis.eval` on every call, holding `INCR`, `EXPIRE <period> NX` and `PTTL` and returning `[count, pttl]`. Atomic, so a crash can never leave a bucket without an expiry.
- The bucket key is `${KV_KEY_PREFIX}rl:${policy.name}:${key}`, so two policies never share a bucket and two projects on one Redis never collide. The core applies `KV_KEY_PREFIX` inside `client.key()` only, and `consume` takes a raw key, so the provider applies it here itself.
- Return `{ success: count <= policy.limit, remaining: Math.max(0, policy.limit - count), resetAt: Date.now() + pttl }`. A refusal is a value; never throw for a spent budget.
- No `periodSeconds` guard. The 10-or-60 restriction is Cloudflare's alone and has no counterpart here.

### Phase 4: error mapping (built 2026-09-21)

- One `normalize(cause)` function, the same shape as `kv-cloudflare`'s. Re-throw a `KvError` untouched, wrap everything else.
- Map the HTTP status the SDK puts in an `UpstashError` message: `429` → `rate_limited` / retryable (the daily and per-second request caps), `401` and `403` → `provider_error` / not retryable (a wrong token is a deploy fault, and retrying makes it worse), `413` and a `max request size` message → `too_large`, the `5xx` family → `provider_error` / retryable. Everything else falls through to `provider_error` / not retryable.
- Keep the raw status or the leading `ERR` token in `providerCode`.
- Note the size asymmetry in the file header: Upstash caps one record at 1 MB on the free plan, far under the core's 25 MiB `too_large` check, so a value can pass the core and still be refused. The provider maps that refusal to `too_large` so the caller sees one code either way.

### Phase 5: tests (built 2026-09-21)

- Add `modules/kv-upstash/provider.ts`, the one-line re-export shim, and leave it out of the descriptor's `files`.
- `modules/kv-upstash/files/upstash.test.ts`, on `node:test`, with a fake client passed through `UpstashKvOptions`. Cover: a `get` miss returns `null`; `set` passes `ex` only when a TTL is given; `set` with no TTL passes no options; a value round trips unparsed, proving `automaticDeserialization: false`; `delete` on an absent key succeeds.
- A SCAN paging test over 2,500 keys, mirroring `kv-memory`'s, plus three cases that only exist here: an empty page with a live cursor reports `complete: false`; a prefix holding a glob character is escaped; the `MATCH` glob carries `KV_KEY_PREFIX`.
- A `consume` test asserting `remaining` counts down and `resetAt` is present, one asserting a spent budget returns `{ success: false }` rather than throwing, and one asserting the bucket key carries the policy name and the prefix.
- An error-mapping table test, one row per status.
- A precondition test: no URL, no token, empty `KV_KEY_PREFIX` — each throws `provider_error` naming the variable, and no request leaves.

### Phase 6: docs, the report, and the swap proof (built 2026-09-21)

- Update `modules/kv/skills/saasaloy-kv/SKILL.md`: the provider table gains a row, and the sections on the TTL floor, `list` paging and `consume` gain the Upstash column. Say plainly that `remaining` is present on `upstash` and absent on `cloudflare`, and that `KV_KEY_PREFIX` is required on `upstash` and scopes its `list`.
- Update `modules/ratelimit/skills/saasaloy-ratelimit/SKILL.md`. Its per-colo paragraph already says a global count "is a different store … and a different provider"; point that sentence at this module.
- Add `kv-upstash` to the README provider row.
- File one follow-up issue carrying all three contract findings plus the conformance suite (filed as #172): `KvProvider` wants a `maxValueBytes` beside `minTtlSeconds`; `KvListOptions.limit` is under-specified for a cursor store; `KvListOptions.prefix` is under-specified about `KV_KEY_PREFIX` on every provider; and three hand-written provider test files want one shared conformance suite, a pattern `queue`, `storage` and `email` share.
- Write the swap proof as a QA document: install `kv`, `ratelimit` and `kv-upstash` into `.dev`, set `KV_PROVIDER=upstash` with real credentials, confirm a limited route returns `RateLimit-Remaining`, and confirm `git diff` touches no file in `packages/kv/src`, `ratelimit` or `feature-flags`.
- Run `pnpm lint`, `pnpm test`, `pnpm deps:verify`.

### Rejected alternatives

- **Raw `fetch` against the REST API**, the `email-plunk` shape. Keeps `packages/kv` at zero runtime dependencies, but we would own the `upstash-sync-token` handshake.
- **`@upstash/ratelimit`.** Rejected on packaging and a transitive analytics dependency, not on size. See the decisions table.
- **Pipelined `INCR` + `EXPIRE`** instead of `EVAL`. Not atomic; a failure between them leaves a bucket with no expiry and locks a key out permanently.
- **`EVALSHA` with a `NOSCRIPT` fallback.** Saves ~200 bytes per limited request and adds an untested branch.
- **Both packages in the repo root `devDependencies`** so a static import resolves under `pnpm test:modules`. The dynamic import gets the same tests with nothing added to the root.

## Open questions

None. Every branch settled in the grill on 2026-09-21. Four items are deferred by decision rather than by doubt, and all four are the single follow-up issue in Phase 6: `maxValueBytes` on the contract, `limit` on a cursor store, `prefix` versus `KV_KEY_PREFIX`, and the cross-provider conformance suite.

## Non-goals

- Any change to `packages/kv/src/provider.ts` or the contract it declares. Pressure found there is reported, not patched.
- `queue-upstash`, `kv-redis`, or any self-hosted Redis provider.
- A sliding-window or token-bucket limiter, multi-region replication, or limiter analytics.
- Upstash's non-Redis products, including Vector, QStash and Workflow.
- A `cache` module, an HTTP response cache, or a purge-on-write path. Still a separate follow-up from plan 0052.
- Migrating existing data from Workers KV into Upstash. The platform owns the entries and a project never moves them (ADR 0033).
- Any `doctor` check, and any CI job that reaches a real Upstash database.
