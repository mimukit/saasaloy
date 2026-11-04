# Plan: pass the deploy CI gate on finished job steps

Grilled: 2026-11-04

Issue: #305

## Context

The deploy CI gate in `packages/cli/templates/base/packages/tooling/src/deploy-production.ts` waits for GitHub to mark the `ci.yml` run `completed`. GitHub can do that many minutes after the jobs end. On 2026-11-04 the primeshopr v0.8.0 release waited about 21 minutes on this lag: run 41863300390 ended its jobs at 16:03:53 UTC, and GitHub marked it `completed` at 16:25:30. The release commit only bumps the root `version` and `CHANGELOG.md`, so its own run adds a wait and no check.

The same lag hits two waits, not one. The agent waits with `gh run watch` after `pnpm release` (the `saasaloy-deploy` skill, Procedure step 7). The `infra-ci-deploy` module in open PR #286 (issue #199) waits in `deploy.yml` with `gh run watch "$run" --exit-status` before `pnpm deploy:production`. Both read the run status.

Goal: a production deploy waits only on the tests, never on GitHub's run bookkeeping.

Target: the CI gate passes within one poll interval (15 s) after the last job step ends green, against a baseline of 21 min 37 s (run 41863300390, primeshopr, 2026-11-04). A release-only commit whose parent run passed waits 0 s. The tests check both through the fake `Io` clock. The real wait on a live release is measured after release.

Reference implementation: primeshopr commit `21139b8` on `main`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Scope | Port primeshopr's gate (job steps and the release-parent pass), and add a `--wait-ci` flag that polls the gate. The skill and `deploy.yml` use the flag in place of `gh run watch`. Picked by the owner on 2026-11-04. |
| Order against #286 | #286 merges as it is first. Phase 4 then edits its `deploy.yml` in the #305 PR. Phases 1 to 3 have no dependency. #305 stays one issue, so the issue is `blocked` until #286 merges. Asked, grill Q1 and Q11. |
| Job-step rule | A job passes when its own conclusion is `success` or `skipped`, or when every step is `completed` with `success` or `skipped`. Any step with another non-empty conclusion fails the run at once. A run with no jobs, or a job with no steps, counts as running. Same rule as primeshopr. |
| When to read jobs | Only for a run that does not show `completed`. `gh run list` adds `databaseId` to its `--json` fields. A completed run costs no extra call. |
| `gh run list` limit | Keep the default of 20. A rerun is a new attempt of the same run, so it adds no row. Defaulted, grill Q5. |
| Jobs source | `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`, through the existing `io.gh`. `gh` fills `{owner}/{repo}` from the checkout. GitHub documents `actions: read` for this endpoint, and #286's `deploy.yml` already grants it, so no permission changes. Defaulted, grill Q6. |
| Release-only rule | HEAD has one parent. `git diff --name-only <parent> HEAD` lists only the changelog file and the root `package.json`. Every changed line of `git diff --unified=0 <parent> HEAD -- package.json` is a `"version"` line. The parent's run must pass under the same job-step rule. No release tag and no commit subject is required: the diff rule alone decides, because no test reads `CHANGELOG.md`. Asked, grill Q3. |
| Changelog path | Export `CHANGELOG_FILE = "CHANGELOG.md"` from `deploy-production.ts`. `release.ts` imports it for `infile`, and `isReleaseOnly` reads it. No `deploy.config.ts` key. Picked by the owner on 2026-11-04. |
| Gate detail on a parent pass | `<workflow> passed on <parent short sha>, and HEAD changes only the release version and CHANGELOG.md.` |
| `--wait-ci` surface | A bare flag with fixed limits: `CI_POLL_MS = 15000`, `CI_MISSING_MS = 5 * 60_000`, `CI_WAIT_MS = 30 * 60_000`, as constants beside `SMOKE_TRIES`. No flag value and no config key. Asked, grill Q2. |
| `--wait-ci` on a failed run | Stop at the first `failed` state and report it. A rerun needs a new command, the same as `gh run watch --exit-status`. Defaulted, grill Q4. |
| `--wait-ci` and the other gates | Check every non-CI gate first. Wait only when they all pass, so a dirty tree or a wrong branch fails at once. Defaulted, grill Q8. |
| Parent fallback during the wait | Compute `releaseParent` once before the loop. Each poll reads HEAD's runs, then the parent's runs when HEAD has not passed. Defaulted, grill Q9. |
| Tests | Extend the existing `deploy-production.test.ts` with the runner it already uses. No new kind of test. Defaulted, grill Q12. |
| Attended phases | None. No phase needs a pick, a mockup or a deploy. Defaulted, grill Q13. |
| Existing projects | A base update note `packages/cli/update-notes/0002-ci-gate-job-steps.md` with `version: 0.9.0` tells the agent what changed in `deploy-production.ts`, `release.ts` and the skill, for a project that owns its own additions in those files. Change the version at release time if the release is not `0.9.0`. Defaulted, grill Q7. |

Rejected:

- Port only, as #305 first said. It leaves the `deploy.yml` wait in #286 on the 21-minute lag.
- `paths-ignore` in `ci.yml` for release commits. A path filter cannot tell a `version` line from a dependency change in `package.json`, and it does nothing for the job-step lag.
- A `release.changelogFile` config key. No project asked to move the changelog, and it adds a key to `types.ts`.
- A release tag on HEAD as a second condition for the parent pass (grill Q3). The owner chose the diff rule alone.
- A separate follow-up issue for the `deploy.yml` edit (grill Q11). The owner chose one issue that waits on #286.

## Approach

The gate keeps its shape. `readCi` and `ciState` gain the job-step rule, `readFacts` gains a parent fallback, and `deployProduction` gains a poll loop after the non-CI gates. Everything goes through the existing `Io` (`git`, `gh`, `sleep`, `now`, `say`), so the tests stay on the fake `Io`.

