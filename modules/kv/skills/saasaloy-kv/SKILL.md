---
name: saasaloy-kv
description: Runbook for the kv capability — a provider-agnostic key-value store in packages/kv with per-provider modules (kv-cloudflare, kv-memory). Use when caching a value from a route, building a namespaced key, choosing or switching KV_PROVIDER, hitting a TTL floor or a key-size error, registering a rate limit policy, or writing a custom kv provider.
---

# kv — provider-agnostic key-value storage from `packages/kv`

`packages/kv` (`@repo/kv`) is the capability core: a provider registry, a rate limit policy table,
namespaced key building, JSON serialization, and one normalized error type. It has **zero runtime
dependencies** and imports no vendor SDK and no Workers binding. Each provider ships as its own
module — `kv-cloudflare` (Workers KV plus the Rate Limiting binding) and `kv-memory` (an in-process
map for dev and tests) — dropping one file into `src/providers/` and registering itself in the
`providers` array in `src/index.ts`.

Callers import `@repo/kv`, call `createKv(env)`, and never learn which provider is active.

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

Every provider declares `minTtlSeconds` — **60 on `kv-cloudflare`**, 0 on `kv-memory`. A `set` with
a shorter TTL throws `KvError("invalid_ttl")` naming the floor and the provider. It is never
rounded up, because the same call would then expire at a different time on a different provider
with nothing in the logs to say so.

```ts
await store.set(key, value, { ttlSeconds: 60 }); // fine everywhere
await store.set(key, value, { ttlSeconds: 5 }); // throws on kv-cloudflare, works in memory
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
  is present rather than invent a number.

`saasaloy add ratelimit` registers `strict`, `default` and `loose` and ships the Hono middleware.
Add a fourth with `definePolicy` in `src/index.ts`.

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

Swapping providers is the env var plus `saasaloy add kv-<provider>`. No call site changes.

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
