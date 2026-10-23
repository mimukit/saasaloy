# Plan: A release step with a changelog and a version before each production deploy

Grilled: 2026-10-23

Drafted: 2026-10-23. Issue: #236. Builds on #234 (plan 0077, the gated production deploy, merged in PR #235).

## Context

A generated project needs a changelog and a release version for each production deploy. Nothing is published to npm. The owner settled the design on 2026-10-23:

- `pnpm release` runs release-it before the deploy, on a branch the deploy allows (`main` or `hotfix-*` by default). It bumps the root `package.json` version, writes `CHANGELOG.md`, commits `chore(release): v${version}`, tags `v${version}`, pushes, and creates a GitHub Release.
- `pnpm deploy:production` stays a separate step and keeps all its gates. The release commit is clean, pushed and CI-green, so the gates pass on it.
- The `deploy-<UTC time>` tag stays. `v*` names the release, and `deploy-*` records when it went live.
- The deploy tag message names the version. The deploy warns, and never refuses, when HEAD is not a release commit.
- The deploy runbook and the deploy skill document the release step.

It belongs in the base, beside the gated deploy, not in a module. It has no runtime code, no env keys and no provider choice, and it must agree with the deploy's branches, tags and gates.

primeshopr builds it first and runs a real release. The base then builds the same behaviour in `packages/tooling`. primeshopr committed its release work in `0fff95b` and `ba4eb87`: a root `.release-it.json`, root `release` and `release:dry` scripts, `release-it` 21.0.2 and `@release-it/conventional-changelog` 12.0.0, and a release warning plus a version in the tag message in `scripts/deploy-production.ts`. On 2026-10-23 it has no `v*` tag, so no release has run yet.

This is its own plan, not part of plan 0077, because #234 was already in progress when the release step was designed.

Success: a new project runs `pnpm release:dry` and sees the next version and the changelog entry. `pnpm release` then `pnpm deploy:production` writes a `v*` tag and a `deploy-*` tag whose message names that version. A release does not put the root `package.json` in the next `saasaloy update` merge plan.

## Findings

| # | Finding | Evidence |
|---|---------|----------|
| 1 | The base has no release step | The base root `package.json` has `"version": "0.0.0"`, no `release` script and no release-it. |
| 2 | The engine has no release field yet | `tagMessage(head, options, services)` in `packages/tooling/src/deploy-production.ts` takes no version. `Facts` has no release field. The deploy tag prefix is the `tagPrefix` key in `deploy.config.ts`. |
| 3 | The root scripts point into `packages/tooling` | Plan 0077 settled `deploy:production` and `skills:link` as `node packages/tooling/src/<file>.ts` lines that never change. `release` takes the same shape. |
| 4 | A release marks the root `package.json` as edited | `lib/base.ts` hashes each managed file whole. After the first version bump, every later base change to the root `package.json` goes to the merge plan. |
| 5 | release-it facts | release-it 21 loads its config through `c12` and has a Node API. Its default `ci` is `ci-info`'s `isCI`, so outside CI it asks four questions. With no token, it warns and falls back to a web release page (`lib/plugin/github/GitHub.js`). The `conventionalcommits` preset reads `preMajor`, which turns a breaking change under 1.0 into a minor bump. |
| 6 | Lint and commit hooks need no change | The base `_prettierignore` lists `**/*.md`, so `CHANGELOG.md` is not formatted. The base `commitlint.config.js` has no `scope-enum`, so `chore(release)` passes. |
| 7 | primeshopr's warning matches the settled rule | primeshopr warns when HEAD has no `v*` tag (`git describe --exact-match`). The grill kept that rule (Q3). The agreed wording "no release since the last deploy tag" missed commits that land after the release. |

## Settled design decisions

