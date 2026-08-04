# 0001 — All-in on Cloudflare

Saasaloy commits to Cloudflare (D1 + R2 + Workers) as the only target, so the multi-cloud adapter layer is cut entirely — no `core` capability interfaces, no per-provider adapter packages (`db-neon`, `store-s3`, `deploy-*`), and no `saasaloy migrate db`. The wedge is that Cloudflare's building blocks are mature but nobody assembles *and maintains* them; committing to one provider is what keeps the module surface small enough to keep current. See build-spec [§2.2](../plans/plan-saasaloy-build-spec-2026-07-21.md).

## Status
accepted (amended 2026-08-04 — see below)

## Considered Options
- Swappable multi-cloud adapters behind capability interfaces — cut: swappability serves other people's stacks, a product concern deferred with the personal-first scope.

## Consequences
- Two cheap habits are kept as conventions (not an adapter layer) to preserve a future exit: thread an `env`/`context` object for bindings instead of reading `process.env`, and keep a thin repository layer so raw SQL doesn't sprawl.
- Postgres is a later, explicit migration, never a config toggle.

## Amendment — 2026-08-04: stateless services may be multi-provider

The `email` capability ships a provider-agnostic core (`packages/email`) plus per-provider modules (`email-cloudflare`, `email-console`, and later `email-resend`). Read literally, that is "a core capability interface plus per-provider adapter packages" — the thing this ADR cut. It is allowed, and the boundary is narrowed rather than dropped:

- **Stateful infrastructure stays single-provider.** D1 vs Neon, R2 vs S3, Workers vs anything: swapping one is a data migration, and an adapter layer would paper over a difference that genuinely matters. This is what the original decision was aimed at, and it is unchanged.
- **Stateless third-party services may be multi-provider** when the capability owns the abstraction. An email send is an interchangeable endpoint with no migration and no data to move.

The forcing case: Cloudflare Email Sending needs a Workers **paid plan** plus a domain onboarded by hand through the dashboard, so a user may be genuinely unable to take the Cloudflare default — and local development needs a path that sends nothing at all. Single-provider here would mean "no email" for those users, not "email on Cloudflare".

Consequences of the amendment:

- Cloudflare stays the **default** provider for a capability that has one; alternates are opt-in modules a project installs deliberately.
- A provider is a `saasaloy:feature` module owned by its capability — one file plus a registration patch (see `.agents/skills/create-provider/`). It is not a second copy of the capability.
- The multi-provider surface stays inside the capability's workspace ([ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)); no consumer learns which provider is active.
- This does **not** reopen `saasaloy migrate db`, a `core` interfaces package, or per-provider *deploy* targets. Applying the amendment to a stateful capability requires a new ADR.

References: issue [#15](https://github.com/mimukit/saasaloy/issues/15), `docs/plans/plan-email-capability-module-2026-08-04.md`. Glossary: `CONTEXT.md` → "Provider module".
