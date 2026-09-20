# 0039 — `config` owns checked-in values, `env` owns per-deployment ones

A scaffolded project has two channels for a value it does not want to write twice. `env` owns values the platform supplies per deployment, secret or not. `config` owns values checked into the repo and identical in every deployment. `config` takes neither providers nor drivers, because it wraps no external service. Settled while planning `docs/plans/0059-plan-config-capability-2026-09-20.md`.

## Status

accepted.

## Context

Before this record the base template had exactly one project-level constant, `siteName` in `packages/ui/src/index.ts`. Everything else a project owner would set once was either a literal inside the file that used it, or an env var doing a job env vars are wrong for. A survey of `templates/base/**` and `modules/*/files/**` found three duplications that nothing reconciled.

The product name existed three times: `siteName`, the `BILLING_APP_NAME` env var with its `?? "your app"` fallback, and an `appName` prop every email and SMS template demanded with no project-level source. A rename fixed one and missed two.

`ADMIN_ROLE` and `SUPERADMIN_ROLE` were written twice, in `packages/auth/src/authorize.ts` and in `apps/admin/src/lib/auth.ts`. The second copy existed for a real reason — a browser bundle cannot import `@repo/auth/server` — and the two files carried comments telling the reader to change both.

Pricing existed twice with no shared ids, in `packages/ui/src/content/landing.ts` and `packages/billing/src/plans.ts`. An id or a display name could drift between the page that sold a plan and the code that charged for it, and nothing would fail.

## Decision

- **The rule.** `env` owns a value the platform supplies at runtime and that may differ between deployments. `config` owns a value checked into the repo that is the same in every deployment.
- **The test.** Two deployments of the *same* project. If the value can differ between them, it is `env`. If it cannot, it is `config`. A value that differs between two *different* projects but not between one project's environments is `config`.
- **`config` takes neither providers nor drivers.** ADR 0033 asks who owns the data and whether a swap moves it; ADR 0037 asks whether an alternate implementation replaces files or adds one. Both questions presume an external service, and `config` wraps none. There is no `CONFIG_PROVIDER`, and there never should be one.
- **`packages/config` ships in the base and is the leaf of the graph.** It has zero runtime dependencies and imports nothing, `@repo/env` included. Everything may import it, which is the property the whole design rests on.
- **A frozen plain object, read with a plain import.** `import { config } from "@repo/config"`. No factory over `env`, no async, no I/O. `env` takes the environment in whole because a Workers binding only exists per request; a checked-in literal has no such constraint, and forcing the symmetry would buy nothing.
- **A module contributes a section.** The module ships one file into `packages/config/src/sections/<key>.ts` and registers it with a `plugin-array` patch into `defineSections({ sections: [] })` in `packages/config/src/sections.ts` — the same registry shape `defineKv` uses for providers. The section key is the module name, it is flat, and `saasaloy add` refuses two modules claiming one key, naming both.
- **One override file.** `packages/config/src/project.ts` is the only file a project owner is expected to edit, and it is declared a seed file so `update` never rewrites it. The reason is ADR 0034, not ergonomics: a section file is module-owned and an update may rewrite it, so an owner's edit there would be lost.
- **The merge is one level below the section.** `project.ts` replaces a leaf value; a nested record or an array is replaced whole. One sentence describes the whole rule.
- **`typecheck` is the only validation.** The values are literals in the repo, so a wrong one is a review problem rather than a runtime one. This is the sharpest difference from `env`, which validates because its values arrive from outside.

## Why a section file lives in `packages/config`, not in the capability

The plan first put a section at `packages/<cap>/src/config.ts` and imported it into the registry. That inverts the leaf: `@repo/config` would depend on `@repo/auth`, while `packages/auth/src/authorize.ts` reads `config.auth.adminRole` — a package cycle, and a cycle in the turbo task graph.

So the module ships its section into the config package instead, as one more module-owned file under `src/sections/`, and reaches the helper by package subpath (`@repo/config/define`) rather than by relative path. The module still owns the file in the manifest, `remove` still deletes it, and the patch point is unchanged.

## The section key is read off the patch

`saasaloy add` has to refuse two modules claiming one key before it writes, and it has to do so from the descriptors alone, with no project code loaded. The key is therefore the basename of the section patch's `import.from`: `./sections/auth` claims `config.auth`. No descriptor field says it a second time, and nothing can disagree with the file the module ships.

Unlike a file target, a section key has **no** legal overlap. Two modules writing one file is legal when one declares the other in `dependsOn` (ADR-level rule in `lib/collisions.ts`), because that edge is consent. A section key composes into one object, so the second claimant either loses its values or throws at module load, and `dependsOn` cannot consent to that.

## Nothing here is breaking

No env key is removed. `BILLING_APP_NAME` is deprecated in place: billing reads `config.billing.appName || config.app.name`, the descriptor's description gains a `DEPRECATED` prefix, and `saasaloy doctor` reports the key when a `.env` or `.dev.vars` still sets it. `BILLING_LOCKOUT_DAYS`, `FLAGS_ISOLATE_TTL_SECONDS` and `STORAGE_MAX_UPLOAD_BYTES` stay in `envVars` for now; a follow-up moves them with the leaf-file tunables.

## Consequences

- A project owner has one file to edit for a rename, and the product name, the role strings and the tier ids each have one home.
- A capability author learns one placement rule for a default: the section file, beside the `env` plan's preset rule.
- `@repo/config` must stay import-free. A value derived from both channels is derived at the call site, which is why `apps/api/src/billing-store.ts` and not a section file applies the `config.billing.appName || config.app.name` fallback.
- A module that reads `config` in a file this repo unit-tests needs the composed object, which does not exist outside a scaffolded project. `scripts/config-shim.ts` builds it from the template's sections plus every module's, and `scripts/ts-resolve-hook.ts` maps the `@repo/config` specifier onto it. That shim composes *every* module's section, so a key collision fails `pnpm test` too.
- `doctor` now reports an unedited `site: "https://example.com"` in `apps/web/astro.config.mjs`. A freshly scaffolded project therefore has one finding until its owner sets the origin, and `doctor` exits 2. That is deliberate: the value is wrong in every deployment until somebody changes it.
