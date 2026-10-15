---
name: saasaloy-kv
description: Runbook for the kv capability — a provider-agnostic key-value store in packages/kv with per-provider modules (kv-cloudflare, kv-upstash, kv-memory). Use when caching a value from a route, building a namespaced key, choosing or switching KV_PROVIDER, hitting a TTL floor or a key-size error, registering a rate limit policy, or writing a custom kv provider.
---

# kv — provider-agnostic key-value storage from `packages/kv`

`packages/kv` (`@repo/kv`) is the capability core: a provider registry, a rate limit policy table,
namespaced key building, JSON serialization, and one normalized error type. It has **zero runtime
dependencies** and imports no vendor SDK and no Workers binding. Each provider ships as its own
module — `kv-cloudflare` (Workers KV plus the Rate Limiting binding), `kv-upstash` (Upstash Redis over
HTTPS, with a globally exact limiter) and `kv-memory` (an in-process map for dev and tests) — dropping one file into `src/providers/` and registering itself in the
`providers` array in `src/index.ts`.

Callers import `@repo/kv`, call `createKv(env)`, and never learn which provider is active.

## Providers

| Module | `KV_PROVIDER` | `minTtlSeconds` | `consume` | Needs |
|---|---|---|---|---|
| `kv-cloudflare` | `cloudflare` | 60 | yes, through the Rate Limiting binding | a KV namespace, plus the `kv_namespaces` and `ratelimits` entries its patches add to `apps/api/wrangler.jsonc` |
| `kv-upstash` | `upstash` | 1 | yes, one global fixed-window count with `remaining` and `resetAt` | an Upstash Redis database, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and a non-empty `KV_KEY_PREFIX` |
| `kv-memory` | `memory` | 0 | yes, a real fixed-window count | nothing — no account, no binding, no network |

`kv-memory` is per-isolate. Two `wrangler dev` processes, or two isolates of one deployed Worker, hold two unrelated maps. Use it for development and tests, never for anything shared.

They differ in four ways a test can see, and each one is a way to pass locally and fail in production:

- **Consistency.** `kv-memory` reads back a write on the next line, and so does `kv-upstash`. Workers KV takes up to 60 seconds to reach another location.
- **The TTL floor.** `set(key, value, { ttlSeconds: 5 })` works on `kv-memory` and `kv-upstash`, and throws `invalid_ttl` on `kv-cloudflare`. Nothing rounds.
- **How much `consume` reports.** `kv-memory` and `kv-upstash` fill in `remaining` and `resetAt`. Cloudflare's binding returns `{ success }` alone, so a test asserting on `remaining` is asserting about those two providers, not about the contract.
- **What `list` pages over.** `kv-cloudflare` and `kv-memory` return a full page until the last one. `kv-upstash` passes Redis `SCAN` through, where `limit` is a hint and an empty page can carry a live cursor. Page until `complete` is true on every provider, never until a page comes back empty.

## Read and write from a route

```ts
// apps/api/src/routes/widgets.ts
import { Hono } from "hono";
import { createKv } from "@repo/kv";

const widgets = new Hono();

widgets.get("/:id", async (c) => {
  const store = createKv(c.env);
  const key = store.key({ namespace: "widget", parts: [c.req.param("id")] });

  const widget = await store.cached(key, 300, () => loadWidget(c.req.param("id")));
  return c.json(widget);
});
```

`get` returns `null` for a key that is absent or expired. A miss is not an error, so there is
nothing to catch on the happy path.

## Build every key with `key()`

Never hand-write a key string. `store.key({ namespace, parts })` produces
`<KV_KEY_PREFIX><namespace>:<part>:<part>`, so two modules that both cache "user 7" cannot collide.

```ts
store.key({ namespace: "session", parts: [userId] }); // "session:u_42"
store.key({ namespace: "flags", parts: ["doc", tenantId] }); // "flags:doc:t_9"
```

Rules the core enforces, all as `KvError` with code `invalid_key`:

- A `:` inside a namespace or a part is refused, not escaped. Pass it as its own part.
- An empty namespace or part is refused.
- A built key over **512 bytes** is refused. The count is UTF-8 bytes, so an emoji costs four.
  Hash the long piece and put the hash in the key.

`KV_KEY_PREFIX` (empty by default) goes in front of everything, which lets a staging and a
production Worker share one namespace.

## The TTL floor, and why nothing rounds

Every provider declares `minTtlSeconds` — **60 on `kv-cloudflare`**, 1 on `kv-upstash` (Redis `EX` takes whole seconds), 0 on `kv-memory`. A `set` with
a shorter TTL throws `KvError("invalid_ttl")` naming the floor and the provider. It is never
rounded up, because the same call would then expire at a different time on a different provider
with nothing in the logs to say so.

