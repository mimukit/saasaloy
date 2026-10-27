# 0057: A provider may depend on a capability and own a scheduled job

A provider module may add a **capability** dependency to its core's `package.json`, and it may own a scheduled job that reaches the Worker environment through a core port. [ADR 0045](0045-adr-billing-becomes-subscription-and-one-time-payments-get-a-payment-capability-2026-10-20.md) kept this idea from the withdrawn `0040-adr-a-provider-may-depend-on-a-capability-and-own-a-scheduled-job` on the unmerged PR #171 and asked for it under a new number. This record carries it over from `billing` to `payment`, for `payment-bkash` in issue [#215](https://github.com/mimukit/saasaloy/issues/215).

## Status

accepted

## Context

A provider module is one runtime file plus its registration (AGENTS.md). Every provider before `payment-bkash` fits inside a request: a route calls a contract method, the method calls the vendor, and the method answers.

bKash Tokenized Checkout breaks that shape on one point. Every call carries an `id_token` that lives 3600 seconds, and bKash's documentation says on both the grant page and the refresh page: "Do not call this API more than two times within an hour. If you exceed this limit, the API will return an error, and you will be blocked for one hour." It does not say which endpoint the limit governs.

So the token has to be minted on a schedule the deployment controls, not on demand. Two things follow, and neither had a precedent.

- **The token has to be stored where every isolate can read it.** That is the `kv` capability, so a provider file imports `@repo/kv`, and `packages/payment/package.json` gains a dependency it did not have.
- **The job that mints it needs `env`, and a job handler gets none.** A queue handler is called as `(payload, ctx)` (`packages/queue/src/provider.ts`). The payment core never reads `process.env` and holds no importable Workers env. A provider's credentials are keys the core must never learn.

`cacheAside` in `packages/kv` is not an answer. It has no stampede protection, and `kv-cloudflare` has a 60-second TTL floor and a 60-second propagation window, so an expiry under load is a miss storm, the exact call pattern the limit punishes.

## Decision

**1. A provider may patch a capability dependency into its core, never a vendor one.** `payment-bkash` adds `@repo/kv` at `workspace:*` to `packages/payment/package.json`. ADR 0020's boundary is unchanged: a capability owns its vendor packages and no other workspace imports them. `@repo/kv` is the project's own neutral core, and `KV_PROVIDER` picks the store behind it, so `packages/payment` still names no vendor.

A provider that patches a capability in declares it in `dependsOn` too, so `saasaloy add` installs it. The provider then refuses with `invalid_request` when the capability is installed but unconfigured, because `dependsOn` puts `kv` on disk and cannot set `KV_PROVIDER`.

**2. A provider may own a scheduled job, and it reaches `env` through a core port.** `packages/payment/src/provider-env.ts` exports `setPaymentProviderEnv(env)` and `paymentProviderEnv()`. `apps/api/src/payment-store.ts` calls the setter once at module load, next to its store registrations. The value is typed `PaymentEnv`, which is opaque, so the core carries the environment and reads nothing out of it. The reader throws when nothing has registered: answering `{}` would show a job every key unset and report a missing registration as a missing secret.

The job and its schedule export from the provider file and register through `packages/queue`'s `jobs` and `schedules` `plugin-array` slots. The job shape is declared structurally in the provider file, so `packages/payment` imports nothing from `@repo/queue`; the descriptor adds `@repo/payment` to `packages/queue/package.json`, the direction `billing` already uses. The module stays at one runtime file.

## Consequences

- `packages/payment` depends on `@repo/kv` in a project that installs `payment-bkash`, and on nothing extra otherwise. `saasaloy remove` takes the registrations back out; the two `package.json` dependencies stay, as every `package-json-dependency` patch does.
- A provider can hold state between requests without the core learning that it does. The state is the vendor's token, not payment data, and the core is still the only writer of the `payments` table.
- `paymentProviderEnv()` is a module-scope singleton in `packages/payment`, set from one file at module load, like the store resolver and runner beside it.
- A provider-owned job runs on every deploy that installed the provider, whether or not `PAYMENT_PROVIDER` lists it. The job checks its own keys and returns when they are unset.
- The two-calls-an-hour limit is a budget on the app key, so staging and production that share a key block each other. The module's skill says so; the code cannot enforce it.

## Alternatives rejected

- **Importing `env` from `cloudflare:workers` in the provider file.** It makes the provider Cloudflare-only, which is the one thing the provider shape exists to prevent.
- **`cacheAside` with a long TTL.** No stampede protection, and the `kv-cloudflare` floor and propagation window above.
- **A token minted per request and never stored.** One call per checkout passes the budget on the second sale of the hour.
- **Widening the queue handler signature to carry `env`.** A contract change to every job in `packages/queue` to serve one provider. The port is additive and local.
- **A `secrets` capability for provider keys.** Another core to swap and another env var to set, to answer what `createPayment(env)` already answers on every request path.
