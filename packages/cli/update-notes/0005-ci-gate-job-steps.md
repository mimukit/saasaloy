---
title: Pass the deploy CI gate on finished job steps, and wait for CI with --wait-ci
version: 0.9.0
---

GitHub can show a CI run as queued or in progress for many minutes after its jobs end. The deploy CI gate read only the run status, so a deploy waited on GitHub and not on the tests. One release waited 21 minutes this way. The gate now reads the job steps, passes a release commit on its parent's green run, and gains a `--wait-ci` flag that replaces `gh run watch`.

## What update does

- `packages/tooling/src/deploy-production.ts`:
  - For a run that does not show `completed`, the CI gate reads `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`. A job passes when its own conclusion is `success` or `skipped`, or when every step is `completed` with `success` or `skipped`. One failed step fails the run at once. A run with no jobs, or a job with no steps, still counts as running. A run that shows `completed` costs no extra call.
  - A commit with one parent that changes only `CHANGELOG.md` and the root `package.json`, where every changed `package.json` line is the `"version"` line, passes on its parent's green run. The gate then prints `<workflow> passed on <parent short sha>, and HEAD changes only the release version and CHANGELOG.md.`
  - `--wait-ci` checks every other gate first. When they all pass, it reads the CI gate every 15 s until it passes or fails. A missing run counts as running for 5 minutes, and the wait ends after 30 minutes. `--wait-ci` with `--skip-ci` is an error.
  - The `is still running` and `has no run on HEAD` messages name `pnpm deploy:production --wait-ci` in place of `gh run watch`.
  - The file exports `CHANGELOG_FILE`, and `isReleaseOnly` and `jobState` for the tests.
- `packages/tooling/src/release.ts` imports `CHANGELOG_FILE` and passes it to release-it as `infile`.
- `.agents/skills/saasaloy-deploy/SKILL.md`: the CI row of the gates table, the flag list and the hotfix steps describe the new gate and `--wait-ci`. Procedure step 3 saves each dry run's output to a file under `.artifacts/deploy/`. Step 7 runs `pnpm deploy:production --dry-run --wait-ci` with the approved flags as a background task after `pnpm release`, and drafts the result report during the wait.

A project that never changed these files gets them from `saasaloy update` as they are.

## What update merges

- `packages/tooling/src/deploy-production.ts`, if you added your own code to it. Keep your additions, and take the template's `CiStep`, `CiJob`, `jobState`, `runState`, `ciState`, `CHANGELOG_FILE`, `isReleaseOnly`, `readJobs`, `readCi`, `releaseParent`, `readCiFacts` and `waitForCi`, the `ciCommit` field on `Facts`, the `waitCi` option in `parseArgs` and `USAGE`, the three `CI_*_MS` constants, the parent detail in `ciGate`, and the `--wait-ci` block after `readFacts` in `deployProduction`.
- `packages/tooling/src/release.ts`, if you edited it. Take the `CHANGELOG_FILE` import and `infile: CHANGELOG_FILE`.
- `.agents/skills/saasaloy-deploy/SKILL.md`, if you edited it. Take the new step 3 and step 7, the CI row of the gates table, the `--wait-ci` flag entry and hotfix step 4.

## What you do

1. If your deploy skill or runbook (`docs/runbook-deploy.md`, a project skill) waits with `gh run watch` before a deploy, replace that wait with `pnpm deploy:production --dry-run --wait-ci`.
2. If a GitHub Actions workflow of yours waits for the `ci` workflow before it runs `pnpm deploy:production`, delete that wait step and add `--wait-ci` to the deploy command. The job's token needs `actions: read` to list the jobs.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm deploy:production --wait-ci --skip-ci x
pnpm deploy:production --dry-run
```

The third command exits 1 with `--wait-ci waits for the CI gate, and --skip-ci passes it. Choose one.` The dry run prints the CI gate. With `ciWorkflow` set, a commit whose CI jobs ended green prints `ok` on that line, even while GitHub still shows the run as in progress.