```ts
await store.set(key, value, { ttlSeconds: 60 }); // fine everywhere
await store.set(key, value, { ttlSeconds: 5 }); // throws on kv-cloudflare, works on upstash and memory
```

Omit `ttlSeconds` for an entry that never expires.

## Cache-aside, and what it does not do

`store.cached(key, ttlSeconds, load)` reads, and on a miss runs `load`, writes and returns.

- **No stampede protection.** Two concurrent misses both run `load` and both write. A lock needs
  an atomic compare-and-set, which Workers KV does not have.
- **No stale-while-revalidate.** An expired entry is a plain miss.
- **A `null` from `load` is not written.** A cached `null` reads back the same as a miss, so the
  write would only spend quota. Model "known absent" as a value, such as `{ found: false }`.

On `kv-cloudflare` the 60 second TTL floor plus the 60 second propagation window means a value can
be up to two minutes behind in another location. Cache slow-changing data only. Do not cache-aside
a session, a balance, or anything a user expects to see change straight after their own write.

## Rate limit policies live here

A policy is a **name**, not a counter. `consume` takes the name and the core resolves it against
the table registered in `src/index.ts`:

```ts
const { success, remaining } = await store.consume({ policy: "strict", key: ip });
```

- An unregistered name throws `KvError("not_supported")` naming the registered policies.
- A provider with no `consume` throws `not_supported` naming the provider. Nothing is thrown at
  construction — Workers has no `env` at module scope.
- A refusal is `{ success: false }`, not a throw.
- `remaining` and `resetAt` are **optional**. Cloudflare's Rate Limiting binding returns
  `{ success }` and nothing else, so a caller must send `RateLimit-Remaining` only when the field
  is present rather than invent a number. `kv-upstash` and `kv-memory` both report them.
- **Only `kv-upstash` counts globally.** Cloudflare counts per colo, and `kv-memory` counts per
  isolate. A budget that has to be exact across every request — an API key quota, a paid tier's
  ceiling — needs `KV_PROVIDER=upstash`.

`saasaloy add ratelimit` registers `strict`, `default` and `loose` and ships the Hono middleware.
`kv-cloudflare` ships the matching `RL_STRICT`, `RL_DEFAULT` and `RL_LOOSE` bindings. Adding a fourth policy takes an edit in two places — see "Setting up `kv-cloudflare`" below.

## Errors

One error type, `KvError`, with six codes:

| Code | Raised when |
|---|---|
| `invalid_key` | Empty key, a `:` in a namespace or part, or over 512 bytes. |
| `invalid_ttl` | TTL below the provider's floor, or not a positive whole number. |
| `too_large` | The encoded value is over 25 MiB. Raised in the core, before any provider call. |
| `rate_limited` | The provider refused for its own quota — not a `consume` refusal. |
| `not_supported` | No `consume` on the provider, an unregistered policy, or an unstorable value. |
| `provider_error` | Everything else, with the raw failure in `cause` and the vendor code in `providerCode`. |

A missing key is **not** an error. The package never retries; `retryable` is the hook for a caller
to decide.

## Choosing the provider

`KV_PROVIDER` is required even when exactly one provider is installed, and an unknown value throws
at construction. There is no default in either direction: a fallback would let a production deploy
quietly read an empty in-process map, or a test run quietly write to the real namespace.

```jsonc
// .dev.vars
KV_PROVIDER = "memory"   // kv-memory, for local development and tests
```

`upstash` selects `kv-upstash`, which also needs its two secrets and a non-empty `KV_KEY_PREFIX`.

Swapping providers is the env var plus `saasaloy add kv-<provider>`. No call site changes.

## Setting up `kv-cloudflare`

`saasaloy add kv-cloudflare` writes four entries into `apps/api/wrangler.jsonc` and registers the provider. Two of them need a human afterwards.

**1. Create the namespace and paste its id.** The patch writes a placeholder, because the CLI cannot create a namespace for you.

```sh
wrangler kv namespace create app-kv
```

```jsonc
// apps/api/wrangler.jsonc
"kv_namespaces": [{ "binding": "KV", "id": "<replace-me>" }] // ← paste the id it printed
```

Leave `binding` as `KV` unless you pass a different name to `cloudflare({ binding })` in `packages/kv/src/index.ts`. The binding name is the credential; there is no API token and no secret for this provider.

**2. Check the `namespace_id` values on a busy account.** The three limiter entries ship as `"1001"`, `"1002"` and `"1003"`:

```jsonc
"ratelimits": [
  { "name": "RL_STRICT",  "namespace_id": "1001", "simple": { "limit": 10,   "period": 10 } },
  { "name": "RL_DEFAULT", "namespace_id": "1002", "simple": { "limit": 100,  "period": 60 } },
  { "name": "RL_LOOSE",   "namespace_id": "1003", "simple": { "limit": 1000, "period": 60 } }
]
```

