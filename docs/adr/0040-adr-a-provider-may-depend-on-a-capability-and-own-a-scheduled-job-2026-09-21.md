# 0040 — A provider may depend on a capability and own a scheduled job

A provider module may add a **capability** dependency to its core's `package.json`, and it may own a scheduled job that reaches the Worker environment through a core port. Settled while planning `docs/plans/0063-plan-billing-bkash-merchant-provider-2026-09-21.md` for issue #157.

## Status
accepted.

## Context

A provider module is one runtime file plus its registration (AGENTS.md). Every provider written so far fits inside a request: a route calls a contract method, the method calls the vendor, the method answers. `billing-stripe` patches three npm packages into `packages/billing/package.json`; `billing-sslcommerz` patches nothing and reaches the gateway with `fetch`.

bKash's Tokenized Checkout breaks that shape on one point. Every call carries an `id_token` that lives 3600 seconds, and bKash's own documentation carries the sentence "Do not call this API more than two times within an hour. If you exceed this limit, the API will return an error, and you will be blocked for one hour" on both the grant page and the refresh page, without saying which endpoint it governs. `refresh-token-3` also states the refresh token's lifetime matches the `id_token`'s 3600 seconds, which contradicts the 28-day figure every community package assumes. Nothing public settles either question.

So the token has to be minted on a schedule the deployment controls, not on demand. Two things follow, and neither has a precedent.

**The token has to be stored somewhere every isolate can read.** That is the `kv` capability. A provider file importing `@repo/kv` means `packages/billing/package.json` gains a dependency it did not have.

**The thing that mints it needs `env`, and a job handler gets none.** A queue handler is called as `(payload, ctx)` (`packages/queue/src/provider.ts`), and the core never reads `process.env` and holds no importable Workers env of its own. `setBillingConfig` already solves exactly this for `BILLING_LOCKOUT_DAYS`, but it carries one parsed number the core knows the name of. A provider's credentials are keys the core must never learn.

`cacheAside` in `packages/kv` was the obvious answer and is unusable here. It has no stampede protection, and `kv-cloudflare` carries a 60-second TTL floor plus a 60-second propagation window, so an expiry under load is a miss storm — which is precisely the call pattern the two-per-hour limit punishes.

## Decision

Two claims, recorded together because the provider needs both.

**1. A provider may patch a capability dependency into its core, never a vendor one.** `billing-bkash-merchant` adds `@repo/kv` at `workspace:*` to `packages/billing/package.json`. The boundary ADR 0020 draws is unchanged and is the point of the distinction: a capability owns its vendor packages and no other workspace imports them. `@repo/kv` is not a vendor package. It is the project's own neutral core, and which store sits behind it is `KV_PROVIDER`'s business, so `packages/billing` still names no vendor and still swaps its KV store without touching a line.

A provider that patches a capability in declares it in `dependsOn` as well, so `saasaloy add` installs the capability rather than leaving an import that does not resolve. The provider factory then throws `invalid_request` when the capability is installed but unconfigured — `dependsOn` puts `kv` on disk and cannot make anyone set `KV_PROVIDER`.

**2. A provider may own a scheduled job, and it reaches `env` through a core port.** `packages/billing/src/config.ts` gains `setBillingProviderEnv(env)` and `billingProviderEnv()`. `apps/api/src/billing-store.ts` calls the setter once at module load, beside its existing `setBillingConfig` call. The value is typed `BillingEnv`, which is opaque by construction, so the core carries the environment and reads nothing out of it.

The job and its schedule export from the provider file itself and register through `packages/queue`'s existing `jobs` and `schedules` `plugin-array` slots. The module stays at one runtime file.

The reader throws when nothing has registered. Answering `{}` would show a job every key unset, and it would report a missing registration as a missing secret.

## Consequences

- `packages/billing` now depends on `@repo/kv` in any project that installs `billing-bkash-merchant`, and on nothing extra in a project that does not. `saasaloy remove` takes the patch back out.
- A provider can hold state between requests without the core learning that it does. That is new reach, and the guard on it is the same one every provider already lives under: the state is the vendor's, not the projection's, and the projection still has one writer (ADR 0034).
- `billingProviderEnv()` is a second module-scope singleton in `packages/billing`. It is set from one file, in one place, at module load, like the four registrations already there.
- A provider-owned job runs on every deploy of the project that installed the provider, whether or not `BILLING_PROVIDER` names it. The job reads its own keys and returns when they are unset, so an installed-but-unselected provider costs one KV read per tick.
- The two-per-hour limit is a **deployment-wide** budget, not a per-isolate one. Staging and production sharing one bKash app key share the budget and block each other. The module's skill states this; nothing in the code can enforce it.

## Alternatives rejected

- **Importing `env` from `cloudflare:workers` in the provider file.** It is the shortest path and it makes the provider Cloudflare-only, which is the one thing the capability shape exists to prevent.
- **`cacheAside` with a long TTL.** No stampede protection, a 60-second TTL floor and a 60-second propagation window on `kv-cloudflare`. An on-demand refresh under load is the miss storm the rate limit punishes.
- **A token minted per request and never stored.** One call per checkout, which exceeds the budget on the second sale of the hour.
- **Widening the queue handler signature to carry `env`.** A contract change in `packages/queue` affecting every job, to serve one provider. The port is additive and local.
- **A second capability, `secrets`, that a provider reads its keys from.** Another core to swap, another env var to set, and it answers the same question `createBilling(env)` already answers for every request path.
