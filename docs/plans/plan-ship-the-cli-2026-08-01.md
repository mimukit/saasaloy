# Plan — Ship the CLI: npm publish, CI, and a real lint gate

> Tracked in [#46](https://github.com/mimukit/saasaloy/issues/46) (single issue — all phases folded).

## Context

The README's headline instruction is `saasaloy init my-app`. **Nobody on earth can run it.**
`packages/cli/package.json` is `"version": "0.0.0"` and has never been published — no git tags, no
`CHANGELOG.md`, no `publishConfig`, no `prepublishOnly`, and none of the `repository`/`homepage`/
`bugs`/`keywords` fields that make an npm page legible. The distribution mechanism this entire
product depends on — shadcn-style `npx <tool> add <thing>` — does not exist.

Two supporting gaps compound it:

- **There is no `.github/` directory at all.** No workflows, no issue templates. `pnpm test`,
  `pnpm typecheck`, `pnpm build`, and `pnpm deps:check` all exist and *nothing runs them on a pull
  request*. Every merge to date has been gated only by whatever the author ran locally.
- **`pnpm lint` is a silent no-op.** `turbo.json` declares a `lint` task with an empty body and
  `packages/cli/package.json` has no `lint` script, so the command exits 0 having linted nothing.
  `CONTRIBUTING.md` also states "We use changesets for managing releases" — there is no
  `.changeset/` directory and the package is not installed. The claim is aspirational.

Two facts verified while drafting (2026-08-01): the npm name **`saasaloy` is available**
(`registry.npmjs.org/saasaloy` → 404), and **`saasaloy.dev` does not resolve in DNS** — the domain
in every descriptor's `$id` and `$schema` is currently vapor.

**Success:** a stranger runs `npx saasaloy init my-app` on a clean machine and gets a working
scaffold; every pull request is gated by lint + typecheck + test + build; and cutting a release is
merging one automatically-authored PR.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Scope** | Publish + CI + lint only. The `saasaloy.dev` docs site and module gallery are **parked** — they're a product, not release engineering, they share no code with this work, and bundling them would hold the npm publish hostage to a design project. Revisited in its own session. |
| **Release mechanism** | **Changesets.** `CONTRIBUTING.md` already promises it, so adopting it makes an existing public claim true rather than requiring a retraction. It generates `CHANGELOG.md` and a "Version Packages" PR, which is the missing piece — a tag-driven `npm version` flow would be marginally simpler for one publishable package but leaves the changelog manual. |
| **Linter** | **Ultracite** (`ultracite@7.9.4`) configured for the **oxlint + oxfmt** toolchain — its published `peerDependencies` are `oxlint ^1.0.0` and `oxfmt >=0.1.0`. It ships framework presets for `astro`, `react`, `tanstack`, and `vitest`, which is exactly this repo's stack, and it is monorepo-aware. Rust-based, so it stays fast as `modules/` grows. Rejected ESLint (heavier dep tree, more config for a repo this size) and a bare oxlint config (Ultracite's preset is the value). |
| **First published version** | **`0.1.0`.** Pre-1.0 signals honestly that the applier is still moving (`remove`, `update`, and reverse-patches are unbuilt), while `0.0.x` reads as abandoned. |
| **Publish authentication** | **npm trusted publishing via OIDC** — the release workflow requests `id-token: write` and publishes with no long-lived `NPM_TOKEN` secret in the repo. Consistent with the supply-chain posture already encoded in `pnpm-workspace.yaml` (`minimumReleaseAge: 4320`, `allowBuilds` allow-listing). Requires one-time configuration on npmjs.com — see Open questions. |
| **Build-on-publish** | A `prepublishOnly` script in `packages/cli` runs `tsup`, so `npm publish` can never ship a stale or absent `dist/`. Today nothing forces a build before packing. |
| **What CI gates** | `lint`, `typecheck`, `test`, and `build` on every pull request. `deps:check` is included but its failure semantics need a decision — see Open questions. |
| **Node version** | Single source of truth. Today `.nvmrc` says `v24.18.0`, root `engines.node` says `>=24.0.0`, and `packages/cli/engines.node` says `>=24.13.0` — three different floors. CI reads `.nvmrc`; the published package keeps the *lowest* floor it genuinely supports. |
| **Template files stay unlinted** | `packages/cli/templates/base/**` is shipped *asset* code, not repo source — generated projects get their own toolchain. Ultracite ignores it. |
| **README corrections ride along** | The README advertises `saasaloy sync`, which ADR 0007 and `CONTEXT.md` record as deliberately removed ("Avoid (superseded)"), and calls Postgres "coming soon" while `plan-phase-3-modules-2026-07-22.md` lists Postgres/multi-cloud as explicitly **cut**. Both are front-page distribution material, so they're fixed here rather than tracked separately. |

## Approach

Sequenced so the riskiest unknown (does the packed tarball actually work?) is provable at the end of
Phase 1, before any automation is built on top of it.

### Phase 1 — Make the package publishable

The smallest change that turns `packages/cli` into a thing npm can serve.

- Bump `version` `0.0.0` → `0.1.0`.
- Add `repository` (with `directory: "packages/cli"`), `homepage`, `bugs`, `keywords`, and
  `publishConfig.access: "public"`.