| # | Decision | Settled | How |
|---|----------|---------|-----|
| Q1 | Where the release config lives | `packages/tooling/src/release.ts`, a managed wrapper. It calls the release-it Node API with options it builds from `deploy.config.ts`: `branches` for `requireBranch`, and a `release` block for the rest. There is no `.release-it.json`. The branch list has one source. Rejected: a managed root `.release-it.json` (the branch list in two files, an edited copy in the merge plan); an owned one (a base fix never reaches a project). | asked |
| Q2 | `update` and the root `version` key | The updater hashes the root `package.json` with `version` set to the template value, and on overwrite it writes the project's version back. This is one key in one file, and it amends the hash rule of ADR 0034. Rejected: an owned version file via `@release-it/bumper`; no change. | asked |
| Q3 | When the deploy warns | When HEAD is not a release commit. The message tells two cases apart: no `v*` tag since the last deploy tag, or N commits after the newest `v*` tag. The dry run lists those commits. The deploy never refuses on this. | asked |
| Q4 | primeshopr proof | One release from `main`, followed by one deploy. The hotfix release path stays unproven until a real hotfix, and the runbook says so. | asked |
| Q5 | Start version | The template keeps `0.0.0`. `preMajor: true`, so the first `feat:` makes `0.1.0` and a break under 1.0 bumps the minor. `1.0.0` is a release the owner chooses with `pnpm release major`. | asked |
| Q6 | Changelog sections | The preset default: `feat`, `fix`, `perf` and `revert` show, the rest hide, and dependency bumps hide with them. `release.changelogSections` overrides it. | defaulted |
| Q7 | No token | `release.ts` reads `GITHUB_TOKEN`, then `gh auth token`. With neither, and `githubRelease` on, it refuses before it bumps anything and names both fixes. The web fallback waits on a page that no one opens on a headless box. | defaulted |
| Q8 | CI on the release commit | CI always runs on it, and the deploy CI gate waits for it. The gate stays one rule. | defaulted |
| Q9 | Hotfix merge-back | Merge the hotfix branch into `main`, never rebase it, because a rebase rewrites the commit the `v*` tag names. The runbook shows the `CHANGELOG.md` and `version` conflict and keeps both changelog entries. | defaulted |
| Q10 | ADR | A new ADR 0049, "A release names each production deploy", citing 0048 and 0034. ADR 0048 is accepted and stays as it is. | defaulted |
| Q11 | Questions during a run | `release.ts` runs release-it with `ci: true` and never asks. It prints the version and the changelog entry before it commits. `pnpm release:dry` is the preview. The `saasaloy-deploy` skill gives an agent the deploy rule: it runs `pnpm release` only after the owner says so in the same session. | asked |
| Q12 | Where the proof lives | A primeshopr issue for the first release. #236 stays `blocked`, with a body line that links that issue, because GitHub records no dependency on an issue in another org. The owner promotes #236 when the primeshopr issue closes. | asked |
| Q13 | Outward actions approved | The publish step: commit and push this plan to `main`, update the #236 body and labels, and file the primeshopr issue. An agent may also run `pnpm release` in primeshopr for that issue, which pushes a `v*` tag and creates a GitHub Release there. The build of #236 opens its own PR. | asked |
| Q15 | Where the pins live | `release-it` and `@release-it/conventional-changelog`, exact-pinned in `packages/tooling` `dependencies`, kept fresh by `pnpm deps:update`. The wrapper imports them, and a workspace owns its vendor packages (ADR 0020). | defaulted |
| Q16 | Root scripts | `"release": "node packages/tooling/src/release.ts"` and `"release:dry": "node packages/tooling/src/release.ts --dry-run"`. No shell prefix, so the lines work on every platform and never change. | defaulted |
| Q17 | Version override | `pnpm release minor`, `major` or `1.2.3` goes to release-it as the increment. | defaulted |
| Q18 | The `release` block | `release: { tagPrefix: "v", githubRelease: true, preMajor: true, changelogSections: undefined }` in `deploy.config.ts`. A missing block or key falls back to the default, because `update` never adds the block to an existing project's owned file. | defaulted |
| Q19 | `update` for an existing project | `release.ts` arrives as a new managed file. The `packages/tooling` pins overwrite when that `package.json` is unedited. The two root scripts go through the root `package.json` merge plan. `saasaloy doctor` warns when `release.ts` exists and the root `release` script does not. | defaulted |
| Q20 | Tests | Vitest in `packages/tooling`, as for the deploy engine. Tests cover the options built from the config, the token check, the warning text and the tag message. No test makes a git or network call. | defaulted |

## Approach

### Phase 1: proof in primeshopr

Attended: the owner, or an agent the owner names, runs the first primeshopr release. The primeshopr issue tracks it, and #236 stays `blocked` until it closes.

1. In primeshopr, on `main`: `pnpm release:dry`, then `pnpm release`, then `pnpm deploy:production`.
2. Record in this plan: the version, the `CHANGELOG.md` entry shape, the deploy tag message, and every file primeshopr changed to make the run pass.

Done when: primeshopr has one `v*` tag, one GitHub Release and one `deploy-*` tag whose message names the version, and this plan records the run.

#### Phase 1 record (2026-10-23, primeshopr issue brainaloylabs/primeshopr#87)

An agent ran the release, and the deploy after the owner's go-ahead in the same session.

