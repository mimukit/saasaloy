# QA Plan: Pass the deploy CI gate on finished job steps

_Generated 2026-11-18 · updated 2026-11-18 · against `7a3e3af6` (clean apart from this plan; `57d46222` before a rebase onto main that added one plan doc) · covers issue #305: the job-step CI gate, the release-parent pass, `--wait-ci`, the `saasaloy-deploy` skill, the `infra-ci-deploy` workflow and base update note 0005_

## Summary
- The deploy CI gate passes once every CI job step ends green, passes a release-only commit on its parent's green run, and `--wait-ci` polls the gate.
- Working means a production deploy waits on the tests only, never on the run status GitHub shows late.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-305-pass-the-deploy-ci-gate-on-finished-job-steps` at `7a3e3af6`.
- A project on GitHub made from this branch's CLI, with the `ci` module installed, so `deploy.config.ts` names `ciWorkflow: "ci.yml"`. Scenario 2 also needs the `infra-ci-deploy` module and its repository secrets.
- A signed-in `gh` with read access to the project's Actions.
- Screenshots: none. The change has no UI.

Build the CLI from this branch:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: A project on GitHub with the ci module | A code push passes the gate soon after its steps end | 🔴 Critical |
| TC-1.2 | 1: A project on GitHub with the ci module | A release commit passes on its parent at once | 🔴 Critical |
| TC-1.3 | 1: A project on GitHub with the ci module | The skill reads clearly for an agent | 🟢 Low |
| TC-2.1 | 2: The same project with infra-ci-deploy | The deploy workflow waits with `--wait-ci` and deploys | 🟡 Normal |

## Scenario 1: A project on GitHub with the ci module

**Setup.** Run once, for every case in this scenario.

1. Push a commit that changes code to `main` of the project, so `ci.yml` starts a run.

```sh
git commit --allow-empty -m "chore: trigger ci" && git push
```

- [ ] Setup complete

### TC-1.1: A code push passes the gate soon after its steps end  ·  🔴 Critical

**Goal.** The gate passes within one 15 s read after the last step ends, while GitHub can still show the run as running.

**Steps**

1. Start the wait at once, and keep the log.

   ```sh
   pnpm deploy:production --dry-run --wait-ci > wait.log 2>&1
   ```

2. Watch the run's jobs in the Actions tab while the command runs. Note the time the last step of the last job ends.
   - [ ] The log prints `ok    ci.yml passed on HEAD.` no more than about 15 s after that time
     - compare with the time the Actions tab marks the whole run done; on a lagging run the gate passes first
     - the log holds one progress line a minute, not one line a read

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A release commit passes on its parent at once  ·  🔴 Critical

**Goal.** A commit that only bumps the version and the changelog does not wait for its own CI run.

**Steps**

1. Wait until the run from Setup ends green. Then run the release.

   ```sh
   pnpm release
   ```

2. Run the dry run with the wait at once, before the release commit's own run ends.

   ```sh
   pnpm deploy:production --dry-run --wait-ci
   ```

   - [ ] The CI gate prints `ci.yml passed on <parent short sha>, and HEAD changes only the release version and CHANGELOG.md.` with no wait
     - the short sha is the commit before the release commit, as `git log --oneline -2` shows

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The skill reads clearly for an agent  ·  🟢 Low

**Goal.** An agent that follows the `saasaloy-deploy` skill waits with `--wait-ci` and saves each dry run once.

**Steps**

1. Open `.agents/skills/saasaloy-deploy/SKILL.md` in the project. Read "Procedure" steps 3 and 7, the CI row of the gates table, the `--wait-ci` flag entry and "Hotfix" step 4.
   - [ ] The text tells one clear story: save the dry runs, release, wait in the background, draft the report, then deploy
     - no step still tells the agent to run `gh run watch` before a deploy

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. The release tag and the release commit stay, as after any release.

## Scenario 2: The same project with infra-ci-deploy

**Setup.** Run once, for every case in this scenario.

1. Add the module, commit its workflow, and set the repository secrets its skill lists.

```sh
saasaloy add infra-ci-deploy
```

- [ ] Setup complete

### TC-2.1: The deploy workflow waits with `--wait-ci` and deploys  ·  🟡 Normal

**Goal.** A push to `main` deploys after the CI steps end, with no separate wait step.

**Steps**

1. Commit the workflow and push it to `main`. Open the `deploy` run in the Actions tab.
   - [ ] The job has no "Wait for the ci workflow" step, and the `pnpm deploy:production` step prints the wait lines, then `ok` for CI
   - [ ] The run deploys every Worker and pushes a deploy tag

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. A deploy tag is history, and you never delete one.

## Automated verification (by AI agent)
_Checks the agent ran itself. The first run was at `1de902c3`. Commit `57d46222` changed only the deploy skill and update note 0005, and the agent ran the tooling tests, the note tests, the update tests, `pnpm lint` and the C9 skill check again there. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm --filter saasaloy exec vitest run --config vitest.tooling.config.ts --project tooling
```