Each `namespace_id` must be a unique positive integer **per Cloudflare account**. Cloudflare does not document what a collision does. If the account already runs limiters, change these three to numbers it does not use.

**3. Add a fourth policy in both places.** Write the `definePolicy` factory in `packages/kv/src/policies/ratelimit.ts` and add the call to the `policies` array in `packages/kv/src/index.ts`; the binding is what enforces it. Add both, and keep the name in step: policy `burst` needs binding `RL_BURST`.

```jsonc
{ "name": "RL_BURST", "namespace_id": "1004", "simple": { "limit": 5, "period": 10 } }
```

`period` is **10 or 60, nothing else**. The provider throws `not_supported` on any other value rather than letting `wrangler deploy` fail later.

**4. Know that the numbers can drift, and nothing checks them.** `wrangler.jsonc` holds the limits Cloudflare enforces. The `limit` and `periodSeconds` in `definePolicy` document the intent and drive the counting providers, and **editing them alone changes nothing on Cloudflare**. `saasaloy doctor` checks that every registered policy name has an `RL_<NAME>` binding; it never compares the numbers, because that would mean reading literal values out of a project's TypeScript.

**5. The limiter counts per location.** Cloudflare's Rate Limiting binding counts per colo, not globally, so a `limit` of 10 is 10 per colo and a distributed burst gets a multiple of it. Cloudflare calls the API "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system". Use it to blunt abuse. Never meter billing with it.

**6. The `infra` module does not translate these yet.** `modules/infra`'s `translate.ts` handles `d1_databases` and `vars` only, so `kv_namespaces` and `ratelimits` in `wrangler.jsonc` do not become Pulumi resources. Create the namespace with `wrangler` as above and keep the ids in `wrangler.jsonc` until that gap closes.

## Setting up `kv-upstash`

`saasaloy add kv-upstash` adds `@upstash/redis` to `packages/kv/package.json` and registers the provider. It writes nothing into `apps/api/wrangler.jsonc`, because an HTTP provider has no binding. Three things need a human.

**1. Create the database and copy its REST credentials.** Create a Redis database at <https://console.upstash.com>, open the REST API panel, and copy the URL and the **read-write** token. The read-only token cannot `SET`, `DEL`, or run the limiter's `EVAL`.

```sh
echo 'UPSTASH_REDIS_REST_URL=https://<name>-<id>.upstash.io' >> apps/api/.dev.vars
echo 'UPSTASH_REDIS_REST_TOKEN=<token>' >> apps/api/.dev.vars
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

The token is a secret. Never put it in `apps/api/wrangler.jsonc`; that file is committed.

**2. Set `KV_KEY_PREFIX`, which this provider requires.** One Redis database is one flat keyspace. Without a prefix, `list({})` scans every key in the database and hands back keys the project does not own, so an empty or unset value throws `provider_error` before any request leaves.

```jsonc
// apps/api/wrangler.jsonc
"vars": { "KV_PROVIDER": "upstash", "KV_KEY_PREFIX": "app:" }
```

The provider prepends the prefix to the `SCAN` glob and to every limiter bucket, and escapes the glob characters in both halves, so a key holding a `*` or a `[` matches itself and nothing else.

**3. Know the two size numbers disagree.** The core refuses a value over 25 MiB. Upstash caps one record at 1 MB on the free plan and 100 MB on paid, so a value can pass the core and still be refused. The provider maps that refusal to `too_large`, so a caller sees one code either way.

The limiter needs no setup. `consume` runs one Lua script holding `INCR`, `EXPIRE NX` and `PTTL`, atomically, against a bucket named `<KV_KEY_PREFIX>rl:<policy>:<key>`. It is a fixed window, the same shape `kv-memory` uses, and there is no 10-or-60 restriction on `periodSeconds` here — that rule is Cloudflare's binding alone.

## Limits worth knowing before you design around KV

Workers KV is **eventually consistent**: a write is visible at once in its own location and takes
up to 60 seconds elsewhere. One write per second to the same key, and concurrent writes to one key
overwrite each other. A key caps at 512 bytes and a value at 25 MiB. The Free plan allows 1,000
writes a day to distinct keys.

It is a cache and a config store, not a database. Anything that needs to be read back immediately
after a write, or counted exactly, belongs in `database` instead.

## Writing a provider

Follow `.agents/skills/create-provider/`. A provider is one file in `src/providers/` and one
`plugin-array` patch. It implements `name`, `minTtlSeconds`, `get`, `set`, `delete` and `list`, and
optionally `consume`. It stores strings only — the core does the JSON encoding, the size cap, the
key checks and the TTL floor, so none of that is re-implemented per vendor.

Map every vendor failure onto a `KvError` code, keep the raw code in `providerCode`, and set
`retryable` honestly. A caller's `catch` must only ever see one shape.
