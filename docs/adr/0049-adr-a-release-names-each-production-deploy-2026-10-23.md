# 0049: A release names each production deploy

A generated project deployed with gates, an order and a `deploy-*` tag (ADR 0048), but nothing said which version went live or what changed. Nothing is published to npm, so no package registry keeps that record either. primeshopr ran the release step first, as `brainaloylabs/primeshopr#87`: release `v0.1.0`, then the deploy `deploy-20261023-0616`, whose tag message named the version. Settled on 2026-10-23 in the grill of `docs/plans/0078-plan-release-step-before-deploy-2026-10-23.md` for issue [#236](https://github.com/mimukit/saasaloy/issues/236).

## Status

accepted. Builds on [ADR 0048](0048-adr-production-deploy-is-gated-ordered-and-tagged-2026-10-23.md), which stays as it is: every deploy gate still runs, and the `deploy-*` tag still records what went live. Amends [ADR 0034](0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md) for one key in one file: the root `package.json` `version`.

## The shape

- **Two commands, in order.** `pnpm release` gives the commit a version and a changelog entry. `pnpm deploy:production` then puts it live. They stay separate, so a hotfix can deploy before its release, and a release never skips a gate.
- **release-it does the work, through a managed wrapper.** `pnpm release` runs `packages/tooling/src/release.ts`, which calls the release-it Node API with `@release-it/conventional-changelog` (preset `conventionalcommits`, infile `CHANGELOG.md`) and `npm.publish: false`. It runs with `config: false`, so no `.release-it.json` is read. The two packages are exact-pinned in `packages/tooling`, the workspace that imports them (ADR 0020). The root scripts are `node packages/tooling/src/release.ts` and the same with `--dry-run`, and they never change.
- **One branch list.** The wrapper takes `requireBranch` from `branches` in `deploy.config.ts`, the same list the deploy's branch gate reads. A `release` block in the same owned file holds the rest: `tagPrefix` (`v`), `githubRelease` (`true`), `preMajor` (`true`) and `changelogSections` (the preset's own list when unset). A missing block or key falls back to its default, because `update` never adds a block to an owned file.
- **One release is one commit and one tag.** It bumps the root `package.json` version, writes the `CHANGELOG.md` entry, commits `chore(release): v<version>`, tags `v<version>` (annotated), pushes, and creates a GitHub Release. The clean-tree check stays on, because release-it commits with `git add . --update`.
- **It never asks a question.** The wrapper sets `ci: true`, so an agent shell does not stall. `pnpm release:dry` is the preview. An agent runs `pnpm release` only after the owner's go-ahead in the same session, the rule the `saasaloy-deploy` skill already gives the deploy.
- **The token is required, before anything changes.** The wrapper reads `GITHUB_TOKEN`, then `gh auth token`. With neither, a real release with `githubRelease` on refuses and names both fixes. release-it would otherwise fall back to a web page and wait on it.
- **The first release is `0.1.0`.** The template keeps `"version": "0.0.0"`. With `preMajor`, a breaking change below 1.0 bumps the minor, so `1.0.0` is a release the owner chooses with `pnpm release major`.
- **The deploy names the release and warns without one.** The engine reads the `v*` tag on HEAD and names it in its output and its tag message: `Production deploy of c75d4e1 (v0.1.0): api, admin, web.` When HEAD is not a release commit, it says how far HEAD is past the newest release, lists those commits, and deploys anyway. The warning is never a gate.
- **`update` leaves the version alone.** The updater compares the root `package.json` as if it still held the version the base wrote, and writes a new render with the project's version kept. `newHash` stays the hash of the render, which is what the next run compares against after the same step. `saasaloy doctor` reads the file the same way for base drift, and warns when `release.ts` exists and the root `release` script does not.

## Considered Options

- **A managed root `.release-it.json`.** Rejected: the branch list would live in two files, and an edited copy would land in every later merge plan. This was primeshopr's shape, and it worked; the wrapper keeps its options and drops the second file.
- **An owned root `.release-it.json`.** Rejected: a fix to the base config would never reach an existing project.
- **A module.** Rejected: the release has no runtime code, no env keys and no provider choice, and it must agree with the deploy's branches, tags and gates.
- **changesets.** Rejected: it versions per package and assumes publish. The project has one version.
- **Keep the version in an owned file through `@release-it/bumper`.** Rejected: every tool that reads `package.json` for the version would stop seeing it.
- **Warn only when no release exists since the last deploy tag.** Rejected: commits that land after the release and before the deploy would go live without a changelog entry, and no warning would say so.
- **Refuse a deploy with no release.** Rejected: a hotfix must not wait on the changelog.

## Consequences

- Every release changes the root `package.json`. The version rule keeps that out of the merge plan, and a real edit to the file still goes there.
- A hotfix branch makes its own patch release. Merging it back into `main` after `main` released conflicts in `CHANGELOG.md` and `version`. The skill tells the agent to merge, never rebase, and to keep both entries and the higher version. This path has not run on a real project yet.
- release-it pushes every local commit with the release commit. The skill tells an agent to check `git status -sb` first.
- A breaking commit shows in the changelog whatever its type, under a heading such as `Miscellaneous Chores`, because the preset shows every breaking change.
- An existing project gets `release.ts` and the pins through `saasaloy update`. The two root scripts go through the root `package.json` merge plan when the project edited that file, and `doctor` warns until they are in.

## References

Issue #236. Plan: `docs/plans/0078-plan-release-step-before-deploy-2026-10-23.md`. Proof: `brainaloylabs/primeshopr#87`. Builds on ADR 0048, amends ADR 0034, and follows ADR 0020 for the pins.
