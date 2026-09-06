# Plan: Manual semver release for the saasaloy CLI

Grilled: 2026-09-06

Supersedes the Changesets decision in [`plan-ship-the-cli-2026-08-01.md`](plan-ship-the-cli-2026-08-01.md) (Phase 4) and the release half of [#46](https://github.com/mimukit/saasaloy/issues/46). Tool choice is grounded in [`research-release-tooling-2026-09-06.md`](../research/research-release-tooling-2026-09-06.md).

## Context

`packages/cli` is the npm package `saasaloy`. It sits at `0.0.0`, has no tag, no `CHANGELOG.md`, and has never been published. The README's headline command `npx saasaloy init my-app` cannot run, and the CLI's own `UPGRADE_COMMAND` (`pnpm add --global saasaloy@latest`) points at a package that does not exist. `docs/wiki/getting-started.md` still tells a reader to clone the repo and run `pnpm cli:link`.

The old plan chose Changesets and a GitHub Actions publish. Both are dropped. The maintainer wants to cut releases from a local machine with one command, after each merged pull request, with the version bump chosen by hand and the changelog written from the commits. CI stays a gate and never publishes.

**Success:** on `main`, after a PR merges, the maintainer runs `pnpm release`, picks the bump, and the command bumps `packages/cli/package.json`, prepends a section to `packages/cli/CHANGELOG.md`, commits, tags `vX.Y.Z`, pushes, creates a GitHub Release, and publishes to npm. A stranger then runs `npx saasaloy init my-app` and gets a working scaffold.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Release tool** | **release-it** with `@release-it/conventional-changelog`, run locally. No GitHub Actions publish, no OIDC, no bot commits. The research report compares semantic-release, release-please, and Changesets; all three exist to automate a merge-triggered release, which is the thing the maintainer does not want. |
| **Bump selection** | **Always prompt.** `ignoreRecommendedBump: true`, so release-it asks for patch, minor, or major on every run. The plugin still writes the changelog from the commits. The maintainer applies the 0.x rule by hand: before 1.0 a breaking change is a **minor** bump, `feat` is minor, `fix` and `perf` are patch. 1.0.0 is a deliberate choice, never an accident. |
| **Release cadence** | One release after each merged PR that touched `packages/cli/**` (source, templates, or schemas). A PR that only touched `modules/**` needs no release, because the CLI fetches the registry from the repo at run time. A PR with only `docs`, `chore`, or `refactor` commits gets no release. CONTRIBUTING.md states all three rules. Nothing enforces cadence; the maintainer runs the command. |
| **Where it runs** | From `packages/cli`, on a `main` checkout, never a worktree. Config lives in `packages/cli/.release-it.json`; `release-it` and the plugin are exact-pinned devDependencies of `packages/cli`. Root `package.json` gets `release` and `release:dry` scripts that call `pnpm --filter saasaloy run <script>`. Git tags are repo-wide, so the tag lands at the repo root as `vX.Y.Z`. The private root package stays at `0.0.0` forever; no script reads it. |
| **Tag format** | `v${version}`, one series for the one publishable package. |
| **Changelog** | `packages/cli/CHANGELOG.md`, `conventionalcommits` preset, header `# Changelog`. The preset's defaults show `feat`, `fix`, `perf`, and `revert` and hide `docs`, `style`, `chore`, `refactor`, `test`, `build`, and `ci`, so no `types` override is needed. Markdown is Prettier-ignored (`.prettierignore`), so the release commit passes `lint-staged` and CI's `format:check` untouched. |
| **First release** | **0.1.0** on the `latest` dist-tag. A seed tag `v0.0.0` is pushed on the current `main` head before the first run, so the first changelog section covers the release PR and not all 623 prior commits. The Phase 1 PR carries a `feat(cli): publish saasaloy to npm` commit, so the 0.1.0 section gets its headline line from the commits with no hand edit. release-it has no pause between the changelog write and the commit, so a hand edit is not a step. |
| **Release commit** | `chore(release): v${version}`. Type `chore` passes commitlint and is hidden from the next changelog. |
| **GitHub Release** | Yes. release-it reads `GITHUB_TOKEN` from the shell; the documented invocation is `GITHUB_TOKEN=$(gh auth token) pnpm release`. Release notes are the same changelog section. |
| **npm auth** | Local `npm login` with 2FA. release-it runs `npm whoami` and `npm ping` before it writes anything and prompts for the OTP at publish time. No token in the repo, no provenance (provenance needs a CI OIDC run, and CI does not publish). |
| **Preflight** | One `before:init` hook: `pnpm -w run release:preflight`, backed by `scripts/release-preflight.ts`. It checks that local `main` equals `origin/main`, then re-runs the full CI gate (`lint`, `typecheck`, `test`, `verify:content`), then runs the tarball smoke. Each failure prints a named message. It re-runs the gate rather than asking GitHub, so a release never depends on GitHub's view of CI. `SAASALOY_RELEASE_SKIP_GATE=1` skips the four gate scripts on a rerun after a transient failure; the staleness check and the smoke always run. The variable is the only way to pass a choice into a release-it hook, since hooks are fixed strings. `git.requireBranch: main`, `requireCleanWorkingDir`, `requireUpstream`, and `requireCommits` are on. |
| **Smoke registry** | The smoke script runs `saasaloy add api` with `SAASALOY_REGISTRY_DIR` pointed at the repo's `modules/`, so it needs no network and proves the tarball, not the remote fetch. The remote path is checked once by hand in Phase 4. |
| **`workspace:` guard** | The smoke script asserts the packed `package.json` contains no `workspace:` string. `npm publish` does not rewrite those ranges, so one such dependency would ship an uninstallable package. |
| **Module `requires.saasaloy`** | A CONTRIBUTING.md rule, no automated check. A PR that makes a module depend on a CLI change sets that module's `requires.saasaloy` to the version that ships the change, and the release for that PR is at least a minor. `cli-requires.ts` enforces the range fatally, so the rule is stated where module authors read. |
| **Failure after push** | release-it has no rollback. If `npm publish` or the GitHub Release fails after the commit, tag, and push exist, the maintainer fixes the cause and runs `npm publish` by hand in `packages/cli` (`prepublishOnly` rebuilds `dist/`), then creates the GitHub Release by hand if needed. Never rerun `pnpm release` for the same version, and never rewrite pushed `main` history. |
| **Build before publish** | `"prepublishOnly": "pnpm run build"` in `packages/cli`, so `npm publish` can never ship a stale `dist/`. |
| **Publish command** | release-it's default `npm publish` from `packages/cli`. The package has no `workspace:` dependencies, so pnpm is not needed to rewrite the manifest. |
| **Second machine** | CONTRIBUTING.md names the only two pieces of machine state: `gh auth login` and `npm login`. |
| **Tracker** | Issue #46 is rewritten in place: new title `build(cli): publish saasaloy to npm with a manual release-it flow`, acceptance criteria from Phases 1, 2, 3, and 5, Phase 4 as a maintainer-only checkbox, priority `medium`. |

## Approach

release-it does the sequence; this plan adds the package metadata, the proof that the tarball works, the config, and the docs. It **reuses** the existing CI gate (`ci.yml` and the root `lint`/`typecheck`/`test`/`verify:content` scripts) as the preflight, the git-ignored `.dev/` directory for scratch installs, `scripts/*.ts` with `node --test` for the new scripts (the `spawnSync` pattern in `scripts/verify-preset.ts`), the `SAASALOY_REGISTRY_DIR` override for an offline `add`, the `files` whitelist already in `packages/cli/package.json`, and `src/version.ts`, which reads the version from `package.json` at runtime so a bump needs no code change.

Rejected: semantic-release and release-please (merge-triggered automation the maintainer does not want); Changesets (file-based, batched, and a `major` changeset on 0.x yields 1.0.0); a hand-rolled `npm version` script (loses the changelog and the GitHub Release).

### Phase 1: Make the package publishable (built 2026-09-06)

The smallest change that turns `packages/cli` into something npm can serve. Carried over from the old plan's Phase 1 and still unbuilt.

- Add `repository` (`type: git`, `url`, `directory: "packages/cli"`), `homepage`, `bugs`, `keywords`, and `publishConfig.access: "public"` to `packages/cli/package.json`.
- Add `"prepublishOnly": "pnpm run build"`.
- Run `npm pack --dry-run` in `packages/cli` and confirm `dist/`, `templates/base/**`, and all four `schemas/*.schema.json` are in the file list. Fix the `files` array if anything is missing.
- Confirm `saasaloy --version` prints the `package.json` version from the packed layout (`src/version.ts` resolves `../package.json` from `dist/`).
- Land these as one commit titled `feat(cli): publish saasaloy to npm`, so the 0.1.0 changelog gets its headline entry.

### Phase 2: Tarball smoke script (built 2026-09-06)

The manual proof from the old plan, made repeatable and offline.

- Add `scripts/release-smoke.ts` and a root script `release:smoke`. It runs `npm pack` in `packages/cli`, unpacks the tarball into a fresh directory under `.dev/release-smoke/` (wiped first, outside any workspace `package.json`), installs it there, runs `saasaloy init smoke --no-install` and then `saasaloy add api` with `SAASALOY_REGISTRY_DIR` set to the repo's `modules/`, and asserts both exit 0 and the expected files exist.
- Assert the packed `package.json` contains no `workspace:` string.
- Reuse the `spawnSync` shape from `scripts/verify-preset.ts` rather than new process helpers.
- Add `node --test` cases for the argument parsing and the `workspace:` assertion, matching `test:scripts`.

### Phase 3: release-it configuration and preflight (built 2026-09-06)

- Add `release-it` and `@release-it/conventional-changelog` to `packages/cli` devDependencies, exact-pinned.
- Add `scripts/release-preflight.ts` and a root script `release:preflight`. In order: fetch `origin/main` and fail with a named message if local `HEAD` differs; run `lint`, `typecheck`, `test`, and `verify:content` unless `SAASALOY_RELEASE_SKIP_GATE=1`; run `release:smoke`. Each step prints which check failed and the command to rerun. Cover the flag and the staleness message with `node --test`.
- Write `packages/cli/.release-it.json`:

```json
{
  "git": {
    "requireBranch": "main",
    "requireCleanWorkingDir": true,
    "requireUpstream": true,
    "requireCommits": true,
    "commitMessage": "chore(release): v${version}",
    "tagName": "v${version}",
    "tagAnnotation": "Release v${version}"
  },
  "github": { "release": true, "releaseName": "v${version}" },
  "npm": { "publish": true },
  "hooks": {
    "before:init": ["pnpm -w run release:preflight"]
  },
  "plugins": {
    "@release-it/conventional-changelog": {
      "preset": { "name": "conventionalcommits" },
      "infile": "CHANGELOG.md",
      "header": "# Changelog",
      "ignoreRecommendedBump": true
    }
  }
}
```

- Add `"release": "release-it"` and `"release:dry": "release-it --dry-run"` to `packages/cli/package.json`. Add `"release": "pnpm --filter saasaloy run release"` and `"release:dry": "pnpm --filter saasaloy run release:dry"` to the root.
- Run `pnpm release:dry` on `main` and check the proposed commit, tag, changelog section, and publish target.

### Phase 4: First release (maintainer only)

Not agent work. Needs `npm login` and `gh auth login` on the release machine.

1. Push the seed tag: `git tag v0.0.0 <main head> && git push origin v0.0.0`.
2. Log in to npm with an account that has 2FA. Confirm with `npm whoami`.
3. On a clean `main` checkout, run `GITHUB_TOKEN=$(gh auth token) pnpm release`, pick **minor**, confirm each step, and enter the OTP when asked.
4. Verify from a clean directory outside the repo: `npx saasaloy@0.1.0 --version`, then `npx saasaloy init smoke` and `saasaloy add api` against the real remote registry.
5. If publish or the GitHub Release failed after the push, follow the recovery procedure in CONTRIBUTING.md. Do not rerun `pnpm release`.

### Phase 5: Docs and tracker (built 2026-09-06)

- **CONTRIBUTING.md.** Add a "Releasing" section with: who releases; the cadence rule (`packages/cli/**` changed, not `modules/**` only, not docs-only); the 0.x bump rule; the exact command; the `gh auth login` and `npm login` prerequisites, which are the only machine state; `SAASALOY_RELEASE_SKIP_GATE=1` and when it is acceptable; the module `requires.saasaloy` rule; and the numbered recovery procedure for a failure after push. Replace the sentence that says "there is no release process yet".
- **`docs/wiki/getting-started.md`.** Replace section 1 with `npm install -g saasaloy` / `pnpm add -g saasaloy` / `npx saasaloy init my-app`. Move the clone-and-link path to a "Contributing" note.
- **README.md.** Add the install line above the `saasaloy init my-app` example.
- **`plan-ship-the-cli-2026-08-01.md`.** Mark Phase 4 and Phase 5 as superseded by this plan, one line each.
- **Issue #46.** Rewrite in place per the Tracker decision.

## Open questions

None left open by the grill. Two facts to confirm during Phase 3, not decisions: that `npm publish` inside a pnpm workspace ignores `pnpm-lock.yaml` without a warning, and that release-it's `github.release` reads `GITHUB_TOKEN` when `gh` is also authenticated. Both have a one-line fallback (`npm.publishArgs`, `github.tokenRef`).

## Non-goals

- **Automated publish from GitHub Actions**, OIDC trusted publishing, and provenance attestations. CI stays a gate. The research report keeps the automated designs on file if this changes.
- **Automatic bump from commit types.** The maintainer picks the bump.
- **An automated check for module `requires.saasaloy` ranges.** A stated rule only.
- **Publishing modules to npm.** The repo is the registry (ADR 0012); only the CLI is a package.
- **The `saasaloy.dev` docs site** and the schema `$id` URLs. Parked, as before.
- **Branch protection on `main`.** Not needed for a local release and not touched here.
- **Any applier behaviour change.** Packaging, release config, and docs only.
