# Plan: A release step with a changelog and a version before each production deploy

Not grilled. Drafted: 2026-10-23. Issue: #236. Depends on #234 (plan 0077, the gated production deploy).

## Context

A generated project needs a changelog and a release version for each production deploy. Nothing is published to npm. The owner settled the design on 2026-10-23:

- `pnpm release` runs release-it before the deploy, on `main` or a `hotfix-*` branch. It bumps the root `package.json` version, writes `CHANGELOG.md`, commits `chore(release): v${version}`, tags `v${version}`, pushes, and creates a GitHub Release.
- `pnpm deploy:production` stays a separate step and keeps all its gates. The release commit is clean, pushed and CI-green, so the gates pass on it.
- The `deploy-<UTC time>` tag stays. `v*` names the release, and `deploy-*` records when it went live.
- The deploy tag message names the version. The deploy warns, and never refuses, when no release exists since the last deploy tag.
- The deploy runbook and the deploy skill document the release step.

It belongs in the base, beside the gated deploy, not in a module. It has no runtime code, no env keys and no provider choice, and it must agree with the deploy's branches, tags and gates.

primeshopr builds it first and runs a few real releases. The base copies the proven files afterwards. primeshopr's work is uncommitted today: `.release-it.json`, root `release` and `release:dry` scripts, `release-it` 21.0.2 and `@release-it/conventional-changelog` 12.0.0 as devDependencies, and a `releaseWarning` plus a version in the tag message in `scripts/deploy-production.ts`.

This is its own plan, not part of plan 0077, because #234 is already in progress in its own worktree. The release step builds on the engine #234 adds (`packages/tooling`, the `saasaloy-deploy` skill, `docs/runbook-deploy.md`, ADR 0048), so it waits for #234 to merge.

Success: a new project runs `pnpm release:dry` and sees the next version and the changelog entry. `pnpm release` then `pnpm deploy:production` writes a `v*` tag and a `deploy-*` tag whose message names that version. A release does not put the root `package.json` in the next `saasaloy update` merge plan.

## Findings

| # | Finding | Evidence |
|---|---------|----------|
| 1 | The base has no release step | The base root `package.json` has `"version": "0.0.0"`, no `release` script and no release-it. |
| 2 | A shape to copy exists | saasaloy's own `packages/cli/.release-it.json`. The project copy drops npm publish, the preflight hook and `ignoreRecommendedBump`, and adds `requireBranch: ["main", "hotfix-*"]`, as primeshopr's does. |
| 3 | A release marks the root `package.json` as edited | `lib/base.ts` hashes each managed file whole. After the first version bump, every later base change to the root `package.json` goes to the merge plan. |
| 4 | Lint and commit hooks need no change | The base `_prettierignore` lists `**/*.md`, so `CHANGELOG.md` is not formatted. The base `commitlint.config.js` has no `scope-enum`, so `chore(release)` passes. |
| 5 | primeshopr's warning differs from the agreed rule | primeshopr warns when HEAD has no `v*` tag (`git describe --exact-match`). The agreed rule warns when no `v*` tag exists since the last `deploy-*` tag. They differ when a commit lands between the release and the deploy. |

## Design decisions (proposed, for the grill)

| Decision | Proposal |
|----------|----------|
| Release tool | release-it with `npm.publish: false` and `@release-it/conventional-changelog` (preset `conventionalcommits`, infile `CHANGELOG.md`, header `# Changelog`). Root scripts `release` and `release:dry`, with the `GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}"` prefix saasaloy uses. Both packages are exact-pinned root devDependencies, kept fresh by `pnpm deps:update`. Rejected: a module (no runtime code, no env keys, no provider choice); changesets (it versions per package and assumes publish). |
| Release config | `.release-it.json` at the root, a managed base file: `requireBranch`, `requireCleanWorkingDir`, `requireUpstream`, `requireCommits`, commit message `chore(release): v${version}`, tag `v${version}`, `github.release: true`. It sits at the root because release-it reads it there and a developer runs `pnpm release` from there. |
| Release and deploy link | The deploy engine in `packages/tooling` reads the `v*` tag and names it in the tag message and the run output: `Production deploy of abc1234 (v0.3.0): api, admin, web.` It warns when no release exists since the last deploy tag, so a hotfix never waits on the changelog. |
| `CHANGELOG.md` | Not shipped by the base, not a seed. release-it creates it on the first release, and the project owns it from then on. `update` never names it. |

## Approach

### Phase 1: proof in primeshopr

Entry condition for Phase 2. primeshopr commits its release work and runs at least two real releases, one from `main` and one from a `hotfix-*` branch, each followed by a deploy. Record here what changed in its files after each run. The proven files are the source for Phase 2, not saasaloy's own `.release-it.json`.