```sh
pnpm --filter saasaloy exec vitest run --config vitest.tooling.config.ts --project tooling -t "CI gate|ciState|jobState|isReleaseOnly|wait-ci"
```

```sh
pnpm --filter saasaloy exec vitest run src/lib/update-notes.test.ts src/commands/update.test.ts
```

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
grep -c "gh run watch" modules/infra-ci-deploy/files/workflows/deploy.yml
```

```sh
cd .dev/playground && pnpm deploy:production --wait-ci --skip-ci x
```

```sh
cd .dev/playground && pnpm deploy:production --dry-run --wait-ci
```

```sh
gh api "repos/{owner}/{repo}/actions/runs/44254847694/jobs" --jq '.jobs | length'
```

- ✅ Tooling tests (at `57d46222`) → 193 passed, 35 of them on the CI gate, `jobState`, `isReleaseOnly`, `--wait-ci` and `parseArgs`. Each new test was seen red under a small break in the engine before it was kept.
- ✅ C1 · a `queued` run whose job steps all ended `success` prints `ok ci.yml passed on HEAD.` → test "passes a run GitHub still shows as queued once its jobs' steps ended green".
- ✅ C2 · a lagging run with one failed step prints `fail ci.yml failed on HEAD.` → test "fails a lagging run with one failed step, with the failed-on-HEAD message".
- ✅ C3 · a run with no jobs, a job with no steps, and a step still running stay `running` → tests "waits on a lagging run with no job yet", "does not pass a job with no steps", "keeps a lagging run whose step still runs as running".
- ✅ C4 · a `completed` run makes no `gh api` call → test "reads no jobs for a run that shows completed".
- ✅ C5 · a release-only commit passes on its parent, and the detail names `34720f5` → test "passes a release commit on its parent's green run while HEAD's own run still runs".
- ✅ C6 · no parent pass for a code change, a dependency change, a merge commit, or a failed parent run → four tests under "takes no parent pass".
- ✅ C7 · `--wait-ci` passes after two `sleep(15000)` calls, stops at the first failed read, stops after 20 reads with no run (5 min), gives up after 120 reads (30 min), and makes no `sleep` call with a dirty tree → the seven `--wait-ci` tests.
- ✅ C8 · `--wait-ci --skip-ci x` in the scaffold → exit 1, `--wait-ci waits for the CI gate, and --skip-ci passes it. Choose one.`
- ✅ C9 (at `57d46222`) · the skill names `--wait-ci` 7 times, runs the dry run "as a background task" at step 7 with the approved flags (`--migrate`, `--only`), skips the wait with an approved `--skip-ci`, adds `--migrate` at hotfix step 4 for a new migration file, saves each dry run under `.artifacts/deploy/`, and its CI row names the job-step rule and `passed on <parent sha>`.
- ✅ C10 · `deploy.yml` holds 0 `gh run watch` lines, and line 90 runs `pnpm deploy:production --wait-ci ${{ inputs.migrate && '--migrate' || '' }}`.
- ✅ C11 (at `57d46222`) · update note tests and update command tests → 119 passed. `update-notes.test.ts` parses every shipped note, 0005 included.
- ✅ C12 · `pnpm lint` (at `57d46222`) → exit 0. `pnpm test` → exit 0 (2087 cli tests, 408 node tests) at `1de902c3`; the later commit changed Markdown only.
- ✅ Scaffold, template tooling at group A → `pnpm --filter @repo/tooling typecheck`, type-aware oxlint over `packages/tooling/src`, and `vitest run packages/tooling` all exit 0.
- ✅ `--dry-run --wait-ci` with no `ciWorkflow` in the scaffold → exit 0, `CI gate: off`, no wait line.
- ✅ `release.ts` in the scaffold → line 133 reads `infile: CHANGELOG_FILE,`.
- ✅ Real GitHub data → `gh` fills `{owner}/{repo}` (2 jobs on run 44254847694). That run's real `gh run view` and jobs JSON, fed through the scaffold's `ciState` and `jobState`, gives `passed` for both jobs (10/10 and 14/14 steps) and the run. The run had ended before the read, so this proves the parse of GitHub's real shape, not a lagging run.

## Not covered / needs human judgment
- The real wait on a live release, against the 21-minute baseline. It needs a GitHub project with CI lag, so TC-1.1 and TC-1.2 carry it.
- A real GitHub Actions deploy. It needs Cloudflare credentials, so TC-2.1 carries it.
- Performance, accessibility and UI: the change has no UI and adds one `gh api` call per lagging run per read.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
