# Plan — Phase 3: capability + feature module roadmap

## Context

Phases 0–2 of `docs/plans/saasaloy-build-spec.md` deliver the base, the local applier, the
`api`/`database`/`auth`/`admin`/`email` capabilities, and the `waitlist`/`billing`/`teams`
features. That set proves the machinery end-to-end but leaves the registry thin: every capability
so far is **request-scoped** (a route handler, a table, a cookie). The primitives a real SaaS
reaches for next — async work, blob storage, scheduled jobs, edge KV, realtime, AI, observability,
rate limiting — don't exist yet, and several obvious features are blocked on them.

Phase 3 widens the registry along the axis of **dependency leverage**: build the few capabilities
that unlock the most downstream features first, and immediately prove each with one feature that
`dependsOn` it. Success = the registry can compose an async, file-handling, metered SaaS without
hand-wiring, and each new capability has at least one shipped feature exercising its convention.

This plan covers **what to build and in what order**. The per-module descriptor/file layout is the
`create-module` skill's job at implementation time; this plan settles the set, the sequencing, and
the conventions each capability must establish.

**This is a roadmap, not a build-next doc.** As of writing, the Phase-1 applier (`saasaloy add`) is
a stub and `modules/` is empty — *no* Phase 1/2 module exists yet. Phase 3 therefore sits on top of
two unbuilt phases; every issue derived from it must carry a `blocked` prerequisite on the applier +
the `api`/`database`/`auth`/`admin` capabilities it composes over. Nothing here is buildable until
those land.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Doc status | **Roadmap only** — not buildable until the Phase-1 applier + `api`/`database`/`auth`/`admin` exist. Derived issues carry a `blocked` prerequisite; nothing here is built next. |
| Prioritization axis | **Dependency leverage** — a capability's rank = how many Phase-3 features it unblocks. Cheapest-to-scaffold breaks ties. |
| Phase-3 capability set | `queue`, `storage`, `cron`, `kv`, `realtime`, `ai`, `observability`, `ratelimit` — the missing non-request-scoped Cloudflare primitives. (The last four were a proposed Phase 4; **now merged into Phase 3** — no separate phase.) |
| Phase-3 feature set | `feedback`, `api-keys`, `file-uploads`, `usage-metering` — each proves a capability (or re-proves the base machinery). |
| `queue` cost | **No paywall.** Cloudflare Queues has a free tier (10k ops/day, 24h message retention — [pricing](https://developers.cloudflare.com/queues/platform/pricing/)). Stays the #1 pick; the skill documents the free-tier ceiling, not a paid requirement. |
| `usage-metering` coupling | **Standalone.** `dependsOn: database + queue`; `billing` is an *optional* integration (like `waitlist`'s optional `email`), so metering proves `queue` without dragging in Stripe/auth/admin. |
| First module built | `feedback` — a near-clone of `waitlist` needing **no new capability**, so it re-proves the format still holds after Phase 2 before any new primitive is introduced. |
| Each capability ships a convention | Like `api`'s `routes/` glob and `database`'s schema barrel, every Phase-3 capability establishes one auto-discovery folder so features drop in without patches. **Exact seam deferred** — see Open questions. |
| Agent context contract | **Settled, not open.** Code (`packages/cli/src/commands/add.ts`) already confirms the reversed model from build-spec §2.13: modules ship **skill folders copied into `.claude/skills/`**, recorded in the manifest — no `.agents/` fragments, no `sync`. The `create-module` SKILL.md is simply *stale* on this → a doc fix (see Open questions), not a Phase-3 decision. |
| Structural patches stay minimal | New bindings (`wrangler.jsonc` queue/R2/KV/cron entries) are the only expected `patches` — the 10%, via `jsonc-parser`. Everything else is convention file-drops. |

## Approach

Each capability is followed immediately by the feature that proves it. Build order flows top to
bottom.

### Milestone 3.0 — `feedback` (re-prove the machinery)
- **Type:** feature. **DependsOn:** `api`, `database`, optional `email`.
- Drop `routes/feedback.ts`, `schema/feedback.ts`, and a landing-facing `FeedbackForm`.
- Purpose: validate the descriptor/apply flow still generalizes after the Phase-2 additions,
  with zero new primitives. Cheapest possible proof; ships first.

### Milestone 3.1 — `queue` capability (highest fan-out)
- **Type:** capability. **Scaffolds:** Cloudflare Queues producer + consumer wiring in `apps/api`.
- **Convention:** a `consumers/` folder the Worker entry auto-registers (mirrors `routes/` glob).
- **Patch:** `wrangler.jsonc` queue producer/consumer bindings.
- Unlocks: usage-metering, notifications, audit-log, async email, webhook fan-out.

### Milestone 3.2 — `usage-metering` (proves `queue`)
- **Type:** feature. **DependsOn:** `database`, `queue`, optional `billing`.
- Event producer + a `consumers/usage.ts` that rolls counters into a `schema/usage.ts` table.
- Closes the loop toward usage-based billing; first proof a feature can drop a queue consumer.

### Milestone 3.3 — `storage` capability (second-highest fan-out)
- **Type:** capability. **Scaffolds:** R2 bucket binding + a signed-URL / upload repository.
- **Convention:** an `uploads/` handler folder (or repo-layer helper) features call.
- **Patch:** `wrangler.jsonc` R2 bucket binding.
- Unlocks: file-uploads, avatars, data exports, blog assets.

### Milestone 3.4 — `file-uploads` (proves `storage`)
- **Type:** feature. **DependsOn:** `storage`, `auth`.
- Upload UI + signed-URL issuance + an R2-backed object record.
- First end-to-end proof of a **new-capability → feature** chain (mirrors `waitlist` over `api`+`database`).

### Milestone 3.5 — `cron` capability (cheap, high utility)
- **Type:** capability. **Scaffolds:** Cloudflare Cron Triggers wiring in `apps/api`.
- **Convention:** a `scheduled/` folder the `scheduled()` handler auto-globs.
- **Patch:** `wrangler.jsonc` cron trigger entries.
- Unlocks: digests, cleanup jobs, billing dunning retries, usage rollups.

### Milestone 3.6 — `kv` capability (cheap, unblocks flags/ratelimit)
- **Type:** capability. **Scaffolds:** Workers KV binding + a typed cache-aside helper.
- **Convention:** a namespaced KV repo helper.
- **Patch:** `wrangler.jsonc` KV namespace binding.
- Unlocks: feature-flags, rate-limit counters, cache-aside reads.

### Milestone 3.7 — `api-keys` (proves `auth` in a non-UI path)
- **Type:** feature. **DependsOn:** `auth`, `database`.
- Key issuance + verification middleware + a `schema/apiKeys.ts` table.
- Stresses `auth` through a programmatic (non-cookie) path — a genuinely different exercise than
  `billing`; high personal value for any API product.

### Milestone 3.8 — `realtime` capability
- **Type:** capability. Durable Objects + WebSockets (presence/live updates).
- Unlocks: support-chat, notifications. Implementation details deferred.

### Milestone 3.9 — `ai` capability
- **Type:** capability. Workers AI / AI Gateway typed inference helper; fits the AI-agent-native
  thesis. Implementation details deferred.

### Milestone 3.10 — `observability` capability
- **Type:** capability. Structured logging + Analytics Engine / Sentry; an error-handling
  middleware convention on `api`. Implementation details deferred.

### Milestone 3.11 — `ratelimit` capability
- **Type:** capability. Cloudflare rate-limiting binding + middleware convention (leans on `kv`).
- **DependsOn:** `kv`. Implementation details deferred.

## Open questions

Targets for grillkit / build-time to harden before issuekit files these:

- **Convention seam (deferred by decision).** Do `queue`'s `consumers/`, `cron`'s `scheduled/`,
  and `storage`'s upload handlers reuse `api`'s exact `routes/` auto-glob, or get bespoke
  registration? And is `storage` a `uploads/` handler folder or a plain repo-layer helper?
  **Decided per-capability at build time**, not now — kept open deliberately.
- **`queue` local-dev story.** Free tier and cost are settled (no paywall); the remaining thin spot
  is the `wrangler dev` queue-emulation workflow the module's skill should document.
- **Per-module implementation details.** The merged capabilities `realtime`/`ai`/`observability`/
  `ratelimit` (milestones 3.8–3.11) are listed set-only; each one's convention, patches, and
  proving feature are deferred — to be discussed when that module is authored.
- **Build order for 3.8–3.11.** Their sequencing relative to each other and to 3.0–3.7 is
  unresolved; only `ratelimit`'s `dependsOn: kv` is fixed so far.

## Non-goals

- **The broader feature backlog** — `notifications`, `referrals`, `audit-log`, `feature-flags`,
  `search`, `onboarding`, `support-chat`, `invitations`, `blog/cms`, `analytics-dashboard` are
  parked; they land once their unblocking capability exists.
- **Postgres / multi-cloud** — still cut per build-spec §2.3; D1 + R2 + Workers + Queues/KV only.
- **Descriptor/file authoring** — the per-module `registry-item.json` + `files/` layout is the
  `create-module` skill's job at build time, not this plan's.
- **The HTTP registry** — still deferred; Phase 3 modules are local-applier descriptors.
- **Fixing the stale `create-module` skill** — a real follow-up (its Step 4 still documents the old
  `.agents/`/`sync` model), but a CLI-repo doc chore, tracked separately from this roadmap.
