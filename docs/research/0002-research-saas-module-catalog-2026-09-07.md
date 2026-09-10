# Saasaloy module catalog

Research date is 2026-09-07. The repository reference for the inventory is commit `d19f63e`.

## Read this report

Start with the recommendation and existing gaps. Use the catalog to select features. Use the build sequence after choosing a product.

| Find | Sections |
|---|---|
| Current state | [Existing modules](#what-already-exists), [catalog labels](#how-to-read-the-catalog) |
| Customer and revenue | [Access and tenants](#customer-access-and-tenant-security), [billing](#revenue-and-access-to-paid-features) |
| Application services | [Background work](#background-work-and-reliable-events), [files and data](#files-data-access-and-live-updates), [product records](#product-data-and-everyday-actions) |
| Customer communication | [Communication and support](#communication-adoption-and-support) |
| Production | [Operations and security](#production-operations-and-security) |
| Optional expansion | [Enterprise and AI](#enterprise-integrations-and-specialized-products), [industry features](#industry-specific-module-candidates), [providers](#provider-and-driver-expansion) |
| Avoid duplicate work | [Overlapping names](#overlapping-names-and-ownership), [module boundaries](#module-boundaries-to-preserve) |
| Select the next work | [Build sequence](#recommended-sequence), [product selections](#suggested-product-selections), [production requirements](#requirements-for-a-production-module) |
| Research context | [Open decisions](#open-questions-for-planning), [approaches compared](#options-compared), [scope and sources](#scope-and-method) |

## Recommendation

Build the customer account flow first. Add tenant permissions and reliable paid access. Ship production controls with those features.

After the existing foundation gaps, I would build `queue` as the next reusable capability. I would complete `billing` and `entitlements` as the next business feature.

Keep Cloudflare as the deployment target and preserve the existing database driver choice. Extend existing modules when they already own the behavior.

This catalog includes common SaaS modules, optional product features, and operating practices. It is a selection guide, not a requirement to build every entry. No finite list covers every industry.

All candidate names and boundaries are proposals. Citations support service behavior and engineering requirements. New brainstorm entries describe possible scope; they do not claim verified implementation or vendor compatibility.

## What already exists

The registry contains 20 module descriptors. This count excludes the base template. A descriptor proves that the module exists in this checkout; it does not prove production readiness.

| Existing modules | Current responsibility | Work to consider |
|---|---|---|
| `api` | Hono API, typed client contract, health route, error handling, request logging | Public API contracts, abuse controls, and dependency health checks |
| `database`, `database-d1`, `database-postgres` | Database package with one required driver | Recovery procedures, compatible feature schemas, and safe migrations |
| `auth` | Better Auth, password login, sessions, site administrator role | Customer account screens, recovery email, stronger authentication, and controlled administrator setup |
| `admin` | Application for site administrators | Operations screens for each new feature |
| `teams` | Organizations, membership, active organization, and invitations through copied IDs | Customer team screens, invitation email, and Postgres support |
| `validators` | Shared Zod request schemas | Feature schemas as modules arrive |
| `email`, `email-console`, `email-cloudflare`, `email-plunk`, `email-react` | Email abstraction, three providers, and React templates | Delivery events, suppression handling, and queued delivery |
| `sms`, `sms-console` | SMS abstraction and local output | A production SMS provider when a product requires SMS |
| `logger`, `logger-console` | Logging abstraction and console output | Metrics, tracing, error reporting, and alerts |
| `infra` | Pulumi deployment with a limited configuration translator | Support for new resources, assets, environments, and deployment recovery |
| `waitlist` | Signup collection | Optional feedback and launch communication |

The [registry overview](../../modules/README.md) and [glossary](../../CONTEXT.md) define the existing module types. The base already supplies Astro, shared UI, and marketing blocks.

### Gaps that affect the build order

1. `billing` has no descriptor. References to billing in older plans do not mean it exists.
2. `teams` explicitly depends on `database-d1`. Postgres support needs work before teams can form a database-neutral foundation.
3. `admin` restricts access to site administrators. Normal customers need their own application routes and account screens.
4. `auth` disables email verification and automatically promotes the first signup to administrator. Production setup needs an explicit ownership procedure.
5. The teams plugin leaves invitation email unset. The customer acceptance flow needs separate work.
6. `infra` accepts only `d1_databases` and `vars` beyond its listed base keys. New Cloudflare bindings require translator changes.

Evidence appears in [the teams descriptor](../../modules/teams/registry-item.json), [the admin route guard](../../modules/admin/files/src/routes/__root.tsx), [auth configuration](../../modules/auth/files/src/auth.ts), [the teams plugin](../../modules/teams/files/auth/plugins/organization.ts), and [the infrastructure translator](../../modules/infra/files/src/translate.ts).

The [Phase 3 plan](../plans/0002-plan-phase-3-modules-2026-07-22.md) remains useful as an earlier proposal. Its empty-registry assumption and several extension conventions no longer match the code. Its exclusion of Postgres also predates the existing driver.

## How to read the catalog

The catalog contains 166 entries, plus provider expansion candidates. Entries include module proposals, extensions, and operating practices. They do not represent 166 modules to implement.

Only the inventory under "What already exists" describes modules present in the registry. Every later catalog entry describes proposed work, including extensions to existing modules.

| When | Meaning |
|---|---|
| Launch | Include before production when the row's use case applies |
| Growth | Add when repeated demand or measured load justifies it |
| Optional | Add for a defined product or customer requirement |

The form appears beside each candidate name. A capability owns a reusable package or application. A feature adds behavior to existing capabilities. An extension changes an existing module.

An integration connects an external service. A practice uses configuration, tests, or operating procedures. Build tooling runs during development or delivery. These labels do not add new registry descriptor types.

"Needs" lists conceptual prerequisites, including existing and proposed work. It does not define a final `dependsOn` array.

Some needs apply earlier than the word "Growth" suggests. For example, an upload product needs storage at launch, and usage pricing needs metering before its first charge.

## Customer access and tenant security

Treat a tenant as the customer boundary for data and resource access. Saasaloy calls an organization a team. A logged-in user can belong to several teams.

Authentication alone does not establish tenant isolation. Every data access needs the correct tenant context and authorization. This applies to background jobs and stored files too. [AWS SaaS tenant isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html).

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `app` (capability) | Launch | Customer application with protected routes, navigation, and loading states | `api`, `auth`, base UI |
| `account` (feature) | Launch | Profile, account settings, password changes, and session revocation | `app`, `auth` |
| `auth-email` (feature) | Launch for password accounts | Email verification and password recovery with expiring tokens | `auth`, `email` |
| Administrator setup (extension) | Launch | Explicit initial administrator ownership without public signup timing | `auth` |
| `onboarding` (feature) | Launch | First-use steps, completion state, and initial customer setup | `app`, `auth` |
| Customer teams (extension) | Launch for team products | Team settings, customer membership screens, invitation delivery, and acceptance | `teams`, `app`, `email` |
| `tenancy` (feature initially) | Launch for shared customer data | Resolve tenant context and enforce data ownership across requests and jobs | `auth`, `database`; `teams` for organizations |
| `permissions` (feature) | Launch | Server-side resource and action checks with explicit deny behavior | `auth`, tenant context |
| `auth-mfa` (feature) | Launch for privileged accounts | Second factor, recovery codes, and checks before sensitive actions | `auth`, `account` |
| `auth-social` (feature) | Optional | Selected social login services and explicit account linking rules | `auth` |
| `auth-passkeys` (feature) | Optional | Register, use, and revoke passkeys | `auth`, `account` |
| `auth-magic-link` (feature) | Optional | Passwordless email login with replay protection | `auth`, `email` |
| `api-keys` (feature) | Launch for API products | Hashed credentials with scopes, expiration, revocation, and usage attribution | `auth`, `database`, `permissions` |
| `service-accounts` (feature) | Optional | Machine identities with separate ownership and permissions | `api-keys`, tenant context |
| `sso` (feature) | Optional enterprise | Organization login policy through OIDC or SAML | `auth`, `teams` |
| `scim` (feature) | Optional enterprise | Customer-managed account provisioning and deprovisioning | `teams`, `permissions`, `audit-log` |
| Guest access (extension) | Optional | Time-limited access to selected resources without full team membership | `permissions`, resource owner |
| Account linking and recovery (extension) | Launch for multiple login methods | Verified identity linking, recovery checks, and account merge policy | `auth`, `account`, `audit-log` |
| Team lifecycle (extension) | Launch for team products | Ownership transfer, suspension, and team deletion with retained-data rules | `teams`, `permissions`, `retention` |

Reuse Better Auth's organization and SSO mechanisms where they meet the requirement. Avoid creating a second membership model. Current SSO documentation covers OIDC and SAML. [Better Auth organizations](https://better-auth.com/docs/plugins/organization), [Better Auth SSO](https://better-auth.com/docs/plugins/sso).

Keep `tenancy` and `permissions` small initially. They may remain shared auth conventions until multiple features require a separate package. A frontend route guard never replaces server authorization.

## Revenue and access to paid features

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `billing` (feature) | Launch for paid SaaS | Customer mapping, checkout, subscriptions, cancellation, and billing portal | `auth`, `database`, webhook receipt |
| `entitlements` (feature) | Launch for paid SaaS | Decide which features a customer can use from plans and explicit overrides | Customer identity, `database`; billing integration |
| `usage-metering` (feature) | Launch for usage pricing | Durable usage events, deduplication, rollups, and provider reconciliation | `database`, `queue` |
| `quotas` (feature) | Launch for limited resources | Enforce limits with atomic reservations and refunds where needed | `entitlements`, consistent counter storage |
| `credits` (feature) | Optional | Purchased credits, grants, expiration policy, and a transaction ledger | `billing`, `database`, `quotas` |
| Seat billing (extension) | Launch for seat pricing | Define billable members and reconcile membership with subscription quantity | `billing`, `teams` |
| Payment recovery (extension) | Launch for subscriptions | Payment failure states, retry policy, grace periods, and notices | `billing`, `email` |
| Pricing administration (extension) | Growth | Plan versions, trials, coupons, and controlled migrations | `billing`, `admin` |
| Tax and invoices (integration) | Launch where required | Provider configuration, invoice access, and customer tax details | `billing` |
| `marketplace-payments` (feature) | Optional marketplace | Connected sellers, payment allocation, and payout state | Payment platform integration |
| Refunds and disputes (extension) | Launch for applicable payments | Track refunds and disputes, then reconcile access and credit adjustments | `billing`, `audit-log` |
| Billing reconciliation (extension) | Launch for paid SaaS | Compare local subscription state with provider records and repair differences | `billing`, `cron`, job operations |
| Customer usage view (extension) | Launch for usage pricing | Show recorded usage, remaining allowance, and estimated charges with freshness labels | `app`, `usage-metering`, `quotas` |
| Purchase orders and contract billing (extension) | Optional enterprise | Record negotiated terms, purchase references, and manual invoicing approvals | `billing`, `admin`, `audit-log` |

Stripe documents subscription changes through webhooks and maps product features to entitlements. I recommend a local access decision that records the relevant billing state. It should not require a payment-provider request for every product request. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Stripe entitlements](https://docs.stripe.com/billing/entitlements?dashboard-or-api=api).

Stripe processes meter events asynchronously. Therefore, billing totals cannot enforce an immediate spending limit. Use a separate quota mechanism for that decision. [Stripe usage recording](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api).

Start with one billing integration. Preserve billing ownership and webhook behavior before considering another payment platform. Subscription migrations involve persisted customer state, so billing does not fit the existing stateless provider convention automatically.

Tax scope depends on the seller, customer locations, and payment arrangement. This report proposes integration points, not jurisdiction-specific tax rules.

## Background work and reliable events

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `queue` (capability) | Launch for background work | Typed jobs, retries, dead-letter handling, and operator replay | Worker handlers, `infra` support |
| `cron` (capability) | Launch for recurring tasks | Named schedules, overlap policy, and failure visibility | Worker scheduled handler, `infra` support |
| `workflows` (capability) | Growth | Persist multi-step processes with waits, retries, and cancellation policy | Cloudflare Workflows, `infra` support |
| `webhooks-inbound` (feature) | Launch for external events | Verify signatures, persist receipts, deduplicate, and process asynchronously | `api`, `database`, `queue` |
| `webhooks-outbound` (feature) | Growth for integrations | Customer endpoints, signed events, retries, delivery history, and secret rotation | `queue`, `database`, `permissions` |
| `outbox` (feature) | Launch when event loss changes business state | Commit a domain change and its pending event together | `database`, `queue`, dispatch schedule |
| Request idempotency (extension) | Launch for retryable writes | Store operation keys and replay results without duplicate effects | `api`, `database` |
| Job operations (extension) | Growth | Job status, failed jobs, controlled replay, and cancellation where supported | `queue`, `admin`, `observability` |
| `event-contracts` (feature) | Growth | Version event payloads and define producer and consumer compatibility | `validators`, `queue` |
| `concurrency-control` (capability when reused) | Growth | Coordinate resource ownership with atomic claims and bounded leases | Consistent storage, tenant context |
| External service resilience (extension) | Launch for critical dependencies | Bound timeouts and retries; prevent failed services from exhausting capacity | Owning capability, `observability` |

Cloudflare Queues provides at-least-once delivery. A handler must tolerate duplicate messages. A queue does not make a database write and message publication atomic. The proposed outbox addresses that application requirement. [Cloudflare delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

Stripe does not guarantee webhook order and can deliver duplicates. The inbound handler needs durable receipts and state reconciliation. A successful response should follow durable acceptance. [Stripe webhooks](https://docs.stripe.com/webhooks).

Queues suit independent background jobs. Workflows suit durable sequences that wait between steps or for external events. Add Workflows when that distinction changes the implementation. [Cloudflare Workflows](https://developers.cloudflare.com/workflows/).

An outbox implementation needs driver-specific transaction checks. D1 and Postgres cannot inherit an untested shared transaction assumption.

## Files, data access, and live updates

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `storage` (capability) | Launch for stored files | Private object access, object keys, expiration, and lifecycle rules | R2, `infra` support |
| `file-uploads` (feature) | Launch for uploads | Upload authorization, metadata, size limits, and completion checks | `storage`, `auth`, `database` |
| File inspection (feature) | Launch for risky uploads | Quarantine and content inspection before download or processing | `file-uploads`, `queue`, inspection service |
| `media` (feature) | Optional | Avatars, image variants, and product-specific media processing | `storage`; processing integration |
| `data-import` (feature) | Growth | CSV mapping, validation preview, resumable jobs, and row errors | `storage`, `queue`, `database` |
| `data-export` (feature) | Launch where users need data portability | Authorized export jobs with expiring downloads | `database`, `storage`, `queue` |
| `search` (capability when justified) | Growth | Tenant-filtered indexing, queries, and index rebuilds | `database`; `queue` for external indexes |
| `kv` (capability) | Growth | Namespaced configuration and cache data that tolerate stale reads | Workers KV, `infra` support |
| HTTP cache (extension) | Growth | Cache keys, invalidation, and rules that prevent private data leakage | `api`, platform cache |
| `realtime` (capability) | Optional | Authorized channels, reconnect behavior, and event delivery | Durable Objects or suitable transport, `auth` |
| `collaboration` (feature) | Optional | Presence and concurrent editing with explicit conflict rules | `realtime`, product data model |
| `reporting` (feature) | Growth | Customer reports, saved filters, and optional scheduled delivery | `database`, permissions; `cron`, `email` |
| Warehouse export (integration) | Optional | Incremental analytical exports and schema evolution | Data events or database extraction |
| `file-sharing` (feature) | Optional | Expiring links, recipient restrictions, revocation, and download audit records | `storage`, `permissions`, `audit-log` |
| `file-versioning` (feature) | Optional | Object revisions, restore actions, and storage retention rules | `storage`, `database`, `retention` |
| `data-validation` (feature) | Growth for imported data | Reusable business validation rules and actionable record errors | `validators`, product data model |
| `data-sync` (feature) | Optional | Incremental synchronization with checkpoints, conflicts, and deletion propagation | `integrations`, `queue`, `database` |

R2 supports presigned URLs for bounded object access. Application code still needs authorization and upload validation. OWASP recommends layered file checks and controlled storage. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

Workers KV uses eventual consistency and does not provide the transaction behavior required for strict counters. Do not use it as the authoritative credit balance or quota store. [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

Durable Objects support coordination between clients. They are a candidate for live collaboration and per-key coordination. A product still needs a partitioning strategy for heavily used tenants. [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/).

Start search with the selected database when it meets measured needs. An external index adds synchronization, deletion, and tenant-filtering work.

## Product data and everyday actions

These candidates cover repeated application behavior. Start with product code and extract a module only when another feature can reuse the same contract.

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `projects` (feature) | Optional | Customer-owned containers for domain records with explicit membership rules | `tenancy`, `permissions`, `database` |
| `comments` (feature) | Optional | Resource comments, edits, deletion, and authorized visibility | `auth`, `permissions`, `database` |
| `mentions` (feature) | Optional | Resolve valid recipients and notify them without exposing private resources | `comments`, `notifications`, `permissions` |
| `activity-feed` (feature) | Optional | Show customer-visible changes with access filtering and pagination | Domain events, `permissions`, `database` |
| `tags` (feature) | Optional | Tenant-owned labels and resource associations | `tenancy`, `database` |
| `custom-fields` (feature) | Optional | Typed customer fields with validation and schema evolution | `validators`, `database`, `permissions` |
| `saved-views` (feature) | Optional | Saved filters, sorting, and authorized sharing | `app`, `database`, product queries |
| `favorites` (feature) | Optional | Personal resource bookmarks with access checks | `auth`, `database`, `permissions` |
| `bulk-actions` (feature) | Growth | Selected-record actions with per-record authorization and progress | `permissions`, `queue`, product actions |
| `trash` (feature) | Optional | Recoverable deletion with restore permissions and final purge | `database`, `retention`, `permissions` |
| `record-history` (feature) | Optional | Domain revisions and conflict-aware restore actions | Product data model, `permissions`, `database` |
| `templates` (feature) | Optional | Reusable customer record or project templates with copy rules | Product data model, `permissions` |
| `preferences` (feature) | Optional | User settings, defaults, and validated team overrides | `account`, `database` |

An activity feed serves customers. An audit log records accountable actions. Each needs its own visibility and retention rules, even when both consume the same event.

`projects` must not create a second tenant model. A project belongs to a tenant and can have narrower resource permissions.

## Communication, adoption, and support

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `notifications` (feature) | Growth | Persistent inbox, read state, and delivery preferences | `database`, `auth`, `queue` |
| Notification channels (extension) | Optional | Email, SMS, or push delivery through existing capabilities | `notifications`, selected channel |
| Email delivery events (extension) | Launch for production email | Bounce and complaint handling with suppression state | `email`, inbound webhooks |
| `sms-twilio` or another SMS provider (provider) | Optional | A production implementation of the existing SMS interface | `sms`; provider selection research |
| `push` (capability) | Optional | Web or mobile subscriptions and delivery credentials | `auth`, `database`, push service |
| `feedback` (feature) | Growth | Feedback collection, status, and an administrator screen | `api`, `database`, `validators` |
| `support` (integration or feature) | Launch as a contact path | Contact form or help-desk connection with authenticated context | `email` or support service |
| `help-center` (feature) | Growth | Searchable product instructions and support links | Base web application |
| `changelog` (feature) | Growth | Product updates and optional subscriber notices | Base web application; optional `email` |
| `blog` (feature) | Optional | Articles and authors through the existing web framework | Base web application |
| `cms` (capability only when needed) | Optional | Editorial roles, drafts, and publication workflows | Content service or database |
| `product-analytics` (integration) | Launch for adoption measurement | Explicit event names, tenant context, and data collection controls | `app`, selected analytics service |
| `experiments` (feature) | Growth | Stable assignment, exposure events, and outcome measurement | `feature-flags`, `product-analytics` |
| `referrals` (feature) | Optional | Attribution, reward rules, and duplicate reward prevention | `auth`, `database`; optional `billing` |
| `affiliate` (integration or feature) | Optional | Partner attribution, commission records, and payout integration | `billing`, partner service |
| `i18n` (feature) | Optional | Message catalogs, locale selection, and locale-aware formats | Base UI and application routes |
| `announcements` (feature) | Growth | Targeted product notices with dismissal state and expiry | `app`, `database`; optional `notifications` |
| `surveys` (feature) | Optional | Question forms, response storage, and customer targeting | `app`, `database`, `validators` |
| `customer-health` (feature) | Growth | Explain adoption signals and flag accounts for human follow-up | `product-analytics`, `billing`, `admin` |
| `lifecycle-messages` (feature) | Growth | Scheduled onboarding and retention messages with preferences and stop conditions | `email`, `cron`, `queue`, `consent` where required |
| `support-chat` (integration or feature) | Optional | Customer conversations, operator assignment, and conversation retention | Support service or `realtime`, `database` |
| `status-page` (integration or feature) | Growth | Public service state, incident updates, and optional subscriptions | Independent monitoring, incident process |
| SEO metadata (extension) | Launch for public pages | Page metadata, canonical URLs, sitemap, and indexing rules | Base web application |

These entries represent product choices. The report does not rank analytics, support, CMS, or SMS vendors. Select one service per immediate need before adding more providers.

Keep operational alerts separate from customer notifications. A failed customer delivery must not prevent an operator from receiving an incident alert.

## Production operations and security

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `observability` (capability) | Launch | Correlated metrics, traces, errors, and redaction rules | `logger`, application instrumentation |
| Alerts and availability checks (integration and practice) | Launch | External checks, actionable alerts, and named responders | `observability`, monitoring service |
| `ratelimit` (capability) | Launch for public endpoints | Abuse limits by identity or endpoint with explicit failure behavior | Workers rate-limit binding; `infra` support |
| `bot-protection` (feature) | Launch for abuse-prone forms | Server-verified challenges and form-specific controls | `api`, challenge service |
| `audit-log` (feature) | Launch for privileged changes | Actor, tenant, action, target, result, and retention policy | `auth`, `database` |
| `feature-flags` (feature) | Growth | Controlled exposure, tenant targeting, and flag ownership | Configuration store; optional `admin` |
| `maintenance` (extension) | Launch | Controlled read-only mode and disabled writes during recovery | `api`, deployment configuration |
| Recovery support (extension and practice) | Launch | Backup policy, recovery instructions, and timed restore exercises | Database driver, object storage |
| Deployment pipeline (extension and practice) | Launch | Environment separation, checks, migration order, and deployment recovery | `infra`, repository CI |
| Infrastructure resource support (extension) | With each new resource | Provision and remove resources with explicit ownership and retention rules | `infra`, new capability |
| Secret management (extension and practice) | Launch | Required configuration checks, access control, and rotation procedures | `infra`, selected secret stores |
| Application security baseline (extension and practice) | Launch | Browser security policy, request protections, dependency checks, and safe error output | Base, `api`, `auth`, CI |
| `retention` (feature) | Launch when storing personal data | Dataset-specific expiration and scheduled deletion | `database`, `cron`; storage integrations |
| `account-deletion` (feature) | Launch for self-service accounts | Reauthentication, ownership transfer policy, and deletion across services | `auth`, data owners; background processing |
| `consent` (feature) | Optional by product requirements | Versioned choices, withdrawal, and downstream collection controls | `database`, application UI |
| Privacy request operations (extension) | Optional by obligations | Identity checks, request tracking, export, deletion, and exceptions | `admin`, `data-export`, `retention` |
| Reliability objectives and incident response (practice) | Launch | Availability targets, alert response, incident records, and recovery ownership | Monitoring and operating procedures |
| Performance and capacity checks (practice) | Before growth | Representative load, tenant fairness, database limits, and queue recovery measurements | Tests and observability |
| Cost controls (extension and practice) | Launch for costly operations | Per-tenant cost attribution, budgets, and enforced resource limits | `usage-metering`, `quotas`, service metrics |
| Accessibility checks (practice) | Launch | Keyboard, focus, labels, contrast, and assistive technology checks | Base UI and feature UI |
| Support impersonation controls (extension) | Launch if impersonation is enabled | Require authorization and record actor, reason, duration, and affected customer | `auth`, `admin`, `audit-log` |
| Security events (extension) | Launch for sensitive accounts | Record suspicious access and credential changes with response rules | `auth`, `observability`, `audit-log` |
| Data encryption policy (extension and practice) | Launch for sensitive data | Define protected fields, key ownership, rotation, and recovery access | Data owners, secret management |
| Safe migrations (extension and practice) | Launch | Check schema compatibility, deployment order, backfill progress, and recovery steps | Database driver, deployment pipeline |
| Preview environments (extension and practice) | Growth | Isolated review deployments with non-production data and resource cleanup | `infra`, deployment pipeline |
| Failure exercises (practice) | Growth | Verify behavior during dependency failure, retries, and partial recovery | Representative environment, `observability` |
| Security evidence (practice and integration) | Optional enterprise | Record access reviews, control ownership, and required operational evidence | Operating procedures, `audit-log` |

Cloudflare's rate-limit binding is permissive and eventually consistent. Its counters are unsuitable for accurate accounting. Keep abuse limits separate from billable usage and strict quotas. The older plan's required KV dependency needs reconsideration. [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Logging covers only part of observability. OpenTelemetry distinguishes logs, metrics, and traces. Use that distinction when extending the existing logger. [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/).

D1 provides recovery through Time Travel with plan-dependent retention. Postgres recovery depends on its hosting arrangement. Object recovery requires its own policy. A restore exercise must measure recovery time and verify recovered data. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

Use OWASP ASVS 5.0.0 as a versioned reference for application security requirements. It has a release date of 2025-05-30. Modules can implement controls, but the assembled application still needs verification. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).

Define reliability through user-visible service indicators and objectives. A module count does not measure availability or recovery. [Google SRE guidance on SLOs](https://sre.google/workbook/implementing-slos/).

## Enterprise, integrations, and specialized products

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `custom-domains` (feature) | Optional | Domain ownership checks, certificate state, routing, and removal | Cloudflare for SaaS, tenant context, `infra` |
| `branding` (feature) | Optional | Tenant-specific logos, colors, and validated presentation settings | `teams`, `storage`, shared UI |
| Enterprise audit export (extension) | Optional | Customer audit retrieval and security-system delivery | `audit-log`, outbound delivery |
| Enterprise access policy (extension) | Optional | Organization login restrictions and session requirements | `sso`, `auth`, `teams` |
| Data placement and dedicated tenants (architecture extension) | Optional | Explicit placement, isolation, and migration procedures | Database and infrastructure design |
| `integrations` (capability when reused) | Growth | Customer connection records, credentials, revocation, and sync status | `auth`, `database`, secret protection |
| Integration connectors (features) | Optional | One service-specific synchronization flow per connector | `integrations`, `queue`, `cron` |
| Public API documentation (feature or build tooling) | Launch for public APIs | Versioned contracts, examples, pagination, and error definitions | `api`, `validators` |
| Client SDK generation (build tooling) | Growth for public APIs | Generated clients and compatibility checks | Public API contract |
| OAuth authorization server (feature) | Optional platform | Third-party application registration, scopes, consent, and token lifecycle | `auth`, `permissions`; protocol review |
| `ai` (capability) | Optional AI product | Model calls, streaming, timeouts, usage capture, and controlled credentials | AI service; `observability`, `quotas` |
| `ai-retrieval` (feature) | Optional AI product | Document ingestion, retrieval, tenant filters, and deletion propagation | `storage`, `queue`, search or vector index |
| `ai-agents` (feature) | Optional AI product | Tool authorization, execution limits, and approval points for external actions | `ai`, `workflows`, `permissions` |
| AI evaluation and safety controls (feature and practice) | Optional AI product | Task evaluations, unsafe input handling, and tool boundary checks | `ai`, representative test data |
| `document-generation` (feature) | Optional | PDF or document jobs with private delivery | `queue`, `storage`, rendering service |
| `approvals` (feature) | Optional | Assigned reviewers, decision history, deadlines, and escalation | `permissions`, `workflows`, `audit-log` |
| Mobile and offline sync (separate application or feature) | Optional | Device credentials, conflict resolution, and synchronization | `api`, `auth`, product data model |
| `integration-marketplace` (feature) | Optional platform | Discover connectors, manage installation, and display granted permissions | `integrations`, `app`, `permissions` |
| Customer-managed credentials (extension) | Optional | Accept customer service keys with encryption, validation, and revocation | `integrations`, secret management |
| `automation-rules` (feature) | Optional | Customer-defined triggers, conditions, and actions with execution history | `event-contracts`, `workflows`, `permissions` |
| Outbound HTTP actions (extension) | Optional automation | Restrict destinations and redirects; bound response size and request time | `integrations`, `workflows`, secret management |
| `developer-portal` (feature) | Growth for public APIs | API credentials, documentation, usage, and webhook delivery views | `app`, `api-keys`, public API documentation |
| `ai-conversations` (feature) | Optional AI product | Conversation state, streaming responses, retention, and authorized sharing | `ai`, `app`, `database` |
| `ai-prompt-management` (feature) | Optional AI product | Version prompts, record model settings, and compare evaluation results | `ai`, AI evaluation and safety controls |
| `ai-batch-jobs` (feature) | Optional AI product | Run bounded AI tasks with progress, retries, and usage reconciliation | `ai`, `queue`, `quotas`, `usage-metering` |
| `mcp-server` (feature) | Optional platform | Expose selected product tools and resources with scoped access and audit records | `api`, `permissions`, `audit-log`; protocol research |

Cloudflare for SaaS supports customer-owned domains and associated routing. Treat certificate and hostname lifecycle as part of the module. [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/).

AI Gateway is a candidate for AI traffic controls and visibility. Its inclusion does not establish model quality or safe tool behavior. Those require product-specific evaluation. [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/).

Industry features remain separate product code unless several projects share the same contract. Examples include booking, inventory, e-signatures, financial ledgers, and healthcare records. Their data rules require dedicated research.

## Industry-specific module candidates

These are optional product families, not requirements for the shared Saasaloy foundation. Each needs its own domain design before implementation. The names below describe proposed scope without selecting vendors or claiming legal compliance.

| Candidate and form | When | What it provides | Needs |
|---|---|---|---|
| `scheduling` (feature) | Optional | Availability, time zones, booking conflicts, and cancellation rules | `database`, `permissions`, `notifications` |
| `calendar-sync` (feature) | Optional | External calendar connections, changes, and conflict handling | `integrations`, `data-sync`, `scheduling` |
| `crm` (feature) | Optional | Contacts, organizations, and controlled customer relationship records | `database`, `permissions`, `custom-fields` |
| `sales-pipeline` (feature) | Optional | Opportunities, stage changes, and follow-up actions | `crm`, `activity-feed`, `notifications` |
| `ticketing` (feature) | Optional | Requests, assignments, response targets, and escalation | `permissions`, `notifications`, `workflows` |
| `forms` (feature) | Optional | Customer-defined forms, validation, submissions, and access policy | `custom-fields`, `validators`, `database` |
| `e-signatures` (integration or feature) | Optional | Document signing requests, signer identity, and evidence retrieval | `document-generation`, `integrations`; dedicated legal research |
| `inventory` (feature) | Optional | Stock movements, reservations, and reconciled quantities | `database`, atomic operations, `audit-log` |
| `orders` (feature) | Optional | Order lifecycle, fulfillment state, and cancellation | Product catalog, `database`; payment integration |
| `product-catalog` (feature) | Optional | Sellable items, variants, and publication rules | `database`, `storage`, `permissions` |
| `ledger` (feature) | Optional financial product | Balanced entries, immutable corrections, and reconciliation | Transactional storage; dedicated accounting design |
| `learning` (feature) | Optional | Courses, enrollment, progress, and access rules | `app`, `storage`, `entitlements` |
| `community` (feature) | Optional | Member posts, discussion access, and moderation | `auth`, `permissions`, `comments` |
| `moderation` (feature) | Optional user content | Reports, review decisions, appeals, and enforcement history | Content owners, `admin`, `audit-log` |
| `location` (integration or feature) | Optional | Authorized location records, map display, and location queries | Product data model, selected map service |
| Healthcare records (separate domain design) | Optional regulated product | Patient records and access rules from verified product obligations | Dedicated security, privacy, and domain research |

Shared modules can supply storage, identity, and operating controls. They do not settle booking policy, accounting rules, or regulated record requirements.

## Provider and driver expansion

Keep this list separate from business modules. An additional vendor implementation does not create a new customer capability.

| Family | Expansion to consider | Boundary |
|---|---|---|
| Email | Resend, SES, or Postmark when a project requires one | Candidate provider modules behind the existing `email` interface |
| SMS | Twilio or another selected delivery service | Candidate provider behind `sms` |
| Logs and telemetry | External log transport or telemetry exporter | Extend `logger` or `observability` according to the data contract |
| Billing | A second payment platform after the first integration works | Review state migration and ownership before choosing a descriptor shape |
| Search | An external index after database search reaches its limits | Persistent index lifecycle and rebuild procedure |
| AI | Another model service when product evaluations justify it | Keep model calls inside `ai`; verify the shared contract |
| Database | Improve D1 and Postgres feature compatibility first | Preserve the current mutually exclusive driver model |
| Object storage and deployment | Expand only after an explicit architecture decision | Current Cloudflare scope remains in effect |

Vendor names in this table are research candidates. This report does not compare their prices, regional availability, package compatibility, or commercial terms. Provider selection requires that comparison before implementation.

## Overlapping names and ownership

Use one owner for each behavior. The following names may describe the same proposal in another catalog.

| Names that can overlap | Owner in this report | Keep separate when |
|---|---|---|
| Organizations, workspaces, teams | Existing `teams` plus customer screens | A project or workspace represents a resource below the tenant |
| RBAC, access control, authorization | `permissions` | Authentication and tenant selection remain separate concerns |
| Payments, subscriptions, checkout, customer portal | `billing` | A marketplace needs seller accounts and payout behavior |
| Plans, feature access, paid feature checks | `entitlements` | Release flags control exposure rather than purchased access |
| Jobs, tasks, asynchronous processing | `queue` | Durable multi-step work belongs to `workflows` |
| Scheduler, recurring jobs | `cron` | A workflow waits for a specific event or deadline |
| Uploads, attachments, file manager | `storage` and `file-uploads` | Sharing, revisions, or inspection adds an independent contract |
| Alerts, messages, inbox | `notifications` for customers | Operators need independent incident alerts |
| Analytics, telemetry, usage | `product-analytics`, `observability`, `usage-metering` | These already have different measurement and retention requirements |
| Backups, disaster recovery | Recovery support and operating procedures | Reusable export or restore code justifies a module |
| GDPR, SOC 2, compliance | Specific data controls and security evidence | Obligations require dedicated research and verification |

Keep narrower proposals under their existing owner unless independent installation provides a clear benefit. These mappings preserve scope without creating duplicate modules.

## Recommended sequence

| Stage | Work | Completion evidence |
|---|---|---|
| 0. Correct the foundation | Controlled administrator setup, customer app boundary, teams database compatibility, and infrastructure compatibility | A normal customer uses the product without site administrator access |
| 1. Complete account access | `app`, `account`, `auth-email`, customer teams, `tenancy`, and `permissions` | Account recovery works and cross-tenant requests fail |
| 2. Establish production controls | Initial `observability`, `ratelimit`, recovery procedures, and deployment checks | Alerts detect a failure and an operator completes a restore exercise |
| 3. Complete paid access | Minimal `queue`, inbound receipts, `billing`, and `entitlements`; add outbox where required | Duplicate and reordered events produce correct subscription access |
| 4. Add reusable background features | `cron`, `storage`, `file-uploads`, `notifications`, and job operations | Failed jobs recover without duplicate business effects |
| 5. Add measured growth requirements | `usage-metering`, `quotas`, caching, search, and reporting | Load and cost measurements meet the product's declared limits |
| 6. Add customer-driven features | SSO, SCIM, custom domains, connectors, realtime, or AI | Each feature meets a concrete product or customer requirement |

Move metering and quotas into Stage 3 for usage-priced products. Move storage into Stage 1 when files are the product. Add MFA and audit records before exposing privileged operations.

The first reusable capability I would build is `queue`, after correcting the foundation gaps. Billing events and notification delivery provide immediate uses. Build its first complete consumer with it.

The first business feature I would complete is `billing` with entitlements. A checkout screen alone does not complete paid access.

## Suggested product selections

| Product | Existing foundation | Main additions |
|---|---|---|
| Individual subscription tool | Base, API, database, auth, email, logger, infra | Customer app, account recovery, billing, entitlements, queue, and production controls |
| Team SaaS | Individual subscription selection plus teams | Tenant permissions, customer team screens, invitations, seat billing, and audit records |
| API SaaS | API, database, auth, logger, infra | API keys, public contracts, metering, quotas, billing, and usage views |
| File or content SaaS | Customer application selection | Storage, validated uploads, background processing, search, and exports |
| Enterprise SaaS | Team SaaS selection | Customer-required SSO, SCIM, audit export, access policies, and recovery evidence |
| AI SaaS | Relevant customer application selection | AI calls, strict cost limits, usage records, evaluations, and optional retrieval |

These are proposed selections. They are not existing CLI stack definitions.

## Module boundaries to preserve

- Keep the existing two-tier descriptor model. Provider and driver labels retain their current project meanings.
- Keep vendor dependencies inside their owning capability.
- Extend `infra` with each new resource type.
- Reuse the existing logger for log output.
- Keep billing state separate from product access decisions.
- Keep strict quotas separate from abuse rate limits.
- Keep organization membership separate from site administrator privileges.
- Treat UI blocks as presentation with the project's required manual wire-up.
- Keep backup procedures and deployment checks with their owners unless reusable code justifies another module.
- Add provider variants only when an actual product requires them.

## Requirements for a production module

Each module needs a complete operating contract. These requirements apply when relevant to its behavior.

| Area | Required evidence |
|---|---|
| Installation | Dependency resolution, repeat installation, update, and removal behavior |
| Data compatibility | Supported database drivers and migration behavior |
| Authorization | Positive access tests and rejected cross-tenant access |
| Reliability | Timeout, retry, duplicate, and partial-failure behavior |
| Operations | Local development instructions, deployment support, alerts, and recovery procedure |
| Data lifecycle | Ownership, retention, deletion, and removal effects on stored data |
| Cost | Service assumptions and per-customer resource limits where needed |

No throughput estimate is justified yet. User count alone does not specify load. Define peak requests, query patterns, file sizes, background job volume, and acceptable response times before selecting capacity changes.

## Open questions for planning

1. Select the first reference product and its pricing model.
2. Decide whether new features must support D1 and Postgres immediately.
3. Settle the customer application's location and routing approach.
4. Define the relationship between individual accounts, teams, and billing customers.
5. Select the first payment provider for the seller's operating requirements.
6. Specify availability and recovery targets.
7. Define tenant scale and representative load.
8. Confirm required customer contracts and data placement constraints.

The report does not measure package compatibility, deployment behavior, throughput, or operating cost. Those checks belong in the selected module's implementation work. It does identify the current repository gaps that must inform that work.

## Options compared

| Approach | Initial delivery | Maintenance | Production coverage | Recommendation |
|---|---|---|---|---|
| Build every proposed module first | Delays the first product | Every integration adds update work | Broad coverage without workload evidence | Reject |
| Build features separately for each product | Starts quickly | Repeats billing and access logic | Depends on each product team | Use for domain-specific behavior |
| Build a shared foundation with optional feature modules | Delivers complete flows in stages | Shares common contracts | Adds controls with each capability | Choose |

This comparison is engineering judgment based on Saasaloy's copy-in model. It is not a measured cost comparison.

## Scope and method

This report assumes a small team builds a web SaaS with Saasaloy. It covers individual accounts and business customers with teams. It includes launch requirements, operational growth, and optional enterprise features.

The repository review covers module descriptors, selected implementation files, the glossary, and the existing Phase 3 plan. The cited research uses official service documentation and engineering guidance. This is a catalog and recommendation, not an implementation plan or a security audit.

All external sources have an access date of 2026-09-07. Service documentation is continuously updated unless a version or publication date appears below. Compatibility with the repository's pinned packages remains unverified.