### Phase 1: read job steps for a lagging run

- Add `CiStep` and `CiJob` types. Add `jobs?: CiJob[]` to `CiRun`.
- Add an exported `jobState(job)` and a private `runState(run)` with the rule in Design decisions. Rewrite `ciState` on top of `runState`.
- `readCi` asks for `status,conclusion,databaseId`, and calls a new `readJobs(io, id)` for each run that does not show `completed`.
- Update the comment block at the top of the file to describe the job-step check.
- Tests: `jobState` for a completed job, a lagging job with every step green, a step still running, a failed step, and a job with no steps. `ciState` for a lagging run that passes, a run with no jobs, and a failed step. One full dry run through the fake `gh`, where the run shows `queued` and its jobs are green, prints `ci.yml passed on HEAD.`
- The fake `Io` gets a `gh` answer function in its setup, in place of the fixed `gh: () => "[]"`.

Done when: `pnpm --filter @repo/tooling test` passes in a scaffold, and the new dry-run test shows the gate `ok` for a `queued` run whose steps are all `completed`/`success`.

### Phase 2: pass a release commit on its parent's green run

- Export `CHANGELOG_FILE` from `deploy-production.ts`. `release.ts` imports it and passes it as `infile`.
- Add an exported `isReleaseOnly(files, packageDiff)` and a private `releaseParent(io)` that reads `git rev-list --parents -n 1 HEAD` and the two diffs.
- Add `ciCommit?: string` to `Facts`. A new `readCiFacts` reads HEAD first and the parent only when HEAD's state is not `passed`.
- `ciGate` prints the parent detail when `ciCommit` is set.
- Tests: `isReleaseOnly` for a version-only bump, a dependency change in `package.json`, another file in the diff, and an empty diff. Full dry runs for a release commit whose own run is still running and whose parent passed, a merge commit (two parents), and a release commit whose parent failed.
- The fake `Io` gets a `parent` setup for `rev-list --parents`. Its `git` answer tells `diff --name-only <parent> HEAD` apart from the migration diff, which today answers every `diff --name-only` call.

Done when: the tooling tests pass, and the dry-run test for a release commit prints `ci.yml passed on <parent short sha>, and HEAD changes only the release version and CHANGELOG.md.` while HEAD's own run shows `in_progress`.

### Phase 3: `--wait-ci` polls the gate

- `parseArgs` accepts `--wait-ci`. `--wait-ci` with `--skip-ci` throws, because the two contradict. `USAGE` lists the flag.
- Add the constants `CI_POLL_MS`, `CI_MISSING_MS` and `CI_WAIT_MS` beside `SMOKE_TRIES`.
- With `--wait-ci`, `deployProduction` checks every non-CI gate first. When one fails, it reports the gates and stops with no wait.
- When the non-CI gates pass, it computes `releaseParent` once, then polls the CI facts every `CI_POLL_MS` through `io.sleep` until the state is `passed` or `failed`. `missing` counts as running until `CI_MISSING_MS`, because a run appears some seconds after the push. The wait gives up at `CI_WAIT_MS`, and the gate then reports the state it last read.
- The loop prints one line when it starts and one line each minute, so a background log shows progress without a line per poll.
- A dry run with `--wait-ci` waits the same way, so the agent can start it in the background after `pnpm release`.
- Tests: a run that turns green on the third poll, a step that fails on the second poll, a run that is missing for 2 minutes then passes, the 30-minute timeout, the 5-minute missing limit, a dirty tree that fails with no `sleep` call, and the `--skip-ci` conflict. The fake `now` moves forward on each `sleep`.

Done when: the tooling tests pass, the green-on-third-poll test records two `sleep(15000)` calls and the gate `ok`, which shows the 15 s target, and the dirty-tree test records no `sleep` call.

### Phase 4: the skill, the workflow and the update note

Depends on: #286 merged to `main`, because this phase edits its `deploy.yml`.

- `packages/cli/templates/base/_agents/skills/saasaloy-deploy/SKILL.md`:
  - The CI row of the gates table describes the job-step check, the release-parent pass and `--wait-ci`.
  - Procedure step 7 runs `pnpm release`, then `pnpm deploy:production --dry-run --wait-ci > <log> 2>&1` as a background task, and drafts the reports during the wait.
  - A new line tells the agent to save each dry run's output to a file once and read it from there, because each deploy dry run builds every Worker.
  - The flag list documents `--wait-ci`.
- `modules/infra-ci-deploy/files/workflows/deploy.yml`: delete the "Wait for the ci workflow" step, and run `pnpm deploy:production --wait-ci`. Update `modules/infra-ci-deploy/skills/saasaloy-infra-ci-deploy/SKILL.md` to match.
- Add `packages/cli/update-notes/0002-ci-gate-job-steps.md` with `version: 0.9.0`. It names `deploy-production.ts`, `release.ts` and the `saasaloy-deploy` skill as the merge, and gives the dry-run check as its verify step.

Done when: `pnpm lint` passes, `pnpm deploy:production --wait-ci --skip-ci x` in a `.dev` scaffold prints the conflict error, `deploy.yml` holds no `gh run watch` line, and the update note passes the CLI's note validation test.

## Open questions

None. The grill on 2026-11-04 settled every decision.

## Non-goals

- No change to how `pnpm release` picks a version or writes the changelog. The template's `release.ts` already passes `ci: true` to release-it, so primeshopr's `--ci` change to `release:dry` does not apply.
- No `ci.yml` workflow in the template. That is the `ci` module in #244.
- No change to the `--skip-ci` gate pass or its tag message.
- No retry or rerun of a failed CI run.
- No flag value or config key for the `--wait-ci` limits.