### Phase 2: decisions on record

1. Grill this plan (grillkit). Record the result at the top.
2. Amend ADR 0048 or write a new ADR for the release step and the warn-not-refuse rule.
3. Add `release` and `release tag` to `CONTEXT.md`.

### Phase 3: base files and the engine

1. Copy `.release-it.json` into the base template. Add `release` and `release:dry` to the root `package.json`, and pin `release-it` and `@release-it/conventional-changelog`.
2. Engine: port `releaseWarning` and the version argument of `tagMessage` with their tests, changed to the agreed rule. The dry run prints the release line.
3. Updater: the change the grill picks for the root `version` key (open question 3).
4. Check in `.dev`: `saasaloy init`, two `feat:` commits, `pnpm release:dry`. See the next version and the changelog entry. Make no GitHub Release from `.dev`.

### Phase 4: docs and skills

1. The `saasaloy-deploy` skill and `docs/runbook-deploy.md` put `pnpm release` before `pnpm deploy:production`, with the hotfix order.
2. Base `AGENTS.md` "Branches and deploys" names the `v*` tag beside the `deploy-*` tag.
3. `packages/cli/CHANGELOG.md` entry with the merge steps for an existing project.

### Phase 5: verification

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` in saasaloy.
2. In `.dev`: `pnpm deploy:production --dry-run` on a project with and without a release since the last deploy tag. See the release line and the warning.
3. In `.dev`: `saasaloy update` on a project made with the current base. Record which files land in the merge plan.
4. Release smoke (`pnpm release:smoke`).

## Files a generated project owns, or that `saasaloy update` puts in a merge plan

| File | Status in a project | What `update` does |
|------|---------------------|--------------------|
| `.release-it.json` | new, managed | created when absent. primeshopr has its own, so it lands in the merge plan when the two differ |
| root `package.json` scripts and devDependencies | managed | overwrite when unedited, merge plan when edited |
| root `package.json` `version` | changed by every `pnpm release` | today the whole file counts as edited after the first release. Open question 3 |
| `CHANGELOG.md` | not a base file | never touched |

## Non-goals

- npm publish, per-workspace versions, and a release run from CI. The version is one number for the whole project.
- A release gate in the deploy. The deploy warns only.

## Open questions

1. Start version for a new project. The base ships `0.0.0`, and a first `feat:` bumps it to `0.1.0`. Proposed: keep `0.0.0` in the template, so the first release is `0.1.0`. Decide whether a `BREAKING CHANGE` before 1.0 bumps the major, or only the minor.
2. The warning rule (finding 5). Proposed: the agreed rule, and the dry run also prints the commits after the release tag.
3. The root `version` key and `update`. Options: the updater ignores the `version` key when it hashes the root `package.json`; or the version lives in a file the project owns, written by `@release-it/bumper`. Proposed: the updater ignores `version`, because `package.json` is where release-it and every tool look.
4. Changelog sections. The `conventionalcommits` preset shows `feat`, `fix` and `perf`, and hides `chore`, `docs`, `refactor`, `test`, `ci`, `build` and `style`. Decide whether `perf` and `refactor` show, and whether `deps` bumps show.
5. How `saasaloy update` brings the files to an existing project. `.release-it.json` is new, so it is created when absent. The two devDependencies and the two scripts go into the root `package.json`, which is in the merge plan for most projects. Decide whether the merge plan names them as separate steps, and whether `saasaloy doctor` warns when `.release-it.json` exists without the scripts.
6. One branch list in two files. `requireBranch` in `.release-it.json` and the branches in `deploy.config.ts` must agree. Options: a `.release-it.ts` that imports the list (check that release-it 21 loads TypeScript config); or a `saasaloy doctor` check that compares them. Proposed: the doctor check, because JSON keeps the file simple.
7. A hotfix release. A `v0.3.1` tag on `hotfix-<slug>` writes `CHANGELOG.md` and the `version` on that branch. Merging back into `main` then conflicts in both files. Decide the merge-back rule, and whether the runbook shows the conflict.
8. The GitHub Release without `gh`. With no `GITHUB_TOKEN` and no `gh`, release-it falls back to a browser page, which hangs on a headless box. Proposed: the `release` script refuses with a message when neither is present.
9. Branch protection. release-it pushes the release commit straight to `main`, and a project that protects `main` refuses the push. Decide whether the runbook documents a bypass rule, or whether this is a known limit.
10. CI on the release commit. The push starts a new CI run, and the deploy CI gate waits for it. Decide whether `chore(release)` commits skip CI, or always run it. Proposed: always run it, so the gate rule stays one rule.
