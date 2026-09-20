# Plan: the `config` capability

Grilled: 2026-09-20

Issue: [#154](https://github.com/mimukit/saasaloy/issues/154). Companion: [#153](https://github.com/mimukit/saasaloy/issues/153) (`env`, open as [PR #160](https://github.com/mimukit/saasaloy/pull/160)), which states the boundary rule this plan implements. The two branches run in parallel off `main`.

## Context

A scaffolded saasaloy project has one project-level constant: `siteName` in `packages/ui/src/index.ts`, set from `{{PROJECT_NAME}}` at init. Everything else a project owner would change once is a literal inside the file that happens to use it, or an env var wearing the wrong clothes.

A survey of `templates/base/**` and `modules/*/files/**` found four failure shapes.

**The product name exists three times.** `siteName` in `@repo/ui`, the `BILLING_APP_NAME` env var with its `?? "your app"` fallback in `modules/billing/files/api/billing-store.ts:118`, and an `appName` prop every email and SMS template requires with no project-level source. A rename changes one and misses two.

**The same constant is written twice in two packages.** `ADMIN_ROLE` and `SUPERADMIN_ROLE` appear in both `modules/auth/files/src/authorize.ts` and `modules/admin/files/src/lib/auth.ts`.

**Pricing exists twice with no shared ids.** The marketing tiers in `packages/ui/src/content/landing.ts` and the billing plans in `modules/billing/files/src/plans.ts`. Nothing links them, so an id or a name drifts silently.

**Policy knobs hide in leaf files.** `DEFAULT_LOCKOUT_DAYS = 14` in `modules/billing/files/src/config.ts:21`, `MAX_EXPIRY_DAYS = 365` inside an admin React component at `modules/api-keys/files/admin/components/api-key-workspace.tsx:39`, `DEFAULT_MAX_UPLOAD_BYTES` in `modules/storage/files/src/define.ts:33`, `DEFAULT_ISOLATE_TTL_SECONDS = 10` in `modules/feature-flags/files/src/cache.ts:17`, the three ratelimit policies, and `limit: 100` written at the call site in `modules/admin/files/api/routes/admin-users.ts:44`.

`config` is the missing channel. It owns values a project checks into its repo and ships identically to every environment.

This plan fixes the first three shapes and leaves the fourth to a follow-up. A duplication is a falsifiable defect; a tunable moved from one file to another is a preference, and moving seven of them would make the first shipment a seven-module refactor.

Success: one typed `@repo/config` object, readable from any app and any capability with a plain import; the product name, the role constants and the plan ids each with one home; a module contributing a section through the existing `plugin-array` patch, with a collision refused at `add` time; zero runtime dependencies.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| The boundary rule | `env` owns per-deployment values the platform supplies at runtime, secret or not. `config` owns values checked into the repo and identical in every deployment. Taken verbatim from the `env` plan so one rule has one wording. |
| The test a value takes | Two deployments of the *same* project. If the value can differ between them, it is `env`. If it cannot, it is `config`. A value that differs between two *different* projects but not between one project's environments is `config`. |
| Providers or drivers | Neither. `config` wraps no external service, so ADR 0033's provider question and ADR 0037's replace-versus-add question do not apply. There is no `CONFIG_PROVIDER`. |
| Where it ships | `packages/config` in the base template. The CLI substitutes `{{PROJECT_NAME}}` at `init`, before any module exists, so a module fallback path is never needed. |
| What it is at runtime | A frozen plain object built at module scope and exported. No factory, no `env` argument, no async, no I/O. A bundler can inline it. |
| How a value is read | A plain import: `import { config } from "@repo/config"`. Not `createConfig(env)`. `env` takes the environment in whole because a Worker binding only exists per request; a checked-in constant has no such constraint, and forcing symmetry would buy nothing. |
| Direction of dependency | `packages/config` is the leaf and imports nothing. `packages/ui` depends on it, not the reverse. The corollary is the split rule: numbers and ids live in `packages/config`, sentences live in `packages/ui/src/content/`. |
| Where a default lives | The capability package that knows what the value means, as `packages/<cap>/src/config.ts` exporting one section. This mirrors the `env` plan's preset rule so a capability author learns one placement rule, not two. |
| Where an override lives | One checked-in `packages/config/src/project.ts`, the only file a project owner is expected to edit. The reason is ADR 0034, not ergonomics: a section file is module-owned and `update` may rewrite it, so an owner's edit there would be lost. |
| How sections compose | `defineConfig({ sections: [] })` in `packages/config/src/define.ts`, an array literal each capability module appends to with a `plugin-array` patch. Identical to `defineKv`'s registry. |
| Section keys | Flat, and the section key is the module name by convention. A collision between two installed modules is refused at `add` time, naming both, the same guard `lib/collisions.ts` already applies to files one level up. No runtime namespace, and the base may own a plain `app` section. |
| Merge depth | One level below the section. `project.ts` replaces a leaf value; it never deep-merges an array or a nested record. A nested record is replaced whole, which keeps the merge explainable in one sentence. |
| Typing | Inferred from the composed sections, with no hand-written interface to drift. `project.ts` is typed as a deep-partial of the inferred shape, so a typo in an override is a `typecheck` failure. |
| Validation | `typecheck` only. No schema, no zod. The values are literals in the repo, so a wrong one is a code review problem, not a runtime one. This is the sharpest difference from `env`, which validates because its values arrive from outside. |
| Reading `env` from `config` | Forbidden. `packages/config` imports nothing, including `@repo/env`. A value derived from both is derived at the call site. |
| The four misplaced env keys | `BILLING_APP_NAME`, `BILLING_LOCKOUT_DAYS`, `FLAGS_ISOLATE_TTL_SECONDS` and `STORAGE_MAX_UPLOAD_BYTES` stay in `envVars`. Nothing in this plan is breaking and no release note is owed. A follow-up issue moves them with the four tunables. |
| `BILLING_APP_NAME` specifically | Deprecated in place, not removed. Billing reads `config.app.name`. The descriptor's description gains a `DEPRECATED: superseded by config.app.name` prefix, and `saasaloy doctor` warns when the key is set. No descriptor schema change, so nothing collides with #160. |
| `<CAP>_PROVIDER` keys | They stay in `env`. ADR 0033 makes the runtime selection a deliberate decision, and reopening it is not this issue's work. |
| Dev origins and ports | Out of scope. `CORS_ORIGINS` in #153 covers the origins. The port trio 3000/3001/4000 is consumed by Node config files at build time, where a seventh literal costs less than a cross-package import in `astro.config.mjs`. |
| `saasaloy init` prompts | None. `{{PROJECT_NAME}}` substitution plus commented placeholders, matching every other base file. `doctor` flags an unedited placeholder. |
| Sequencing against #160 | Parallel, both branched from `main`. Whichever merges second rebases. The conflict surface is four known files: `packages/cli/src/lib/base.ts`, `AGENTS.md`, `.agents/skills/create-module/` and `.agents/skills/create-provider/`. |
| Workspace hygiene | `clean` script backed by an exact-pinned `rimraf`, cleaning `dist` and `*.tsbuildinfo` only. `test` on `node --test`. |

## Approach

### What this reuses

- **`modules/kv/files/src/index.ts`**'s `defineKv({ providers: [] })` is the registry shape `defineConfig({ sections: [] })` copies.
- **`packages/cli/src/lib/collisions.ts`** already refuses an `add` on a file collision and names both modules. The section guard is the same shape one level down.
- **`packages/cli/src/lib/doctor.ts`** already carries scaffolded-project checks. The placeholder check and the `BILLING_APP_NAME` warning are two more entries.
- **`packages/ui/src/content/landing.ts`** and **`content/errors.ts`** are already namespaced content catalogs. They keep their copy and take their ids and numbers from config.
- **The `{{PROJECT_NAME}}` substitution** in `packages/cli/src/lib/base.ts` already runs over base files; `packages/config/src/project.ts` is one more target.
- **`plugin-array`** exists and has a removal inverse. No new patch kind is needed.
- **`scripts/table-names.test.ts`** is the shape of any repo-level guard this adds.

### Phase 1: `packages/config` in the base

Scaffold `packages/cli/templates/base/packages/config/`.

- `src/define.ts` — `defineConfig({ sections })`, the shallow-per-section merge, `Object.freeze` on the result, and the deep-partial type helper.
- `src/sections.ts` — the `sections: []` array literal, the `plugin-array` patch point. The base seeds the `app` and `plans` sections.
- `src/project.ts` — the one file a project owner edits. Seeded with `name: "{{PROJECT_NAME}}"` and comments naming what belongs here and what belongs in `.env`.
- `src/index.ts` — composes and exports the frozen `config` and its inferred type.
- `package.json` with the exact-pinned `rimraf` `clean` and `test` on `node --test`, plus a `tsconfig.json`.

The base `app` section carries `name`, `locale`, `legal.termsPath` and `legal.privacyPath`. The base `plans` section carries the tier ids and display names only.

Verification: `node --test` over the merge, the freeze, the leaf-replace rule and the array-replaced-whole rule. `pnpm lint`. A `.dev` scaffold typechecks.

### Phase 2: the base moves in

- `packages/ui` gains `@repo/config` as a `workspace:*` dependency.
- `packages/ui/src/index.ts`'s `siteName` re-exports `config.app.name` and keeps its name, so no consumer changes.
- `landing.ts`'s `currencySymbol` moves to `config.app`, and its tier ids and names come from `config.plans`. The copy stays in `content/`.
- `Layout.astro` reads `config.app.locale` in place of the hardcoded `lang="en"`.
- `privacy.astro`, `terms.astro` and `blocks/footer.tsx` read the legal paths in place of their hardcoded `/terms` and `/privacy`.

Verification: `pnpm lint`, and a `.dev` scaffold whose landing page, footer and legal pages render unchanged with `{{PROJECT_NAME}}` set.

### Phase 3: the first two module sections

Each module gains `src/config.ts` and one `plugin-array` patch appending it, beside the provider patch it already ships.

- **`auth`** contributes `config.auth` with `adminRole` and `superadminRole`. `modules/auth/files/src/authorize.ts` reads them, and `modules/admin/files/src/lib/auth.ts` stops redeclaring them. `admin` already declares `dependsOn: ["api", "auth"]`, so no dependency changes.
- **`billing`** contributes `config.billing` with `appName`, defaulting to `config.app.name`. `billing-store.ts` reads it and the `?? "your app"` fallback goes away. `modules/billing/files/src/plans.ts` takes its ids and names from `config.plans`; the Stripe price ids stay where they are.

Two sections from two modules prove the patch point and the collision guard against real descriptors.

Verification: `pnpm lint`, and a `.dev` scaffold with `auth`, `admin` and `billing` added that typechecks and boots. A rename in `project.ts` changes the name in every billing email.

### Phase 4: the guards

- The `add`-time section collision check in the CLI, refusing the `add` and naming both modules.
- `saasaloy doctor`: warn when `config.app.name` is still the literal `{{PROJECT_NAME}}`, when `astro.config.mjs`'s `site` is still `example.com`, and when `BILLING_APP_NAME` is set in a `.env`.
- `modules/billing/registry-item.json`: the `DEPRECATED: superseded by config.app.name` prefix on that key's description.

Verification: the CLI suite, including a fixture where two descriptors claim the same section key.

### Phase 5: the record

- ADR: `config` versus `env`, one rule, plus the two-deployments test and the reason `config` takes neither providers nor drivers.
- The `saasaloy-config` skill: adding a section, what belongs in `config` against `.env`, the merge rule, and the numbers-versus-sentences split against `@repo/ui/content`.
- `CONTEXT.md` entries for *section*, *project override*, and *config* itself.
- `AGENTS.md`: the config rule beside the capability rules. `create-module` and `create-provider` gain the section step.
- File the follow-up issue: move the four env keys and the seven tunables into sections.

## Open questions

None blocking. Two to watch during the build.

- **The rebase against #160.** Four files are known to conflict. Rebase between phases rather than at the end, so the conflict stays small whichever branch merges first.
- **`config.plans` as a base section.** The base seeds ids and names for tiers the project may not sell, and `billing` reads them. If a project's tiers diverge far from `free`/`pro`/`enterprise`, the base's seed becomes noise. Watch it in Phase 3 against a real scaffold.

## Non-goals

- Moving the four misplaced env keys (`BILLING_APP_NAME`, `BILLING_LOCKOUT_DAYS`, `FLAGS_ISOLATE_TTL_SECONDS`, `STORAGE_MAX_UPLOAD_BYTES`). A follow-up issue, filed in Phase 5.
- Moving the seven leaf-file tunables (`storage`, `feature-flags`, `ratelimit`, `api-keys`, `admin` page size, billing lockout and cron). Same follow-up.
- Moving any `<CAP>_PROVIDER` key out of `env`. ADR 0033 stands.
- A runtime override channel. A value that needs to change per deployment is an `env` value by definition, and adding an override path would make `config` a second `env`.
- Schema validation of config values.
- A `saasaloy config` CLI command, or an `init` prompt. The project edits one file.
- The dev origins and the port trio.
- Unifying marketing prices with Stripe prices. Ids and names only.
- i18n. `config.app.locale` is one string; translation is [#73](https://github.com/mimukit/saasaloy/issues/73).
- A config UI in `admin`.
