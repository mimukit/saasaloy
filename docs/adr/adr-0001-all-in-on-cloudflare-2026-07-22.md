# 0001 — All-in on Cloudflare

Saasaloy commits to Cloudflare (D1 + R2 + Workers) as the only target, so the multi-cloud adapter layer is cut entirely — no `core` capability interfaces, no per-provider adapter packages (`db-neon`, `store-s3`, `deploy-*`), and no `saasaloy migrate db`. The wedge is that Cloudflare's building blocks are mature but nobody assembles *and maintains* them; committing to one provider is what keeps the module surface small enough to keep current. See build-spec [§2.2](../plans/plan-saasaloy-build-spec-2026-07-21.md).

## Status
accepted

## Considered Options
- Swappable multi-cloud adapters behind capability interfaces — cut: swappability serves other people's stacks, a product concern deferred with the personal-first scope.

## Consequences
- Two cheap habits are kept as conventions (not an adapter layer) to preserve a future exit: thread an `env`/`context` object for bindings instead of reading `process.env`, and keep a thin repository layer so raw SQL doesn't sprawl.
- Postgres is a later, explicit migration, never a config toggle.