- Add `"prepublishOnly": "tsup"` so `dist/` is always fresh at pack time.
- **Verify the `files` array is honest.** It lists `dist`, `templates`, `schemas/*.schema.json` —
  confirm with `npm pack --dry-run` that `templates/base/**` (the entire `init` payload) and all
  four schemas are actually in the tarball. A missing template directory is the single most likely
  way the first publish ships broken.
- Reconcile the three Node floors into one deliberate choice.
- Fix the README's `saasaloy sync` and Postgres claims.
- **Prove it by hand before automating:** `npm pack`, install the tarball into a throwaway directory
  outside the repo, and run `saasaloy init` + `saasaloy add api` against it. This is the first time
  the shipped artifact will have ever been exercised.

### Phase 2 — Ultracite (oxlint + oxfmt)

Turn `pnpm lint` from a no-op into a gate.

- Run `ultracite init --linter oxlint` at the repo root, selecting the `astro`, `react`, `tanstack`,
  and `vitest` presets.
- **Allow the Rust binaries to install.** pnpm 11 blocks all postinstall scripts by default and
  `pnpm-workspace.yaml`'s `allowBuilds` currently permits only `esbuild`. `oxlint` and `oxfmt` ship
  platform binaries and will need entries, or installs will silently produce a non-functional
  linter.
- Pin exact versions (`saveExact`) and respect the 3-day `minimumReleaseAge` cooldown like every
  other dependency in the repo.
- Add a real `lint` script to `packages/cli/package.json` so `turbo run lint` stops being a no-op,
  plus `lint:fix`/`format` for local use.
- Exclude `packages/cli/templates/base/**` from linting.
- Land the resulting autofix diff as its own commit, separate from the config, so the config change
  stays reviewable.

### Phase 3 — CI on pull request

The first `.github/` content this repo has ever had.

- `.github/workflows/ci.yml`, triggered on `pull_request` and on push to `main`.
- `pnpm/action-setup` + `actions/setup-node` reading the Node version from `.nvmrc`, with pnpm store
  caching.
- Run `lint`, `typecheck`, `test`, `build` — through Turbo so its cache does the deduplication.
- `concurrency` with `cancel-in-progress` so superseded pushes don't burn minutes.
- Note that `engineStrict: true` is already set, so a CI Node/pnpm mismatch fails loudly rather than
  producing a confusing downstream error.

### Phase 4 — Release automation via changesets

- Install `@changesets/cli` and run `changeset init`.
- Configure `.changeset/config.json` to ignore the private root package (`saasaloy-cli`) — only
  `saasaloy` is publishable.
- `.github/workflows/release.yml` using `changesets/action`: on merge to `main`, either open/update
  the "Version Packages" PR, or — when that PR merges — publish to npm.
- Grant `id-token: write` for OIDC trusted publishing; no `NPM_TOKEN` secret.
- Confirm `CHANGELOG.md` generates, and update `CONTRIBUTING.md` so its changesets claim is now
  accurate (including how a contributor adds a changeset to their PR).

### Phase 5 — Release smoke gate

The guard that Phase 1's manual check becomes permanent.

- A job that packs the CLI, installs the tarball into a clean temp directory *outside* the workspace
  (so it can't accidentally resolve workspace files), and runs `saasaloy init` followed by
  `saasaloy add api` against the real remote registry.
- Asserts the generated project installs and typechecks — reusing the shape of the existing
  `deps:verify` script rather than inventing new infrastructure.
- **Seam with Thread B:** this overlaps the end-to-end harness planned for applier trust. Whether it
  lives here or is contributed by that plan is an open question; it must exist before the first
  publish either way.

## Open questions

Targets for grillkit before this is filed as issues.

- **npm identity.** Who owns the npm account or org? Trusted publishing needs one-time setup on
  npmjs.com (linking the repo + workflow), which is outside this repository and can't be done by a
  code change. Is there a fallback if that setup isn't available?
- **Unscoped or scoped?** `saasaloy` is available unscoped. Is `@saasaloy/cli` preferable for a
  future multi-package story, at the cost of a less quotable install command?
- **Alpha channel.** Should the first releases go out under a `next` dist-tag as
  `0.1.0-alpha.0` while `remove`/`update` are still unbuilt, so `npm install saasaloy` doesn't hand
  a stranger a half-finished applier?
- **`deps:check` in CI.** `AGENTS.md` calls it "the read-only CI gate", but it exits non-zero on
  dependency drift that is the *maintainer's* job to fix on their own schedule — which would redden
  unrelated contributor PRs. Should it gate PRs, or run on a schedule and open an issue instead?
- **Where the smoke test lives** — Phase 5 here, or inside Thread B's e2e harness.
- **Publishing cadence.** Does every merged PR with a changeset cut a release, or do releases get
  batched behind a manual trigger while the API is this unstable?

## Non-goals

- **`saasaloy.dev`** — the docs site, module gallery, and hosting the schema `$id` URLs. Parked by
  decision; it is a separate plan.
- **The e2e / integration test suite and the conflict matrix** — Thread B (applier trust).
- **Publishing modules to npm.** The repo *is* the registry (ADR 0012); only the CLI is a package.
- **Postgres / multi-cloud** — remains cut per `plan-phase-3-modules-2026-07-22.md`. This plan only
  fixes the README so it stops claiming otherwise.
- **Any change to applier behavior.** Packaging, CI, and lint config only.
