---
name: saasaloy-ratelimit
description: Runbook for the ratelimit module — per-route Hono middleware over the kv capability's consume contract, with named policies (strict, default, loose), a 429 carrying Retry-After, and a fail-open default. Use when rate limiting a route, choosing or adding a policy, changing a limit, reading a 429, debugging a limiter that lets everything through, or working out why the numbers in policies/ratelimit.ts do not match what Cloudflare enforces.
---

# ratelimit — per-route limits over the `kv` contract

`ratelimit` ships two files and no package:

| File | What it holds |
|---|---|
| `apps/api/src/middleware/ratelimit.ts` | the `rateLimit()` Hono middleware |
| `packages/kv/src/policies/ratelimit.ts` | the three policies, registered into `packages/kv`'s `policies` array |

It owns no provider. It calls `createKv(env).consume({ policy, key })`, so whichever provider `KV_PROVIDER` selects does the counting. Swapping `kv-cloudflare` for another counting provider swaps the limiter with it and changes no route.

## Limiting a route

Apply it per route. There is no app-wide switch, and installing the module rate-limits nothing until you write one of these:

```ts
import { Hono } from "hono";
import { rateLimit } from "../middleware/ratelimit";

export const session = new Hono()
  .post("/sign-in", rateLimit({ policy: "strict" }), (c) => c.json({ ok: true }, 200))
  .get("/me", rateLimit({ policy: "loose" }), (c) => c.json({ ok: true }, 200));
```

An app-wide `app.use(rateLimit(...))` is deliberately not patched in. It would spend a budget on every health check and every preflight, and the routes worth protecting are a short list a human should write out: sign-in, sign-up, password reset, anything that sends mail or money.

## The three policies

| Policy | Binding | `policies/ratelimit.ts` | `wrangler.jsonc` | For |
|---|---|---|---|---|
| `strict` | `RL_STRICT` | 10 per 10s | 10 per 10s | sign-in, sign-up, password reset |
| `default` | `RL_DEFAULT` | 100 per 60s | 100 per 60s | an authenticated write |
| `loose` | `RL_LOOSE` | 1000 per 60s | 1000 per 60s | a cheap read worth a ceiling |

Add a fourth by exporting another factory from `packages/kv/src/policies/ratelimit.ts`, appending its call to the `policies` array in `packages/kv/src/index.ts`, and adding a matching `RL_<NAME>` entry under `ratelimits` in `apps/api/wrangler.jsonc`. `saasaloy doctor .` fails when you do one and not the other.

## Three facts that decide how this behaves

### The numbers in `policies/ratelimit.ts` change nothing on Cloudflare

On `kv-cloudflare` the limit that applies is the one in `apps/api/wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "RL_STRICT", "namespace_id": "1001", "simple": { "limit": 10, "period": 10 } }
]
```

The Rate Limiting binding reads its `limit` and `period` from there and nothing else. Editing `limit: 10` to `limit: 3` in `policies/ratelimit.ts` changes what `kv-memory` counts, changes the number this middleware puts in `RateLimit-Limit`, and changes nothing at all about what Cloudflare enforces. **Change both, together.** `period` accepts `10` or `60` only.

`saasaloy doctor .` checks that every policy has an `RL_<NAME>` binding, by name. It does not compare the numbers: a project is entitled to run a tighter budget in dev than it deploys with, and a check that could not tell that apart from a mistake would be turned off within a week.

### Cloudflare counts per location, so the real limit is a multiple

The Rate Limiting binding counts inside one Cloudflare colo, not globally. A caller spread across `n` colos gets roughly `n × limit` per period, and a distributed attacker gets one budget per location it reaches. Set the number for what one location should tolerate, and treat the limiter as protection against a hot caller rather than as a global quota. When you need an exact global count, that is a different store (a Durable Object, or Upstash's `@upstash/ratelimit`) and a different provider.

The binding also returns `{ success }` and nothing else — no count, no reset time. So on `kv-cloudflare` a 429 carries `Retry-After` set to the policy's whole period, and `RateLimit-Limit` and `RateLimit-Remaining` are **not sent**. Sending them would mean inventing a number. `kv-memory` does report a count, so both headers appear in local dev and vanish on deploy; that difference is the platform's, not a bug.

### The limiter fails open

When `consume` itself fails — the binding errored, the provider timed out — the request is let through. A broken limiter that takes the whole API down with it is the worse outage. Flip a route that must not do that:

```ts
rateLimit({ policy: "strict", onError: "deny" });
```

Two failures are **not** covered by `onError` and always throw, whatever it says: a provider with no `consume` at all, and a policy name that is not registered. Both are install mistakes that every later request repeats, and swallowing them ships an app that looks rate limited and is not. They surface as a `KvError` with code `not_supported`, on the **first request through the route** — a Worker has no `env` at module scope, so there is nothing to check at construction.

## The key each request counts against

By default: policy name, the route's registered pattern, and `CF-Connecting-IP`.

```
ratelimit:strict:/auth/sign-in:203.0.113.7
```

The route pattern is in the key, so `POST /auth/sign-in` and `POST /auth/sign-up` are both `strict` and each get their own ten. It is the pattern (`/users/:id`), not the request path, so one caller cannot mint unlimited buckets by walking the id. A missing `CF-Connecting-IP` counts as one shared `unknown` bucket rather than an unlimited pass, which is why the limiter visibly works under `wrangler dev`.

Override it per route to bill something else, or to make two routes share one budget on purpose:

```ts
rateLimit({
  policy: "strict",
  key: (c) => `signin:${c.req.header("CF-Connecting-IP") ?? "unknown"}`,
});
```

## The 429

```json
{ "error": { "code": "rate_limited", "message": "Too many requests. Retry in 10 seconds." } }
```

It is api's standard error envelope, so a client parses one body for every failure. `Retry-After` is always present and always a whole number of seconds, never `0`. A provider that reports `resetAt` gives the real wait; one that does not gets the policy's period, which is the longest the caller could have to wait.

## When it lets everything through

Work down this list:

1. **No middleware on the route.** Installing `ratelimit` limits nothing by itself. Check the route registers `rateLimit({ policy })`.
2. **`KV_PROVIDER` points at a store that cannot count.** That throws `not_supported` rather than passing silently, so check the logs for it.
3. **The limiter is erroring and failing open.** The default swallows a provider failure. Set `onError: "deny"` on the route for one request and see whether the 429 appears.
4. **Every request is a different bucket.** A custom `key` built from something per-request — a request id, a timestamp — gives each call its own budget. The key must identify the *caller*, not the call.
5. **The count is per colo.** Ten requests from ten locations pass a limit of 10. Test from one client.
6. **`wrangler.jsonc` says something other than what you read.** The deployed number is there, not in `policies/ratelimit.ts`.

## Removing it

`saasaloy remove ratelimit` takes the three `definePolicy` calls back out of `packages/kv/src/index.ts` and deletes both files. It does **not** edit routes: a route still calling `rateLimit(...)` stops compiling, which is the visible failure. Delete the middleware calls first. The `RL_*` entries in `wrangler.jsonc` belong to `kv-cloudflare` and stay until that module is removed.
