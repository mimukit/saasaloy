# Plan — Module catalog: every module a SaaS needs from zero to production scale

> **Status: research report and priority list, not a build plan.** It widens the Phase-3 roadmap (`plan-phase-3-modules-2026-07-22.md`) into a full catalog, and it ranks the catalog. Each module still goes through `create-module` / `create-provider` at build time. Dates on sources are the dates the pages were read or published; all reads happened on 2026-09-07.

## Context

The registry holds these modules today: `api`, `database` (+ `database-d1`, `database-postgres`), `auth`, `admin`, `email` (+ `email-cloudflare`, `email-console`, `email-plunk`, `email-react`), `sms` (+ `sms-console`), `logger` (+ `logger-console`), `infra`, `teams`, `validators`, `waitlist`. Open tracker items already name `billing` (#14), `i18n` (#73), `logger-pino` (#70), idempotent email sends (#110) and module stacks (#58). The Phase-3 plan names eight more capabilities (`queue`, `storage`, `cron`, `kv`, `realtime`, `ai`, `observability`, `ratelimit`) and four features (`feedback`, `api-keys`, `file-uploads`, `usage-metering`), and parks a backlog (`notifications`, `referrals`, `audit-log`, `feature-flags`, `search`, `onboarding`, `support-chat`, `blog`, `analytics-dashboard`).

This report answers two questions. What is the complete set of modules a product needs between "landing page" and "enterprise customer on a multi-region deployment"? And in what order should the registry grow, given the dependency-leverage rule from Phase 3 and the Cloudflare-only constraint from ADR 0001?

## Method

Three kinds of sources, each read directly:

1. **What starter kits ship.** Supastarter (28 listed features), Makerkit (plugin list), Open SaaS (Wasp), Jumpstart Pro and Bullet Train (Rails), and the Better Auth plugin index (50+ plugins in eight categories). A feature that appears in four or more of these is "universal".
2. **What enterprise buyers ask for.** enterpriseready.io's twelve areas and the WorkOS 2026 checklist (SSO, SCIM, RBAC, audit logs, MFA, self-serve admin portal, bot detection, secrets/encryption, agent auth).
3. **What Cloudflare offers as a binding.** The Workers bindings page (AI, Analytics Engine, Assets, Browser Run, D1, Dispatcher, Durable Objects, Hyperdrive, Images, KV, Media Transformations, mTLS, Queues, R2, Rate Limiting, Secrets, Secrets Store, Service bindings, Stream, Vectorize), plus Workflows, Turnstile, Email Service, Cloudflare for SaaS, Zaraz, and Workers Traces (open beta, custom spans since June 2026).

Where the three agree, the module is high priority. Where only one source names it, the module is a candidate, not a commitment.

## Catalog

Type follows CONTEXT.md: **cap** = capability, **feat** = feature, **prov** = provider, **drv** = driver, **stack** = stack. `dependsOn` lists the hard prerequisites; optional integrations are in the scope column. Priority tiers are defined in the next section.

### 1. Runtime primitives (capabilities that other modules build on)

| Module | Type | dependsOn | Scope | Cloudflare / vendor | Tier |
|---|---|---|---|---|---|
| `queue` | cap | `api` | Producer helper, `consumers/` folder, `queue()` handler, dead-letter queue, batch/retry defaults. | Queues binding | P0 |
| `storage` | cap | `api` | R2 client, signed upload/download URLs, object metadata table, multipart helper. | R2 binding | P0 |
| `cron` | cap | `api` | `scheduled()` handler, `scheduled/` folder, per-job lock so two colos do not run one job. | Cron Triggers | P0 |
| `kv` | cap | `api` | Typed cache-aside helper, namespaced keys, TTL defaults. | KV binding | P0 |
| `ratelimit` | cap | `api` | Hono middleware, per-key and per-IP limits, 429 with `Retry-After`. | Rate Limiting binding (GA since 2025-09-19) | P0 |
| `observability` | cap | `api`, `logger` | Trace export destination, custom spans via `ctx.tracing`, error middleware, request ID propagation. | Workers Traces + Logs; Sentry / SigNoz / Honeycomb as providers | P0 |
| `observability-sentry` | prov | `observability` | OTLP destination config plus Sentry SDK for the web app. | Sentry | P1 |
| `workflows` | cap | `api` | Durable multi-step jobs with retries, sleeps and human approval steps. | Workflows binding | P1 |
| `realtime` | cap | `api` | Durable Object per room, WebSocket hibernation, presence helper, client hook. | Durable Objects | P1 |
| `ai` | cap | `api` | Typed inference helper, streaming responses, prompt files folder, cost log. | Workers AI + AI Gateway; Anthropic / OpenAI as providers | P1 |
| `ai-anthropic` / `ai-openai` | prov | `ai` | One provider file each behind the AI Gateway. | AI Gateway | P2 |
| `vectors` | cap | `ai`, `database` | Embedding pipeline, Vectorize index binding, nearest-neighbour query helper. | Vectorize | P2 |
| `secrets` | cap | `infra` | Account-level secrets bound to Workers, rotation runbook, per-environment separation. | Secrets Store (beta) | P2 |
| `cache` | cap | `kv` | HTTP cache rules, `Cache-Control` helpers, stale-while-revalidate helper, purge on write. | Cache API + KV | P2 |
| `images` | cap | `storage` | Upload, resize, format negotiation, signed variants. | Cloudflare Images / Media Transformations | P2 |
| `video` | cap | `storage` | Upload, encode, player embed, signed playback. | Stream | P3 |
| `browser` | cap | `api` | Headless Chrome for PDF export, screenshots, link previews. | Browser Run | P3 |
| `containers` | cap | `api` | Long-running or native-binary jobs next to Workers. | Containers | P3 |
| `database-hyperdrive` | drv-adjacent | `database-postgres` | Pooled connection to an external Postgres. Already partly covered by the postgres driver's `HYPERDRIVE` preference; a separate module only if the binding needs its own infra step. | Hyperdrive | P3 |

### 2. Identity and access

| Module | Type | dependsOn | Scope | Vendor | Tier |
|---|---|---|---|---|---|
| `mfa` | feat | `auth` | TOTP, backup codes, passkeys, "require MFA for admin role". | Better Auth `twoFactor`, `@better-auth/passkey` | P0 |
| `magic-link` | feat | `auth`, `email` | Passwordless sign-in and email OTP. | Better Auth `magicLink`, `emailOTP` | P1 |
| `social-login` | feat | `auth` | Google, GitHub, Microsoft, Apple with account linking. | Better Auth social providers | P1 |
| `api-keys` | feat | `auth`, `database` | Key issue, hash, scope, expiry, last-used, bearer middleware. | Better Auth `apiKey` | P0 |
| `rbac` | feat | `auth`, `teams` | Per-organization roles and permission statements, `can()` helper, admin UI for roles. | Better Auth organization access control | P0 |
| `audit-log` | feat | `database`, `queue` | Append-only event table, actor/target/IP, customer-visible export, retention policy. | own table; Analytics Engine for volume counters | P0 |
| `impersonation` | feat | `auth`, `admin` | Admin signs in as a user, banner, audit entry, time-boxed session. | Better Auth `admin` plugin | P1 |
| `sessions` | feat | `auth` | Device list, revoke, "sign out everywhere", multi-session switching. | Better Auth `multiSession` | P2 |
| `sso` | feat | `auth`, `teams` | SAML 2.0 and OIDC per organization, IdP-initiated login, domain capture. | `@better-auth/sso` | P1 |
| `scim` | feat | `sso` | Directory sync: provisioning, deprovisioning, group to role mapping. | Better Auth SCIM plugin | P2 |
| `oauth-provider` | feat | `auth` | Your app as an identity provider: client registration, consent screen, scopes. | `@better-auth/oauth-provider` | P2 |
| `mcp-auth` | feat | `oauth-provider` | OAuth 2.1 for Model Context Protocol clients, JWKS endpoint, resource-bound tokens. | `@better-auth/mcp` | P2 |
| `captcha` | feat | `auth` | Turnstile on sign-up, sign-in and public forms. | Turnstile, Better Auth `captcha` | P1 |
| `password-policy` | feat | `auth` | Breach check, strength rules, forced rotation after a leak. | Better Auth `haveIBeenPwned` | P2 |
| `zero-trust-admin` | feat | `admin`, `infra` | Cloudflare Access policy in front of `apps/admin`. | Cloudflare Access | P2 |

### 3. Monetisation

| Module | Type | dependsOn | Scope | Vendor | Tier |
|---|---|---|---|---|---|
| `billing` | feat | `auth`, `database`, `email` | Checkout, customer portal, webhook handler, subscription table, pricing block. Issue #14. | Stripe via `@better-auth/stripe` | P0 |
| `billing-stripe` / `billing-polar` / `billing-lemonsqueezy` / `billing-paddle` | prov | `billing` | One provider file each; Polar and Lemon Squeezy act as merchant of record for tax. | Stripe, Polar, Lemon Squeezy, Paddle | P0 (stripe), P2 (others) |
| `entitlements` | feat | `billing`, `kv` | Plan to feature map in your own table, `hasFeature()` and `limit()` helpers, cached per tenant. Stripe's entitlements are boolean only, so keep the source of truth local. | own table | P0 |
| `usage-metering` | feat | `database`, `queue` | Event producer, consumer that rolls counters, `usage` table, optional push to Stripe Meters. | Stripe Meters, OpenMeter as an alternative | P1 |
| `seats` | feat | `billing`, `teams` | Seat count follows members, proration, seat cap enforcement. | Stripe quantity items | P1 |
| `trials` | feat | `billing`, `cron` | Trial start, reminder emails, expiry job, grace period. | own | P1 |
| `dunning` | feat | `billing`, `cron`, `email` | Failed-payment retries, past-due state, lockout after N days. | Stripe Smart Retries + own emails | P1 |
| `coupons` | feat | `billing` | Promo codes, referral credit, admin coupon screen. | Stripe Coupons | P2 |
| `invoices` | feat | `billing` | Invoice list, PDF download, billing email and VAT ID on the customer. | Stripe Invoices | P2 |
| `tax` | feat | `billing` | Tax collection and ID validation. Not needed when the provider is merchant of record. | Stripe Tax | P2 |
| `one-time-purchase` | feat | `billing` | Lifetime deal and credit packs. | Stripe Checkout | P2 |
| `marketplace` | feat | `billing`, `teams` | Multi-vendor payouts and platform fee. | Stripe Connect | P3 |

### 4. Communication and engagement

| Module | Type | dependsOn | Scope | Vendor | Tier |
|---|---|---|---|---|---|
| `notifications` | feat | `database`, `queue`, `email` | In-app inbox, per-channel preferences, digest job, push to email/SMS/webhook. | own; Novel or Knock as optional providers | P0 |
| `email-resend` / `email-ses` / `email-postmark` | prov | `email` | One file each. Resend is the most-requested. | Resend, SES, Postmark | P1 (resend), P2 |
| `email-inbound` | feat | `email`, `queue` | Receive email into a Worker, parse, route to a handler (support tickets, reply-by-email). | Email Routing `email()` handler | P2 |
| `sms-twilio` / `sms-vonage` | prov | `sms` | One file each. | Twilio, Vonage | P1 (twilio) |
| `push` | cap | `api` | Web Push subscriptions and send helper. | VAPID; FCM/APNs as providers | P2 |
| `newsletter` | feat | `email`, `cron` | List, double opt-in, unsubscribe link, campaign send through the queue. | own or Plunk/Resend Broadcasts | P2 |
| `announcements` | feat | `database`, `admin` | "What's new" feed and unread badge in the app. | own | P2 |
| `changelog` | feat | `web` | Public changelog page from Markdown, RSS. | content collection | P2 |
| `support-chat` | feat | `realtime`, `admin` | Live chat widget, agent inbox in admin, offline to email. | own; Chatwoot / Crisp as external alternative | P3 |
| `chat-widget-external` | feat | `web` | Drop-in for Intercom, Crisp, Chatwoot. | vendor script via Zaraz | P3 |

### 5. Product surface features

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `feedback` | feat | `api`, `database` | Widget, table, admin list. Cheapest proof per Phase 3. | P0 |
| `file-uploads` | feat | `storage`, `auth` | Upload UI, signed URL, object record, per-tenant quota. | P0 |
| `onboarding` | feat | `auth`, `teams` | Multi-step setup, checklist, completion tracking, resume where left. | P1 |
| `settings` | feat | `auth` | Profile, avatar, email change with verify, delete account. Many kits bundle this into auth; here it is the first UI feature after auth. | P1 |
| `search` | feat | `database` | Full-text search on D1 FTS5 or Postgres `tsvector`, typed query helper, index job. | P1 |
| `feature-flags` | feat | `kv`, `admin` | Boolean and percentage flags, per-tenant overrides, admin toggle, typed `flag()` helper. | P1 |
| `roadmap` | feat | `database`, `auth` | Public roadmap with votes and comments. | P2 |
| `testimonials` | feat | `database`, `admin` | Submission form, approval, landing block. | P2 |
| `referrals` | feat | `billing`, `email` | Referral link, attribution, reward credit. | P2 |
| `affiliates` | feat | `referrals` | Partner accounts, payout ledger. | P3 |
| `surveys-nps` | feat | `database` | NPS prompt, response table, admin chart. | P2 |
| `data-export` | feat | `storage`, `queue` | Tenant-level export to CSV/JSON, signed download, GDPR portability. | P1 |
| `import` | feat | `storage`, `queue`, `validators` | CSV upload, mapping, validation report, batch insert. | P2 |
| `comments` | feat | `database`, `auth` | Threaded comments on any entity, mentions, notification hook. | P3 |
| `activity-feed` | feat | `audit-log` | Per-tenant human-readable feed built from audit events. | P3 |
| `kanban` | feat | `database` | Reusable board component; Makerkit's roadmap depends on it. | P3 |

### 6. Developer platform

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `openapi` | feat | `api`, `validators` | Generate the spec from Hono routes and Zod, serve reference docs. | P1 |
| `webhooks-out` | feat | `queue`, `database`, `api-keys` | Endpoint registry per tenant, HMAC signing per the Standard Webhooks spec, retries with backoff, dead-letter, delivery log UI. | P1 |
| `webhooks-in` | feat | `queue` | Verified receivers for Stripe, GitHub and generic HMAC, idempotency table. Billing needs the Stripe half now. | P1 |
| `sdk` | feat | `openapi` | Generated TypeScript client package from the spec. | P3 |
| `cli-tool` | feat | `api-keys` | A user-facing CLI scaffold that talks to the public API. | P3 |
| `zapier` | feat | `webhooks-out`, `oauth-provider` | Zapier/Make integration scaffold. | P3 |
| `mcp-server` | feat | `mcp-auth`, `api` | Expose product actions as MCP tools. | P2 |

### 7. Operations and reliability

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `health` | feat | `api` | `/healthz` and `/readyz`, dependency checks, version stamp. | P0 |
| `uptime` | feat | `health`, `infra` | External monitor plus alert channel. | P1 |
| `status-page` | feat | `web`, `uptime` | Public status page and incident posts. Cloudflare has no native product here; Astro page fed by a KV document or an external (Instatus, Betterstack). | P2 |
| `alerting` | feat | `observability` | Error and latency alerts to Slack/email/PagerDuty. | P1 |
| `analytics` | cap | `web` | Server-side event helper plus a client that respects consent. | P1 |
| `analytics-posthog` / `analytics-plausible` / `analytics-umami` / `analytics-ga` | prov | `analytics` | One provider file each; ship through Zaraz when the vendor is a script. | P1 (posthog), P2 |
| `product-metrics` | feat | `analytics`, `admin` | MRR, churn, activation, DAU in the admin app, read from the billing and audit tables. | P2 |
| `backups` | feat | `database`, `cron`, `storage` | D1 Time Travel notes for the D1 driver; scheduled logical dump to R2 for Postgres; tested restore runbook. | P1 |
| `maintenance-mode` | feat | `kv`, `api` | Read-only or offline flag, bypass for admins, custom page. | P2 |
| `kill-switches` | feat | `feature-flags` | Per-integration circuit breakers (payments, AI, email). | P2 |
| `job-dashboard` | feat | `queue`, `cron`, `admin` | Queue depth, failed jobs, retry from admin. | P2 |
| `cost-monitoring` | feat | `analytics`, `admin` | Per-tenant usage of Workers, D1, R2 and AI to spot expensive tenants. | P3 |
| `error-pages` | in base | | Already shipped (#118). | done |
| `preview-environments` | infra | `infra` | Per-PR Workers preview URL and D1 preview database. | P2 |
| `multi-region` | infra | `infra`, `database` | Smart Placement, read replicas for D1, region hints for Durable Objects. | P3 |

### 8. Security and compliance

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `security-headers` | feat | `api`, `web` | CSP with nonces, HSTS, frame and referrer policies, CORS allow-list. | P0 |
| `waf` | infra | `infra` | Managed rules, bot fight mode, API Shield schema validation. | P1 |
| `cookie-consent` | feat | `web`, `analytics` | Consent banner, purpose gating, consent record. | P1 |
| `legal-pages` | feat | `web` | Terms, privacy, DPA templates as content, version and acceptance record. | P1 |
| `gdpr` | feat | `data-export`, `queue`, `audit-log` | DSAR intake, export bundle, right-to-erasure job that fans out across tables and R2, retention sweeps. | P1 |
| `encryption` | feat | `database`, `secrets` | Field-level encryption with per-tenant keys. | P2 |
| `dependency-audit` | tooling | | Already partly covered by the lint and hook toolchain (ADR 0023). Add `pnpm audit` and a SBOM step to CI. | P2 |
| `soc2-evidence` | docs | `audit-log`, `rbac` | Control mapping doc and evidence export, not a runtime module. | P3 |

### 9. Multi-tenancy and platform

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `tenant-scoping` | feat | `teams`, `database` | Organization-scoped repository helpers, row-level tenant column, middleware that resolves the active organization. This is the base every B2B feature above assumes; today `teams` gives the tables but not the query guard. | P0 |
| `custom-domains` | feat | `teams`, `infra` | Customer hostnames, TXT verification, automatic certificates, hostname to tenant lookup. | P2 (Cloudflare for SaaS) |
| `white-label` | feat | `custom-domains` | Per-tenant logo, colours, email sender. | P3 |
| `tenant-isolation-do` | drv | `database` | One Durable Object with SQLite per tenant instead of a shared table. Mutually exclusive with row scoping. | P3 |
| `workers-for-platforms` | cap | `infra` | Dispatch namespace for customer-supplied code. | P3 |

### 10. Content and growth surfaces

| Module | Type | dependsOn | Scope | Tier |
|---|---|---|---|---|
| `blog` | feat | `web` | Content collection, MDX, authors, RSS, OG images. | P1 |
| `docs-site` | feat | `web` | Starlight app under `apps/docs`, search, versioning. | P1 |
| `seo` | feat | `web` | Sitemap, robots, canonical, JSON-LD, OG image generation. | P1 |
| `i18n` | cap | `web` | Locale routing, message catalogs, translatable emails. Issue #73. | P1 |
| `cms-external` | prov | `blog` | Pull from Keystatic, Payload or a headless CMS. | P3 |
| `ab-testing` | feat | `feature-flags`, `analytics` | Variant assignment, exposure events, results view. | P3 |
| `landing-variants` | feat | `web` | Multiple landing pages per campaign, UTM capture. | P3 |

### 11. Stacks (issue #58)

| Stack | Members |
|---|---|
| `waitlist-landing` | `api`, `database`, `waitlist` |
| `solo-saas` | `auth`, `admin`, `billing`, `entitlements`, `settings`, `notifications`, `observability` |
| `b2b-saas` | `solo-saas` + `teams`, `tenant-scoping`, `rbac`, `audit-log`, `api-keys`, `webhooks-out` |
| `enterprise` | `b2b-saas` + `sso`, `scim`, `mfa`, `gdpr`, `custom-domains`, `data-export` |
| `ai-product` | `b2b-saas` + `ai`, `vectors`, `usage-metering`, `workflows` |

## Priority list

The ranking uses three inputs. Dependency leverage first, as Phase 3 settled. Then how many starter kits ship the feature, because that is the market's definition of "table stakes". Then whether Cloudflare gives it to us as a binding, because a binding module is cheap to author and rot-resistant.

### P0: build next, in this order

1. `queue` — unblocks eleven modules in this catalog. Nothing else comes close.
2. `feedback` — cheapest proof that the machinery still holds after the admin and driver work.
3. `billing` (Stripe) + `webhooks-in` — issue #14 is open, and every monetisation feature waits on it.
4. `entitlements` — billing without a plan-to-feature map is a payment form, not a product.
5. `storage` + `file-uploads` — second-highest fan-out; proves capability to feature chain.
6. `cron` — cheap, and `trials`, `dunning`, `backups`, `newsletter` all wait on it.
7. `kv` + `feature-flags` — cheap binding, and flags are the first thing a team wants once they deploy weekly.
8. `ratelimit` — a GA binding and a one-file middleware. Every public API needs it before launch.
9. `observability` — Workers Traces is in open beta with custom spans, so the module is a destination config plus middleware. Do it before `notifications`, because debugging a queue consumer without traces costs more than the module does.
10. `tenant-scoping` + `rbac` — `teams` shipped the tables; B2B features need the guard and the roles before they are safe to write.
11. `api-keys` — proves auth on a non-cookie path; needed by `webhooks-out` and `sdk`.
12. `audit-log` — the enterprise ask that every checklist puts second after RBAC, and cheap once `queue` exists.
13. `mfa` — one Better Auth plugin, and enterprise buyers require it for admin roles.
14. `notifications` — universal in kits; needs `queue`, `email`, and a table.
15. `security-headers` + `health` — an afternoon each, and both are on every production checklist.

### P1: before the first enterprise or scaling customer

`workflows`, `realtime`, `ai`, `usage-metering`, `seats`, `trials`, `dunning`, `sso`, `magic-link`, `social-login`, `captcha`, `impersonation`, `onboarding`, `settings`, `search`, `data-export`, `openapi`, `webhooks-out`, `uptime`, `alerting`, `analytics` (+posthog), `backups`, `waf`, `cookie-consent`, `legal-pages`, `gdpr`, `blog`, `docs-site`, `seo`, `i18n`, `email-resend`, `sms-twilio`, `observability-sentry`.

### P2: when a customer asks

`scim`, `oauth-provider`, `mcp-auth`, `mcp-server`, `sessions`, `password-policy`, `zero-trust-admin`, `coupons`, `invoices`, `tax`, `one-time-purchase`, `email-inbound`, `push`, `newsletter`, `announcements`, `changelog`, `roadmap`, `testimonials`, `referrals`, `surveys-nps`, `import`, `status-page`, `product-metrics`, `maintenance-mode`, `kill-switches`, `job-dashboard`, `preview-environments`, `encryption`, `dependency-audit`, `custom-domains`, `vectors`, `secrets`, `cache`, `images`, other billing and analytics providers.

### P3: niche or a different product

`video`, `browser`, `containers`, `marketplace`, `support-chat`, `affiliates`, `comments`, `activity-feed`, `kanban`, `sdk`, `cli-tool`, `zapier`, `cost-monitoring`, `multi-region`, `soc2-evidence`, `white-label`, `tenant-isolation-do`, `workers-for-platforms`, `cms-external`, `ab-testing`, `landing-variants`.

## Things that are not modules

- **Testing (E2E, Playwright).** Belongs in the base toolchain like the linter (ADR 0023), not in the registry.
- **Dark mode and theme presets.** Shipped in the base (#64).
- **CI/CD and deploy.** `infra` owns it; per-PR previews are an `infra` option, not a feature module.
- **SOC 2, HIPAA, ISO evidence.** Documents and a vendor (Vanta, Drata), not code. The `audit-log`, `rbac`, `mfa` and `backups` modules produce the evidence.
- **Docs for the module itself.** Every module ships its skill; the catalog does not list skills as modules.

## Decisions this report proposes

| Decision | Recommendation |
|---|---|
| Split `billing` into core + providers from day one | Yes. Supastarter ships five payment providers and Better Auth has plugins for Stripe, Polar, Dodo and Autumn. The email trio already proved the shape. |
| `entitlements` as its own module, not a `billing` file | Yes. Free plans need entitlements with no billing installed, and Stripe's own entitlements are boolean only. |
| `tenant-scoping` as its own module, not a `teams` patch | Yes. It changes the repository layer in `packages/db`, which `teams` does not own. |
| `observability` before `notifications` | Yes. Same reason ADR 0023 put `logger` under `api`. |
| `workflows` next to `queue`, not instead of it | Yes. Queues are fan-out and buffering; Workflows are ordered multi-step with sleeps. Different consumers. |
| Skip `status-page` as own code | Lean towards an external provider plus a thin embed until an Astro page over KV proves cheaper. |

## Open questions

- **Convention seam for `queue`, `cron`, `workflows`.** Phase 3 deferred this. ADR 0028 replaced the routes glob with a registration table; the same argument applies to `consumers/` and `scheduled/`. Recommend a chained table from the start.
- **Where does `tenant-scoping` put the guard?** In `packages/db` repositories (every query scoped) or in an `api` middleware (context carries the org)? Recommend both: middleware resolves, repositories require.
- **Analytics Engine as the default `analytics` provider?** It is a binding and free at low volume, but it has no UI. Decide whether the admin app queries it via SQL API or whether PostHog is the default.
- **How far does `gdpr` fan out?** Erasure must cover every module's tables and R2 objects. A module-declared `erase(userId)` hook in each descriptor is the clean answer and a descriptor-format change.

## Sources

- Cloudflare developer platform product list, read 2026-09-07: https://developers.cloudflare.com/products/
- Cloudflare Workers bindings index, read 2026-09-07: https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Rate Limiting in Workers GA, 2025-09-19: https://developers.cloudflare.com/changelog/2025-09-19-ratelimit-workers-ga/
- Workers automatic tracing open beta and custom spans, 2026-06-16: https://developers.cloudflare.com/changelog/post/2026-06-16-custom-spans/
- Sentry destination for Workers Observability: https://docs.sentry.io/product/drains/integration/cloudflare/
- Cloudflare Workflows overview: https://developers.cloudflare.com/workflows/
- Cloudflare for SaaS and the SaaS use case guide, updated 2026-04: https://developers.cloudflare.com/use-cases/saas/
- Secrets Store changelog (Wrangler config shape, 2026-09-03 compat date): https://developers.cloudflare.com/changelog/product/secrets-store/
- Better Auth plugin index (50+ plugins, eight categories): https://better-auth.com/docs/plugins
- Better Auth 1.5 and 1.7 release notes (Stripe stable, SSO/MCP/OAuth provider packages): https://better-auth.com/blog/1-5 and https://better-auth.com/blog/1-7
- Supastarter feature list, read 2026-09-07: https://supastarter.dev/
- Makerkit plugins and CLI v2, 2026-02: https://makerkit.dev/docs/next-supabase-turbo/plugins and https://makerkit.dev/blog/changelog/introducing-makerkit-cli-v2
- Open SaaS (Wasp) features: https://docs.opensaas.sh/
- Jumpstart Pro docs navigation: https://jumpstartrails.com/docs
- Bullet Train docs navigation: https://bullettrain.co/docs
- enterpriseready.io feature areas: https://www.enterpriseready.io/
- WorkOS, "The 10 enterprise features every B2B SaaS needs", 2026-05-06: https://workos.com/blog/enterprise-readiness-checklist-2026
- Hashorn, RBAC then audit logs then SSO then SCIM ordering: https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs
- Stripe Meters and Entitlements limits (buildmvpfast 2026, Stigg, Stripe API reference): https://www.buildmvpfast.com/blog/stripe-metered-billing-implementation-guide-saas-2026 and https://docs.stripe.com/api/entitlements/feature
- OpenMeter and Lago: https://openmeter.io/ and https://getlago.com/
- Svix open-source webhook tools comparison, 2026-05, and the Standard Webhooks signing scheme: https://www.svix.com/webhooks/best-open-source-webhook-tools/
- Polar vs Stripe (Makerkit, 2026-05): https://makerkit.dev/blog/saas/polar-vs-stripe
