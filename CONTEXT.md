# Saasaloy

Ubiquitous language for Saasaloy — an open-source, composable SaaS accelerator (a CLI + module system, not a boilerplate). This is a glossary of what terms mean in this project; the settled *decisions* and their reasoning live in [`docs/adr/`](docs/adr/).

## The product

### Saasaloy
An open-source **composable SaaS accelerator**: a CLI + module system that scaffolds a near-inert base and installs everything churny — API, database, auth, admin, features — on demand, borrowing shadcn's copy-in (you-own-the-code) distribution mechanics.
_Avoid: boilerplate, starter template._

### Base
The scaffold `saasaloy init` produces: `apps/web` (Astro) + `packages/ui` + `packages/tsconfig`, and nothing churny. It is inert on *functional* surfaces — no services, auth, database or network dependencies — which is where the anti-rot thesis actually bites. It is not bare, though: `packages/ui` owns the **design layer** (the Tailwind 4 theme, the vendored shadcn primitives, and the [blocks](#block) the landing page is composed from), because presentation dependencies rot aesthetically before they rot dangerously — a smaller blast radius than auth's, not an exemption from dependency auditing ([ADR 0022](docs/adr/0022-adr-design-layer-ships-in-the-base-2026-08-06.md)). Base files are recorded at `init` under the reserved module name `base` in `.saasaloy/manifest.json`, with a `base` record in `saasaloy-lock.json` naming the CLI version and template hash, so `outdated`, `update` and `doctor` treat the base like a module that ships with the CLI ([ADR 0032](docs/adr/0032-adr-the-base-carries-provenance-and-updates-through-the-module-path-2026-09-06.md)). Files the template declares as **seed** are recorded but never updated.

### Block
A marketing-page composition in `packages/ui/src/blocks/` — `navbar`, `hero`, `feature-grid`, `pricing-table`, `faq`, `cta`, `footer` — each entirely self-contained in one props-driven `.tsx` with its own copy defaults, and reachable only at its own `@repo/ui/blocks/<name>` subpath (never re-exported from the package root). A block composes vendored shadcn primitives; a primitive is the single control it composes. Filenames are semantic kebab-case, not shadcn's registry-style `{category}-{NN}` numbering. A [module](#module) that ships UI ships it as a block too, at `@ui/blocks/<name>.tsx`, and the owner places it by hand ([ADR 0030](docs/adr/0030-adr-module-ui-ships-as-a-ui-package-block-2026-09-02.md)); the base blocks read their copy from `content/landing.ts`, a module's block carries its own. A block is presentational: one that has to reach the network takes a function prop, and a small island under `apps/web/src/components/` supplies it, so `packages/ui` imports no api package.
_Avoid: section — the `sections/*.astro` glob a module wrote into was retired by ADR 0030. Avoid component — that's a primitive._

### Wire-up
The manual step a [block](#block)-shipping module leaves for the owner: the import line and the tag that put the module's UI on a page (the app-side island, when the block takes injected behaviour). It lives in a required `## Wire-up` section of the module's skill, which is the only place the steps exist — `saasaloy add` prints a pointer to it, never the steps, and never edits a page ([ADR 0030](docs/adr/0030-adr-module-ui-ships-as-a-ui-package-block-2026-09-02.md)). `saasaloy remove` deletes the block file and leaves the wire-up standing, because nothing recorded where it went.
_Avoid: placement, install step._

### Module
A unit of capability or feature installed by `saasaloy add`.

### Capability module
A module that scaffolds an app or package **and** establishes convention-based extension points: `api`, `database`, `auth`, `admin`, `email`, `sms`, and the Phase-3 set (`queue`, which absorbs `cron` and `workflows`, plus `storage`, `kv`, `realtime`, `ai`, `observability`, `ratelimit`). A capability built on a vendor SDK encapsulates it: the scaffolded workspace owns the npm dependency and exports project-facing utilities; no other workspace imports the vendor package directly ([ADR 0020](docs/adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)). A capability with more than one possible implementation scaffolds only the neutral part and leaves the rest to a [provider module](#provider-module) or a [driver module](#driver-module); the system-of-record test picks which ([ADR 0033](docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)). `database` splits from `database-d1` and `database-postgres` on the driver side ([ADR 0026](docs/adr/0026-adr-database-driver-split-2026-08-28.md)), `email` from `email-cloudflare` and `email-console` on the provider side.

### Feature module
A module that drops files into a capability's conventions and declares its `dependsOn`: `waitlist`, `billing`, `teams`, `feedback`, `usage-metering`, `api-keys`, `file-uploads`, …

### Team
The product word for the `teams` feature module, which adds Better Auth organizations, members, invitations, and active-organization switching. It does not mean Better Auth's nested teams-within-an-organization sub-feature. That sub-feature stays disabled, so the module adds no `team` or `teamMember` table.
_Avoid: using team to mean an organization subdivision unless the nested plugin feature is enabled later._

### Provider module
A module supplying **one implementation of a capability's provider interface**: `email-cloudflare`, `email-console`, `sms-console`, and the planned `email-resend` and `sms-twilio`. It carries a single file into the capability's `providers/` folder plus the patch that registers it, and it owns the descriptor surface that differs per provider — a binding, an npm dependency, a secret. `sms` shows the surface can be empty on one side and still worth the module: it has no Cloudflare-native provider at all, because Cloudflare has no SMS product. Allowed wherever the capability passes the **system-of-record test**: the project does not own the schema or the migrations, and swapping the vendor moves no existing data, because the platform owns the state or the service holds none ([ADR 0033](docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md), narrowing [ADR 0001](docs/adr/0001-adr-all-in-on-cloudflare-2026-07-22.md)'s 2026-08-04 amendment). `queue`, `kv`, `email`, `sms` and `logger` pass it; `database` and `storage` fail it and take [driver modules](#driver-module) instead. The authoring guide is `.agents/skills/create-provider/`. Several providers coexist in one project and `<CAP>_PROVIDER` picks between them at runtime. The one-file rule covers the *runtime* surface only: a provider that needs a Workers binding may carry several descriptor patches, and it registers any [handler set](#handler-set) through `apps/api/src/worker.ts`, never through `infra`.
_Taxonomy wart, on purpose: a provider module is typed `saasaloy:feature`, because `registry-item.schema.json` constrains `type` to `saasaloy:capability | saasaloy:feature`. It isn't a feature in the sense above — it adds no user-facing behavior. A third tier would be a descriptor-format change, and one wart is cheaper than that._

### Driver module
A module supplying **one of several mutually exclusive implementations of a capability the project is the system of record for**: `database-d1` and `database-postgres` today, and `storage` when it lands. A capability takes drivers when the project owns the schema and the migrations, or when swapping the vendor would move existing data ([ADR 0033](docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)); holding state is not by itself the test, since `queue` and `kv` hold state and take [providers](#provider-module). Unlike a [provider module](#provider-module) it replaces files the capability would otherwise own (`src/client.ts`, `drizzle.config.ts`, `tsconfig.json`), carries scaffolds of its own, and ships its own skill folder. And unlike a provider, **exactly one** is ever installed, never zero and never two. Both halves are declared in descriptors and enforced by `saasaloy add`, never selected by a runtime env var: each driver names its siblings in `conflictsWith`, and the capability names its drivers in `requiresOneOf` so the core cannot land without one ([ADR 0026](docs/adr/0026-adr-database-driver-split-2026-08-28.md) and its 2026-08-31 amendment).
_Avoid: adapter, dialect module. A driver is typed `saasaloy:feature` for the same schema reason a provider is._

### Convention-based extension point
An auto-discovery folder or barrel a module drops into without patching another module's internals — `database`'s schema barrel, and the proposed `consumers/`, `scheduled/`, `uploads/` folders. These are what make granular modules safe. Two of them are gone: `api`'s `routes/` became a [registration table](#registration-table) ([ADR 0028](docs/adr/0028-adr-routes-register-by-chained-route-patch-2026-08-28.md)), and `apps/web`'s `sections/*.astro` glob became a [block](#block) plus a manual [wire-up](#wire-up) ([ADR 0030](docs/adr/0030-adr-module-ui-ships-as-a-ui-package-block-2026-09-02.md)). Both went for the same kind of reason: a scan buys authoring convenience and gives the consumer nothing it can name — a type in one case, a position in the other.
_Avoid: extension hook._

### Registration table
A file a capability publishes that names its entries **statically**, so a type can be derived from it — `apps/api/src/index.ts`'s `.route()` chain, a capability's `providers` barrel array. A module still drops its file, but it registers by patching one line into the table, and `remove` takes that line back out. The opposite of a [convention-based extension point](#convention-based-extension-point): a scan needs no patch and yields no type, a table needs a patch and yields one ([ADR 0028](docs/adr/0028-adr-routes-register-by-chained-route-patch-2026-08-28.md)).
_Avoid: route manifest, registry (that is a [registry source](#registry-source))._

### Handler set
An object a [provider module](#provider-module) contributes to `apps/api/src/worker.ts`'s `handlers` [registration table](#registration-table), carrying the non-`fetch` Worker entry points it needs: `queue` for a Queues consumer, `scheduled` for a Cron Trigger. `worker.ts` is the wrangler `main`; its local `defineWorker({ fetch: app.fetch, handlers: [] })` merges every registered set into the object the Worker exports, and `apps/api/src/index.ts` stays the Hono app with `export default app`, so ADR 0028's `chained-route` codemod is untouched. A set gates on its capability's `<CAP>_PROVIDER` and returns early when another provider is selected ([ADR 0033](docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)).
_Avoid: worker export, entry point — the entry is `worker.ts` itself, a handler set is one contribution to it._

### Job
A unit of work the `queue` capability runs outside the request: a name, an optional payload schema, and a handler, declared once with `defineJob` and registered in `packages/queue`'s `jobs` [registration table](#registration-table). A caller enqueues it by name and never learns which provider carries it. A job declared `durable: true` runs as ordered steps with `ctx.step` and `ctx.sleep` between them.
_Avoid: task, worker, background job._

### Schedule
A named binding of a five-field cron expression to a [job](#job), declared with `defineSchedule` in code and registered in `packages/queue`'s `schedules` table. A feature never patches `wrangler.jsonc` for one: `queue-cloudflare` installs a single `* * * * *` trigger, and its [handler set](#handler-set) matches every schedule against the tick truncated to the minute and enqueues the due ones. The tick enqueues, it never runs a job inline, so a scheduled run gets the same retries and dead-letter path as any other.
_Avoid: cron job, timer — `cron` is the expression, a schedule is the registered pairing._

### Plan
A named tier of the product, declared in code in `packages/billing/src/plans.ts` with `definePlans`: an `id`, a display `name`, `features` (booleans), `limits` (numbers), an optional `trialDays`, and `providerIds` mapping a provider name to its price ids per interval. The list is the single source for both the [entitlement](#entitlement) answer and the provider's own price mapping — `billing-stripe` reads `providerIds.stripe.monthly` as the price id and `trialDays` as the free-trial length. Exactly one plan is the default: it carries no `providerIds` and it is what a subject with no live [subscription](#subscription) resolves to. There is no plan table and no seed step. The landing page's `pricing-table` [block](#block) keeps its own copy in `content/landing.ts` and is kept in step by hand.
_Avoid: tier, package, product — a Stripe product is the vendor's object, a plan is the project's._

### Subscription
One row of `billing_subscription`: a [billable subject](#billable-subject)'s relationship to a [plan](#plan) as the payment provider currently reports it. Vendor-blind by construction — the vendor appears only in provider ids (`providerSubscriptionId`, `providerCustomerId`, `providerScheduleId`) — with a normalized `status` (`trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `paused`) and two core-only columns the vendor knows nothing about, `lockedAt` and `reminderSentAt`. A subject has at most one **live** subscription at a time; older rows stay as history. Every write comes from a webhook the vendor sent, never from a route ([ADR 0034](docs/adr/adr-0034-billing-tables-are-a-projection-of-the-vendors-record-2026-09-08.md)).
_Avoid: membership, licence. A Better Auth `subscription` model is the plugin's name for the same row, mapped onto this one._

### Billable subject
Who the bill is addressed to: an opaque `{ referenceId, customerType }` pair that `packages/billing/src/subject.ts` resolves from the request and authorizes. The default bills the user, so `customerType` is `"user"` and `referenceId` is the user id; installing `teams` overrides the same file under `onlyWith` to bill the active organization and check membership instead. Nothing else in the capability — no route, no job, no entitlement check — knows which of the two it is looking at, which is what lets a project move billing from users to organizations by replacing one file.
_Avoid: customer, account, owner. The customer is the vendor's object, reached through `providerCustomerId`._

### Entitlement
The answer to "may this [billable subject](#billable-subject) do this", derived from its live [subscription](#subscription)'s [plan](#plan) and never stored: `hasFeature(name)` for a boolean, `limit(name)` for a number, `currentPlan()` for the plan itself. The `entitlements` module owns them, reads the [projection table](#projection-table) and the plan file, memoizes the resolved plan per request, and falls back to the default plan for a subject with no live row, a `lockedAt` row, or a project with no billing provider installed at all. `requireFeature(name)` is the route middleware over the same answer and returns HTTP 402 naming the feature.
_Avoid: permission, role — those are auth's, and they answer "who are you", not "what did you pay for"._

### Projection table
A table the project owns, queries and migrates whose rows are a **copy** of a record some vendor holds: `billing_subscription` and `billing_event` are the first two. It is written only by the webhook path, keyed by the vendor's own ids, and rebuildable by replaying events, which is why the capability that owns it still takes [provider modules](#provider-module) — [ADR 0033](docs/adr/adr-0033-transient-state-capabilities-take-providers-2026-09-08.md)'s first question says drivers, its second says providers, and the second wins because a vendor swap re-subscribes customers instead of moving rows ([ADR 0034](docs/adr/adr-0034-billing-tables-are-a-projection-of-the-vendors-record-2026-09-08.md)).
_Avoid: cache, mirror. A cache may be dropped without consequence; a projection is queried on every request and is rebuilt from the vendor, not from the project._

### Proof module
A feature module whose real job is to validate that the machinery generalizes: *first proof* = `waitlist`, *hard proof* = `billing`, *cheapest proof* = `feedback` (zero new capability).

### Dependency leverage
The Phase-3 prioritization axis: a capability's rank equals how many downstream features it unblocks; cheapest-to-scaffold breaks ties.

## Registry & applier

### Applier
The engine behind `saasaloy add`: it obtains a module descriptor from a [registry source](#registry-source), resolves file targets through the alias map, topologically sorts prerequisite modules, and applies files + npm deps + config patches — all `--dry-run`/`--diff`-able. Descriptors are fetched from a remote GitHub repo by default (the `readFile → fetch` swap has landed — [ADR 0012](docs/adr/0012-adr-remote-first-registry-repo-is-the-registry-2026-07-23.md)); a local checkout is a dev/offline override.
_Avoid: registry (the applier is the engine; the "registry" is a [registry source](#registry-source))._

### Registry source
Where the applier fetches descriptors from: a GitHub repo (`owner/repo`) by convention (`modules/<name>/registry-item.json` + `files/`), resolved to a commit SHA and fetched via giget. `SAASALOY_REGISTRY_DIR` points the applier at a local checkout for dev/offline. The repo *is* the registry — no build step, no committed index, no central submission.
_Avoid: registry server, registry service._

### Default registry
The built-in registry source (`mimukit/saasaloy`) a bare `saasaloy add <name>` resolves against. An explicit `owner/repo/name` [module coordinate](#module-coordinate) targets a third-party registry instead.

### Module coordinate
How a module is addressed on the `saasaloy add` command line: `name` (default registry) | `owner/repo/name` | `owner/repo@ref/name` (pinned branch/tag/SHA) | `owner/repo` (no module ⇒ interactive picker over that repo).

### `registry-item.json`
A module descriptor, shadcn-shaped: `files[]` (path → alias target), `dependsOn[]`, `dependencies[]` (npm), `patches`, and an `agent` block.

### Descriptor `agent` block
The descriptor field pinning the skill folder(s) a module ships: `{ "skills": ["skills/saasaloy-<name>"] }`.

### `saasaloy.json`
The consumer manifest in a generated project: the alias map plus the list of installed modules (which drives `dependsOn` resolution). A module enters `installed` only when the run that applied it wrote every file it planned, because bookkeeping describes disk. A half-applied module stays out of the list and a plain re-run of `saasaloy add` re-plans and completes it ([ADR 0031](docs/adr/0031-adr-re-run-is-recovery-for-a-partial-add-2026-09-03.md)).

### `.saasaloy/manifest.json`
Managed-file tracking: each file or skill a module applied, recorded with a content hash and its owning module, so update and `remove` know exactly what to undo. Committed `AGENTS.md`/`CLAUDE.md` are **not** managed entries. An entry means those bytes are on disk ([ADR 0006](docs/adr/0006-adr-copy-in-updates-manifest-hash-tracking-2026-07-22.md)), which is why entries for a module that `saasaloy.json` does not list as installed mean a partial apply, and `saasaloy doctor` reports it as one ([ADR 0031](docs/adr/0031-adr-re-run-is-recovery-for-a-partial-add-2026-09-03.md)).

### `saasaloy-lock.json`
Machine-owned provenance at the consumer root: per installed module, its [registry source](#registry-source) + ref + resolved commit **SHA** + resolved `dependsOn` graph. The npm-style lock to `saasaloy.json`'s intent — it makes remote installs reproducible (the SHA *is* the integrity anchor), so the default ref can be a live branch rather than a hand-pinned tag.
_Avoid: putting resolved SHAs in `saasaloy.json`._

### File aliases
The descriptor's path targets: `@web` / `@api` / `@db` / `@ui` / `@admin`.

### Conditional file entry (`onlyWith`)
A `files[]` or `scaffolds[].files[]` entry that installs **only when a named module is in the resolved install set** — this run's dependency graph plus what `saasaloy.json` and the lock say is already there. Two entries may share one `target` under disjoint conditions, which is how `auth` and `waitlist` ship a `sqlite-core` and a `pg-core` variant of the same table file and let the installed [driver module](#driver-module) pick. `listModuleFiles` (`packages/cli/src/lib/applier.ts`) filters before either engine plans, so the unchosen variant never reaches the lock, the manifest or drift detection. A target whose entries are all conditional and none match is a plan-time error, not a silent skip.
_Avoid: file variant, dialect flag, conditional patch (patches carry no condition)._

### Config-patch engine
The AST-codemod layer for the structural ~10% of edits: `magicast` for TS/JS module edits (e.g. a Better Auth plugin array) and `jsonc-parser` for `wrangler.jsonc` bindings.

### Copy-in update (`--diff`)
The update path for existing projects: hash a managed file — match → clean overwrite; drift (hand-edited) → route to AI-merge rather than clobber. Two records override the hash and force the merge path: an [adopted entry](#adopted-entry) and an [owned file](#owned-file) ([ADR 0034](docs/adr/0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md)).
_Avoid: versioned-package update._

### Adopted entry
A `.saasaloy/manifest.json` entry whose hash the CLI took off disk rather than from bytes it wrote — what `saasaloy update` records for a project that had no base record. The flag exists because the two facts differ: the hash proves the file has not changed *since adoption*, not that the template wrote it. An adopted entry never earns an overwrite; it goes to the [AI-assisted merge](#ai-assisted-merge) until the CLI writes the file itself.
_Avoid: pristine entry, baseline hash._

### Owned file
A base-template file the template ships once and the project owns afterwards — `globals.css`, the blocks, the components, `packages/ui/src/index.ts`, the layout, the favicon. Declared as globs in `_saasaloy-base.json`'s `ownedFiles`, distinct from a [seed file](#seed-file), which is recorded and then ignored entirely. An owned file is created or restored when absent and routed to the merge plan when present.
_Avoid: user file, editable file._

### Seed file
A base-template file the owner is meant to rewrite — `DESIGN.md`, `README.md`, `saasaloy.json`, the landing page and its copy. Listed in `_saasaloy-base.json`'s `seedFiles`, recorded in the manifest and never updated, however far it drifts.

### AI-assisted merge
The structured, agent-consumable merge plan `--diff` emits for a drifted file — natural-language intent + target files + old/new context — handed straight to an agent CLI.

## AI-agent-native

### Agent-native project
A generated project that ships its agent context committed, so any agent tool opens it with context immediately — present on a fresh clone, no generation step.

### `AGENTS.md` / `CLAUDE.md`
Committed **static** base files carrying the fixed common project rules; `CLAUDE.md` is a one-line `@AGENTS.md` import. Neither is generated.

### `DESIGN.md`
The committed design contract at a generated project's root. It pairs machine-readable tokens with the rationale and rules that agents use when they change UI.

### Base-shipped skill
Agent guidance copied by `init` because every generated project needs it. It differs from a module skill, which arrives only when `saasaloy add` installs its module.

### Token fingerprint
The first 12 hexadecimal characters of the SHA-256 hash for `packages/ui/src/styles/globals.css`, recorded in `DESIGN.md`. A mismatch proves that the design contract can be stale without inspecting its prose.

### Module skill (skill folder)
A module's on-demand guidance, shipped as a Claude skill folder (`skills/saasaloy-<name>/SKILL.md`) that `saasaloy add` **copies** into the consumer's `.claude/skills/saasaloy-<name>/` and records in the manifest. Every module skill is **`saasaloy-`-prefixed** (folder and frontmatter `name` alike) so it never collides with a user's own installed skills.
_Avoid (superseded): agent fragment, `.agents/*.md` fragment, `saasaloy sync`. Avoid an unprefixed module skill name (`api` → use `saasaloy-api`)._

## Key-value, limits & flags

### Namespace
The owning segment at the front of every `kv` key, so two modules cannot collide on the same string. `buildKey({ namespace, parts })` joins the namespace and its parts with `:`, which is why neither a namespace nor a part may contain that character, and a built key over 512 bytes is refused with `invalid_key` rather than truncated. A namespace is a naming rule inside one store, not a second store: on Workers KV every namespaced key still lives in the one `KV` binding.
_Avoid: prefix, bucket, partition. Avoid using it for Cloudflare's own `kv_namespaces` binding entry, which is the store itself._

### Policy
A **named** rate limit registered in `packages/kv` through `definePolicy`, carrying the name and nothing else across the contract: `consume({ policy, key })` takes `"strict"`, never a number. The numbers live with the provider (`RL_<NAME>` entries under `ratelimits` in `wrangler.jsonc` on Cloudflare), because the Rate Limiting binding fixes its `limit` and `period` at config time and reports no count back. An unregistered policy name raises `not_supported`. The two halves can drift, so `saasaloy doctor` checks that every registered policy has a matching `RL_<NAME>` binding, by name only.
_Avoid: rule, tier, quota. A policy is not a counter; the contract has no `increment`._

### Flag
A named switch read through the typed `flag(key, { subjectId, tenantId })` helper, either boolean or a percentage rollout. The database is the source of truth and the KV document is a published copy: an admin toggle writes both, a reader never writes on a hit, and an isolate-local cache in front of KV means a change reaches a warm Worker in about 70 seconds. Resolution runs tenant override, then global row, then the default written in code. A percentage flag buckets a subject with a synchronous FNV-1a hash, so the same subject lands in the same bucket on every request.
_Avoid: toggle (that is the admin action), experiment, A/B test._

### Kill switch
A [flag](#flag) under the `kill.` prefix that guards a whole integration rather than one feature's behaviour: `assertEnabled("payments")` throws while `kill.payments` is off, and returns while it is on. It exists so an operator can shut payments, AI or email off without a deploy.
_Avoid: circuit breaker, which trips itself on errors. A person turns a kill switch._

### Maintenance mode
The reserved `system.maintenance` [flag](#flag). While it is on, a normal request gets a custom 503 page, and an admin session plus a configured path list pass through, so the operator can still reach the app that turned it on.
_Avoid: downtime, outage. Maintenance mode is deliberate._

## The two repos

### Tool repo
This repo (package `saasaloy-monorepo`): it develops and maintains the CLI, the base template, and the modules. It tracks its own `AGENTS.md`/`CLAUDE.md` directly and **never self-syncs**; its own dev skills are hosted `.agents/`-canonical with a `.claude/skills/` symlink.
_Avoid: generated project._

### Generated project
The downstream SaaS repo produced by `saasaloy init`.

### `.dev`
The git-ignored sandbox directory where the CLI is exercised, so running `init`/`add` never mutates the tool repo.
