# Plan — `email` capability module (multi-provider)

**Issue:** [#15](https://github.com/mimukit/saasaloy/issues/15) · **Created:** 2026-08-04 · **Grilled:** 2026-08-04 · **Status:** hardened

## Context

Saasaloy has no way to send email. Two modules already have a hole where it belongs:

- `modules/waitlist` takes an address, writes a row, and returns `{ ok: true }`. Nobody is ever told they joined.
- `modules/auth/files/src/auth.ts:79` sets `requireEmailVerification: false` with the comment *"needs the `email` capability; auth deliberately doesn't depend on it"* — a deferred dependency waiting on this module.

ADR 0020 also names this module by name: *"the next capability (`email`) faces the same fork."* So the shape chosen here is the one every capability after it inherits.

**`email` is multi-provider.** The capability owns a provider-agnostic core; each provider ships as its own module carrying its own files, patches, env vars, and npm deps. A consumer imports `@repo/email` and never learns which provider is active. Cloudflare Email Service is the first real provider (ADR 0001 commits the stack to Cloudflare, and Email Sending reached public beta on 2026-04-16); `console` is the second, for local dev. Resend, SES, and Plunk are follow-up issues that add a module each and change no core code.

Success: `saasaloy add email-cloudflare` gives a project a typed, provider-agnostic send helper and a template convention; a real transactional email leaves `.dev/playground` and arrives in an inbox; `waitlist` and `auth` have a documented, one-step way to use it; and an agent can author the next provider from a skill.

### What Cloudflare Email Sending actually gives us

Researched 2026-08-04; the type facts verified directly against the pinned `@cloudflare/workers-types@5.20260723.1` tarball.

| | |
|---|---|
| **Interface** | Workers binding. `send_email` array in `wrangler.jsonc`; `await env.EMAIL.send(builder)` → `{ messageId }` |
| **Credentials** | **None.** No API key, no secret. The binding *is* the credential |
| **Binding fields** | `name` (required), `remote`, `destination_address`, `allowed_destination_addresses`, `allowed_sender_addresses` |
| **Types (verified)** | `SendEmail`, `EmailMessageBuilder`, `EmailReplyMessageBuilder`, `EmailDestinations`, `EmailAddress`, `EmailAttachment`, `EmailSendResult` all exist as ambient globals. **No hand-rolled types needed** |
| **Message shape** | `from: string \| EmailAddress`; `to`/`cc`/`bcc`: `string \| EmailAddress \| array`, at least one required; `subject`, `html?`, `text?`, `replyTo?`, `headers?`, `attachments?` |
| **Result** | `EmailSendResult` is exactly `{ messageId: string }` |
| **Local dev** | `remote: true` makes `wrangler dev` call the real API |
| **Limits** | 50 combined to/cc/bcc · 5 MiB message · 32 attachments · 16 KB headers |
| **Errors** | Throw with a `code` — `E_SENDER_NOT_VERIFIED`, `E_RATE_LIMIT_EXCEEDED`, `E_CONTENT_TOO_LARGE`, … **These codes appear nowhere in the `.d.ts`** — they are runtime-only strings, so any typing is ours to define and ours to keep accurate |
| **Prerequisites** | Cloudflare DNS **+ a domain onboarded through the dashboard** (auto-adds SPF/DKIM/DMARC and a `cf-bounce` subdomain) **+ Workers paid plan** |
| **API choice** | Structured `send()` / `EmailMessageBuilder`, not the legacy raw-MIME `EmailMessage` |

Three of these shape the module: **there is no secret to manage** for this provider (but there is for every other), **there is a manual dashboard step the CLI cannot perform**, and **the error codes are untyped**.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Architecture** | **Capability core + provider modules.** `email` scaffolds `packages/email`; `email-<provider>` modules each drop a provider file and register it. Verified to need **zero CLI or schema work** (see below). |
| **Providers in scope** | `email-cloudflare` (binding) and `email-console` (dev). Resend/SES/Plunk are follow-up issues. |
| **Provider selection** | `EMAIL_PROVIDER` is **always required**, even with one provider installed. `createEmail` throws naming the registered providers when it is unset or unknown. No implicit default — a production deploy must never silently stop sending, and a test run must never silently send. |
| **Env access** | **Factory: `createEmail(env)`**, mirroring `getDb(c.env.DB)`. Deviates from that precedent in taking the *whole* env rather than one binding, because which key a provider reads is precisely what the caller isn't allowed to know. Not module-scope `cloudflare:workers` env — `packages/auth` uses that only because its `export const auth` must be a module-scope singleton for the `ts-module` plugin-array patch point. |
| **Templating** | **Plain tagged-template helpers in `packages/email`. No React Email.** `send()` takes `html`/`text` strings, so nothing forces a framework; `react-dom/server` in the api Worker is bundle weight every project pays for. **Reversed in part — see the note below.** |
| **Template contract** | `(props) => { subject, html, text? }`. `text` is **auto-derived** from the `html` tag helper's output when absent, and overridable when the derived version isn't good enough. Every message ships multipart without every template being authored twice. |
| **Errors** | Providers normalize failures into one thrown `EmailError` carrying a stable `code` union, a `retryable` flag, and the raw `providerCode`. |
| **Retry** | **None in the package.** A retry loop inside a Worker request handler holds the response open. The example teaches `waitUntil()` for non-critical mail and `await`-with-catch for critical — both stay correct when `queue` lands. |
| **Secrets** | Provider-owned. `email-cloudflare` needs none; an HTTP provider declares its own key in its own `envVars`. Issue #15's *"`envVars` for the Resend key"* moves to the `email-resend` follow-up. |
| **`dependsOn`** | `email` → `["api"]`; each provider → `["email"]`. |
| **Optional-dependency mechanism** | **Out of scope. Its own issue + ADR.** See below. |

> **Reversal note (2026-09-03) — §Templating.** The "No React Email" line above is reversed by [`plan-email-react-templates-2026-09-03.md`](plan-email-react-templates-2026-09-03.md) and recorded in [ADR 0031](../adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md). What changed is not the cost but who pays it: React Email ships as a separate opt-in module, `email-react`, so "bundle weight every project pays for" stops being true — only a project that runs `saasaloy add email-react` pays. The measured cost is +262,576 B gzipped on a Worker whose route imports a JSX template. Everything else in this row still holds. `packages/email` keeps the tagged-template idiom, keeps zero runtime dependencies, and is untouched by that module; the two idioms coexist per template.

### Architecture: capability core + provider modules

The forcing constraint is that providers differ in ways *code alone cannot absorb*. A binding provider needs a `wrangler.jsonc` patch and no secret; an HTTP provider needs an npm dep and a secret and no patch. That is descriptor surface, not function bodies — which is why the per-provider **descriptor** is the natural unit, and why the original plan's "swapping providers rewrites one function body" was never true.

| | `email-cloudflare` | `email-console` | `email-resend` (follow-up) |
|---|---|---|---|
| `patches` → `apps/api/wrangler.jsonc` | `send_email` binding | — | — |
| `patches` → `packages/email/package.json` | — | — | `resend` dep |
| `patches` → `packages/email/src/index.ts` | register | register | register |
| `envVars` | — | — | `RESEND_API_KEY` |
| `files` → `@email/providers/` | `cloudflare.ts` | `console.ts` | `resend.ts` |

**This needs no CLI work, and that is verified, not assumed.** `buildPlan` collects scaffold aliases across the whole install run up front (`packages/cli/src/lib/applier.ts:181-190`), so a provider's `@email/providers/…` target resolves against an alias the core's scaffold hasn't written yet. Patches are planned after all files are collected and *executed* after all files are written (`applier.ts:299-321`), so a `plugin-array` patch lands on a barrel scaffolded moments earlier in the same run. Both behaviours carry comments saying they exist for exactly this case. `saasaloy add email-cloudflare` therefore works as one command on a clean project.

The registration uses the existing `plugin-array` patch kind unchanged. It requires the shape `export const X = fn({ prop: [...] })` (`packages/cli/src/lib/patch/ts-module.ts:34-38`), so the scaffolded barrel is written to fit it:

```ts
// packages/email/src/index.ts — scaffolded empty by `email`…
export const email = defineEmail({ providers: [] });

// …and after `saasaloy add email-cloudflare`, patched in place by magicast:
import { cloudflare } from "./providers/cloudflare";
export const email = defineEmail({ providers: [cloudflare()] });
```

Adding a provider later is the same command again; the codemod appends idempotently.

**This retroactively settles ADR 0020's weakest leg.** The original plan justified scaffolding `packages/email` partly on *"patch targets must live in the capability's workspace"* — hypothetical at the time, since nothing patched `packages/email`. Under this design `packages/email/src/index.ts` **is** the patch point, exactly as `packages/auth/src/auth.ts`'s plugin array is for `billing`. ADR 0020's consequences already describe this pattern; provider modules are an instance of it, not an exception to it.

### The ADR 0001 collision — this amends an accepted ADR

ADR 0001 cuts this pattern by name:

> …the multi-cloud adapter layer is cut entirely — **no `core` capability interfaces, no per-provider adapter packages** (`db-neon`, `store-s3`, `deploy-*`)…
> *Considered Options:* Swappable multi-cloud adapters behind capability interfaces — cut: swappability serves other people's stacks, a product concern deferred with the personal-first scope.

A provider-agnostic `EmailProvider` interface plus `email-<provider>` modules **is** a core capability interface plus per-provider adapter packages. This plan therefore amends ADR 0001 rather than merely applying it, and the amendment must be written down or the next capability re-opens the argument.

The defensible narrowing: ADR 0001's target was **infrastructure** lock-in — D1 vs Neon, R2 vs S3 — where a swap is a data migration and the adapter layer hides a difference that matters. Email providers are stateless, interchangeable send endpoints with no migration, and Cloudflare's is gated behind a paid plan plus manual dashboard onboarding, so a user may be genuinely unable to take the default. The amended rule: **stateful infrastructure stays single-provider; stateless third-party services may be multi-provider when the capability owns the abstraction.**

### Issue #15 needs rewriting

All three scope bullets describe a world that no longer exists:

- ~~"Resend client wired via context-threaded env"~~ → a provider module; Resend is a follow-up
- ~~"`envVars` for the Resend key"~~ → provider-owned, not core
- ~~"React Email templates"~~ → plain template helpers

Acceptance criteria 2 and 3 also need restating (below). **AC 3 moves out of this issue entirely** — see the next section. Update the issue body before `issuekit` files anything downstream of this plan.

### The optional-dependency problem, and why it leaves this plan

Issue #15's AC 3 — *"`waitlist` can opt into email without further wiring"* — **cannot be satisfied by the descriptor format as it stands**:

- `dependsOn?: string[]` (`packages/cli/src/lib/schema.ts:132`) is a flat list
- `packages/cli/src/lib/resolve.ts:33` treats every entry as a hard, topo-sorted prerequisite
- nothing anywhere expresses *"use `email` if it's installed"*

Two alternatives were weighed in the grill and rejected. A `waitlist-email` module depending on both would have to ship its own `@api/routes/waitlist.ts`, so two modules would claim one target while the manifest records one owning module per file — ambiguous for updates and for the eventual `remove` (#27). Giving `waitlist` an `onSignup: []` extension point now would design an extension point against a single hypothetical consumer, inside an issue that promises not to touch `waitlist`.

**Resolution:** `email` ships standalone. Its skill documents the manual wiring for `waitlist` and `auth`. A separate issue owns optional deps and closes AC 3 properly. Restate AC 3 in #15 as explicitly deferred so the gap is visible rather than implied.

## Approach

### What it reuses

| Existing thing | Used for |
|---|---|
| `modules/auth/registry-item.json` | The capability descriptor precedent — `scaffolds` + `files` + `patches` + `envVars` in one item |
| `packages/cli/src/lib/patch/jsonc.ts:46` | The `wrangler-binding` patch kind, unchanged — `send_email` needs **no CLI feature work** |
| `packages/cli/src/lib/patch/ts-module.ts` | The `plugin-array` patch kind, unchanged — how a provider registers itself |
| `modules/database/files/src/client.ts:15` | The `getDb(binding)` factory convention `createEmail(env)` mirrors |
| `modules/api/files/src/index.ts` route glob | `auth`/`waitlist` routes already mount by convention; email adds no route of its own |
| `pnpm play:init` → `.dev/playground` | The send-proof harness |
| `.agents/skills/create-module/` | The repo-level authoring-skill shape `create-provider` copies (`.agents/skills/<name>/SKILL.md` + a `.claude/skills/<name>` symlink) |

### Phase 1 — `packages/email` core

The scaffold. Provider-agnostic, zero runtime dependencies.

- `files/package.json` → `@repo/email`, `exports` map (`.` and `./templates`), **zero runtime deps**, `@cloudflare/workers-types` in dev.
- `files/src/provider.ts` — the contract:

  ```ts
  export interface EmailProvider {
    name: string;
    send(env: EmailEnv, message: EmailMessage): Promise<{ messageId: string }>;
  }

  export class EmailError extends Error {
    code: "sender_not_verified" | "rate_limited" | "too_large" | "provider_error";
    retryable: boolean;
    providerCode?: string; // raw, e.g. E_RATE_LIMIT_EXCEEDED
  }
  ```

- `files/src/define.ts` — `defineEmail({ providers })` returns the registry; `createEmail(env)` resolves `env.EMAIL_PROVIDER` against it, **throwing when unset or unknown with a message naming the registered providers**.
- `files/src/index.ts` — the barrel and the patch point:

  ```ts
  export const email = defineEmail({ providers: [] });
  export function createEmail(env: EmailEnv) { return email.create(env); }
  ```

  Keep `export const email = defineEmail({ providers: [] })` in exactly this shape — `insertIntoPluginArray` needs a real array literal inside the first call argument to push into.
- `files/src/render.ts` — the escaping `html` tag helper (escapes interpolations by default), the shared layout wrapper, and `deriveText(html)` for the plaintext fallback.
- `files/src/templates/` — one worked example proving the `(props) => { subject, html, text? }` contract.
- `files/tsconfig.json` — copied from the `auth` scaffold.

Descriptor: `dependsOn: ["api"]`, one `package-json-dependency` patch adding `@repo/email` to `apps/api`, `envVars: { EMAIL_PROVIDER, EMAIL_FROM }`.

**Verify:** `pnpm typecheck` passes in a playground with `email` added; the workspace has no runtime deps; `createEmail({})` throws the naming error.

### Phase 2 — `email-cloudflare`

- `files/cloudflare.ts` → `@email/providers/cloudflare.ts`. Reads the `SendEmail` binding off `env.EMAIL`, builds an `EmailMessageBuilder`, normalizes thrown errors into `EmailError` by mapping the runtime `code` string.
- Patches: the `send_email` wrangler binding, and the `plugin-array` registration.

  ```jsonc
  { "kind": "wrangler-binding", "file": "apps/api/wrangler.jsonc",
    "bindingType": "send_email", "entry": { "name": "EMAIL", "remote": false },
    "matchOn": "name" }
  ```

  **Amended 2026-08-05 (was `"remote": true`).** QA found that `@cloudflare/vite-plugin` opens a
  remote proxy session at startup for any remote binding, so `remote: true` made
  `pnpm --filter @repo/api dev` fail on a machine with no Cloudflare credentials — including for a
  developer on `EMAIL_PROVIDER=console` who never touches the binding. The module now ships
  `remote: false` and the `saasaloy-email` skill documents flipping it for a live send. Reasoning
  and the rejected alternatives are recorded in the QA plan's TC-4.

- **`matchOn: "name"` is the first non-default use.** It defaults to `"binding"` (`jsonc.ts:42`); every existing caller relies on that default, so idempotency for `send_email` is currently unproven. Add a `jsonc.test.ts` case covering upsert-then-reupsert with `matchOn: "name"`.
- `allowed_sender_addresses` is deliberately unset so each project picks its own — the module never hardcodes a domain.

**Verify:** `saasaloy add email-cloudflare` twice in a row leaves one `send_email` entry and one `cloudflare()` in the providers array, comments intact.

### Phase 3 — `email-console`

The dev provider. No binding, no key, no npm dep — writes the rendered message to `console.log` and returns a synthetic `messageId`. One file plus one `plugin-array` patch.

This is what makes local development and tests work with no paid plan, no domain onboarding, and no secret.

### Phase 4 — the skills

- **`.agents/skills/create-provider/SKILL.md`** (repo-level, contributor-facing, plus the `.claude/skills/create-provider` symlink). Organized by **mode**, with `email` as the first mode; `sms`, `kv`, and others are added as modes later, so shared descriptor conventions live in one place while each mode stays concrete. The `email` mode covers: the `EmailProvider` contract, the `@email/providers/` file target, the `plugin-array` registration payload, where the npm dep goes (a `package-json-dependency` patch against `packages/email/package.json`, per ADR 0020 — *not* the descriptor's `dependencies[]`, which merges into the project root), and provider-owned `envVars`.
- Add a pointer from `.agents/skills/create-module/SKILL.md` so an agent authoring anything provider-shaped gets routed there.
- **`modules/email/skills/saasaloy-email/SKILL.md`** (ships to consumers), carrying:
  - **the dashboard runbook** — onboard a domain (Compute → Email Service → Email Sending), what DNS records appear, the Workers paid-plan requirement;
  - the template-authoring contract;
  - **§ "Writing a custom provider in your own project"** — the interface contract only, for a consumer writing a bespoke provider into their own `packages/email/src/providers/`. No descriptor conventions; that audience never authors a registry module.
  - **the manual wiring recipe** for `waitlist` (send after the insert, via `waitUntil` so a mail failure can't fail the signup) and `auth` (flip `requireEmailVerification`, supply `sendVerificationEmail`) — the stand-in until optional deps exist.
- No code changes to `waitlist` or `auth` in this issue.

### Phase 5 — the send proof

AC 2 restated so it is actually achievable:

> A transactional email sends from `.dev/playground` via `wrangler dev` (with the binding flipped to `remote: true` — see the amendment in Phase 2) using a domain onboarded to Email Service, and the returned `messageId` plus the receiving inbox are recorded in `docs/qa/`. Separately, `EMAIL_PROVIDER=console` produces a rendered message with no Cloudflare setup at all.

**Amended 2026-08-05.** The flip is now an explicit step in the QA runbook (TC-1 step 5) rather than the shipped default, so this AC is proved by an operator action instead of by the module's out-of-box configuration. The `console` half is unaffected.

Blocking fact: **`saasaloy.dev` does not resolve in DNS** (noted in #46), so there is no first-party sender domain today. The proof needs *some* domain on the owner's Cloudflare account. The `console` provider means this blocks only the Cloudflare half of the proof, not the whole issue.

- QA doc: `docs/qa/qa-email-capability-module-2026-08-04.md`, dashboard steps included.
- **Cross-issue note for #47:** this is the first module whose acceptance depends on a manual, out-of-band step. `saasaloy doctor` should check that `EMAIL_PROVIDER` is set **and matches a registered provider**, and that a `send_email` binding exists when `email-cloudflare` is installed. It cannot verify domain onboarding, and shouldn't pretend to.

### Phase 6 — record the decisions

- **Amend ADR 0001** with the narrowing above: stateful infrastructure stays single-provider; stateless third-party services may be multi-provider when the capability owns the abstraction. Without this, every provider module reads as a violation of an accepted ADR.
- **Extend ADR 0020** — its trigger clause is *"built around a vendor SDK"*; `email`'s core has no SDK at all. Broaden it to: a capability scaffolds a workspace when it owns an **integration boundary**, npm-shaped or not. Cite the two pieces of concrete evidence: `packages/auth` must send verification mail and cannot import from `apps/api` (`apps/api` already depends on `@repo/auth`, so the reverse is a cycle), and `packages/email/src/index.ts` is a real patch point. **Do not** cite provider-swap churn as the rationale — a swap changes `envVars` and `patches` too, so it was never contained to one function body.
- **`CONTEXT.md` glossary:** add **provider module** — a `saasaloy:feature` module supplying one implementation of a capability's provider interface. Note the taxonomy wart deliberately: `type` is enum-constrained to `saasaloy:capability | saasaloy:feature` (`registry-item.schema.json`), so a provider is typed `feature` despite not being one. A third tier is a format change and is not worth one here.
- **Resolve build-spec §6 Open Q #1** — strike "assume Resend + React Email"; record the multi-provider core with Cloudflare first.
- **README § Requirements** — state which modules are free-tier viable (`base`, `api`, `database`, `auth`, `waitlist`) and that `email-cloudflare` needs a Workers paid plan plus dashboard domain onboarding. No free-tier promise is made either way; the constraint is simply visible before install rather than at first send.

## Resolved during the grill

1. **Free-tier viability** → no product promise. Document the boundary in the README; `console` covers local dev.
2. **Is the provider seam real?** → No, and that finding drove the redesign. A provider swap changes `envVars` and `patches`, not just a function body — which is exactly why a provider is a *module*, not a code branch.
3. **Does the template contract include `text`?** → Optional and auto-derived from the `html` helper's output, overridable.
4. **Is `dependsOn: ["api"]` right?** → Yes, and the assumption is smaller than feared. A future queue-consumer or cron Worker capability carries its own `send_email` binding patch in its own descriptor; the provider reads the binding by name and nothing in `packages/email` hardcodes a Worker.
5. **Where does retry live?** → Not in the package. `EmailError.retryable` lets a future `queue` consumer decide; the example teaches `waitUntil()` and `await`-with-catch, both of which survive `queue` landing.
6. **Does the optional-dep split strand AC 3?** → Yes, deliberately. Both alternatives were worse (file-ownership ambiguity, or an extension point designed for one hypothetical consumer). Restate AC 3 in #15 as deferred.
7. **Does `@cloudflare/workers-types` export `SendEmail`?** → **Yes, verified.** `SendEmail`, `EmailMessageBuilder`, `EmailSendResult` and friends are all ambient globals in the pinned `5.20260723.1`. The error *codes*, however, are not typed anywhere.

## Follow-up issues

| Issue | Why it's separate |
|---|---|
| `email-resend` provider module | One descriptor + one file. Also the free-tier send path, so worth prioritizing if free-tier-startable ever becomes a promise. |
| `email-ses`, `email-plunk` | Structural copies of the Resend shape; no new coverage. |
| Optional-dependency descriptor mechanism + ADR | Touches schema, resolver, applier, `registry-item.schema.json`. Two waiting consumers (`waitlist` → `email`, `auth` → `email`). Closes #15's AC 3. |
| `saasaloy doctor` checks (#47) | `EMAIL_PROVIDER` set and matching a registered provider; `send_email` binding present when `email-cloudflare` is installed. |

## Non-goals

- **Resend, SES, Plunk in this issue.** The architecture supports them; each is a follow-up module.
- **The optional-dependency descriptor mechanism.** Its own issue and ADR.
- **A third module tier for providers.** Typed `saasaloy:feature`, wart recorded in the glossary.
- **Retry, queuing, or scheduled sends.** `EmailError.retryable` is the hook; `queue` owns the rest.
- **Inbound email / Email Routing.** Cloudflare Email Service covers both; this module is send-only. `onEmail` handlers and the Agents-SDK inbox integration are a separate capability if ever.
- **Marketing email, lists, unsubscribe management.** Transactional only.
- **Attachments.** The API supports them (32 files, 5 MiB); the scaffold does not teach them.
- **Code changes to `waitlist` or `auth`.** Documented recipes only, until optional deps land.
- **A `saasaloy doctor` check.** Named as a cross-issue dependency; owned by #47.