| Step | Result |
| --- | --- |
| `pnpm release:dry 0.1.0 --ci` | `0.0.0...0.1.0`, with `WARNING The recommended bump is "major", but is overridden with "0.1.0".` |
| `pnpm release 0.1.0 --ci` | Commit `c75d4e1` `chore(release): v0.1.0` (root `package.json` and `CHANGELOG.md`), annotated tag `v0.1.0` with the message `Release v0.1.0`, push, and the GitHub Release [v0.1.0](https://github.com/brainaloylabs/primeshopr/releases/tag/v0.1.0). 8 seconds. |
| CI on `c75d4e1` | Passed. |
| `pnpm deploy:production` | Every gate passed and no release warning printed. The run printed `Branch main at c75d4e1 (v0.1.0).`, deployed api, admin and web, passed all 5 smoke checks, and pushed `deploy-20261023-0616`. |

The deploy tag message is `Production deploy of c75d4e1 (v0.1.0): api, admin, web.`

The `CHANGELOG.md` entry has this shape. A `# Changelog` header, then `## 0.1.0 (2026-10-23)`, then one `###` section per kind: `⚠ BREAKING CHANGES`, `Features`, `Bug Fixes`, `Performance Improvements`, `Miscellaneous Chores` and `Build System`. Each line reads `* **<scope>:** <subject> ([<short sha>](<commit url>))`, and a line gains `, references #N` or `, closes #N` when the commit body names an issue. The first entry holds 129 lines, because it covers every commit since the project start.

Files primeshopr changed:

- None during the run. The release commit wrote only the root `package.json` (`version`) and `CHANGELOG.md`.
- Before the run, in `0fff95b` and `ba4eb87`: `.release-it.json`, `CHANGELOG.md` (the header only), the root `package.json` (the `release` and `release:dry` scripts and the two pins), `pnpm-lock.yaml`, `scripts/deploy-production.ts` and its test (the `release` fact, the warning, the version in the tag message), `docs/runbook-deploy.md` and the `primeshopr-deploy` skill.

What the run teaches Phase 3:

1. **A breaking commit under 1.0 asks for `1.0.0`.** primeshopr's history holds three `!` commits (dev database resets, a removed workspace), so release-it recommended a major bump and the owner overrode it with `0.1.0`. Q5's `preMajor: true` removes the need for the override.
2. **A hidden type still shows when it is breaking.** The preset hides `chore` and `build`, but a breaking `chore(repo)!` and a breaking `build(api)!` produced the `Miscellaneous Chores` and `Build System` sections. Q6 should say so.
3. **A dirty tree blocks the release, and turning the check off is unsafe.** release-it commits with `git add . --update`, so with `requireCleanWorkingDir` off, another session's uncommitted files would go into the release commit. `release.ts` must keep the check on.
4. **The release pushes every local commit.** Two unpushed commits from another session went to `origin` with the release commit. CI on the release commit covered them. The skill should tell an agent to check `git status -sb` for unpushed commits before the release.
5. **An agent needs `--ci`.** Without it release-it asks on a terminal no one reads. Q11 already makes `ci: true` the default.
6. **`GitHub comment on resolved items` posts nothing by default.** The step prints `✔`, but `github.comments.submit` is `false`, so no issue got a comment. Keep it off: the first entry names 26 issues.

### Phase 2: decisions on record (built 2026-10-23)

1. ADR 0049, "A release names each production deploy", citing 0048 and 0034.
2. `CONTEXT.md` defines release and release tag.

Done when: the ADR and the two terms are on the branch.

### Phase 3: the release wrapper and the engine (built 2026-10-23)

1. `packages/tooling/src/release.ts`: build the release-it options from `deploy.config.ts`, check the token, run release-it with `ci: true`, and pass `--dry-run` and the increment through.
2. `packages/tooling/src/types.ts` and `deploy.config.ts`: the `release` block, with its defaults.
3. `packages/tooling/package.json`: the two exact pins.
4. Root `package.json`: the `release` and `release:dry` scripts.
5. Engine: a `Facts.release` field (the `v*` tag on HEAD, and the commits after the newest one), the warning from Q3, and the version in `tagMessage` and the run output.
6. Vitest tests from Q20.

Done when: in `.dev`, a new project with two `feat:` commits runs `pnpm release:dry` and sees `0.1.0` and the changelog entry, and `pnpm deploy:production --dry-run` prints the release warning. No GitHub Release is made from `.dev`.

### Phase 4: `update` and `doctor` (built 2026-10-23)

1. The updater hashes the root `package.json` with the template `version`, and it keeps the project's version on overwrite.
2. `saasaloy doctor` warns when `release.ts` exists and the root `release` script does not.
3. CLI tests for both.

Done when: in `.dev`, a project that has bumped its version gets an unedited root `package.json` overwritten by `update`, with its version kept.

### Phase 5: docs and skills (built 2026-10-23)

1. The `saasaloy-deploy` skill and `docs/runbook-deploy.md`: `pnpm release` before `pnpm deploy:production`, the go-ahead rule for an agent, the hotfix order and its merge-back conflict, and a note that the hotfix release path is unproven.
2. Base `AGENTS.md` "Branches and Deploys": the `v*` tag beside the `deploy-*` tag.
3. `packages/cli/CHANGELOG.md`: the merge steps for an existing project. They go in the `BREAKING CHANGE:` footer of a `!` commit, as #234 did, so the next CLI release writes them into the changelog.

Done when: the skill, the runbook and `AGENTS.md` name the release step.

### Phase 6: verification (built 2026-10-23)

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` in saasaloy.
2. In `.dev`: `saasaloy update` on a project made with the current base. Record which files land in the merge plan.
3. `pnpm release:smoke`.

Done when: all three pass, and the plan records the merge plan.

#### Phase 3 and Phase 6 record (2026-10-23, #236)

The `.dev` checks on the built branch:

| Check | Result |
| --- | --- |
| `pnpm release:dry` in a new project with two `feat:` commits | `0.0.0...0.1.0`, with a `Features` entry for both commits. |
| `pnpm release` with no `GITHUB_TOKEN` and no signed-in `gh` | Refused before any change: `The release did not start, because a GitHub Release needs a token and none was found.` The version, the tags and HEAD stayed as they were. |
| `pnpm release` against a local bare origin, with `githubRelease: false` in the playground only | Commit `chore(release): v0.1.0`, tag `v0.1.0`, `CHANGELOG.md` with `# Changelog` and `## 0.1.0`, pushed. |
| `pnpm deploy:production --dry-run` on the release commit, then one `fix:` later | `Branch main at ec7e007 (v0.1.0).` with no warning, then `HEAD is 1 commit(s) past v0.1.0, so CHANGELOG.md does not list these commits:` with the commit listed. |
| `pnpm release:dry` after that `fix:` | `0.1.0...0.1.1`, with a `Bug Fixes` entry. |

The first `release:dry` run gave `0.0.1`, not `0.1.0`. The `conventionalcommits` preset's `preMajor` flag shifts every bump down one level, so a `feat` became a patch. `release.ts` now passes its own `whatBump` below 1.0: a breaking change or a `feat` bumps the minor, and a `fix`, `perf` or `revert` the patch. At 1.0 the preset's bump applies. Both Q5 outcomes hold.

`saasaloy update base` on a project made with the base at `569e0b4`, whose root `package.json` a release had bumped to `0.1.0`:

| File | Plan |
| --- | --- |
| `AGENTS.md`, `.agents/skills/saasaloy-deploy/SKILL.md`, `package.json`, `packages/tooling/package.json`, `packages/tooling/src/deploy-production.ts` and its test, `packages/tooling/src/types.ts` | update (overwrite). `package.json` kept `"version": "0.1.0"` and gained `release` and `release:dry`. |
| `packages/tooling/src/release.ts` and its test | create |
| `packages/tooling/src/deploy.config.ts` | drift → merge. The file is owned, so nothing was written: the plan shows the template's new `release` block for the owner to take. The defaults cover a project that does not. |

A second dry run listed the root `package.json` as up to date. `saasaloy doctor` counted all 115 base files as matching, and it warned once the root `release` script was removed.

## Files a generated project owns, or that `saasaloy update` puts in a merge plan

| File | Status in a project | What `update` does |
|------|---------------------|--------------------|
| `packages/tooling/src/release.ts` | new, managed | created when absent |
| `packages/tooling/package.json` | managed | overwrite when unedited, merge plan when edited |
| `packages/tooling/src/deploy.config.ts` | owned | never written. The `release` block defaults cover a project without it |
| root `package.json` scripts | managed | overwrite when unedited, merge plan when edited |
| root `package.json` `version` | changed by every `pnpm release` | ignored by the hash, kept on overwrite (Q2) |
| `CHANGELOG.md` | not a base file | never touched |

## Follow-up for primeshopr (not done here)

- After this lands: run `saasaloy update`, take `release.ts`, delete `.release-it.json` and the root release-it devDependencies, and move any changelog choice into the `release` block.

## Non-goals

- npm publish, per-workspace versions, and a release run from CI. The version is one number for the whole project.
- A release gate in the deploy. The deploy warns only.
- A proven hotfix release. It waits for a real hotfix (Q4).

## Open questions

None. Every decision is settled.
