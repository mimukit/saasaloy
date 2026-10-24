# QA Plan: unfreeze the scaffold installs in the scheduled smoke

_Generated 2026-10-24 · against `1ffcb674` (uncommitted change: the Phase 2 stamp in plan 0085) · covers issue #267, `scripts/release-smoke.ts`_

## Summary
- The release smoke installs every scaffolded project with `--no-frozen-lockfile`, so the install after the `add` runs passes when `CI=true`.
- Working means the `smoke` job gets past `pnpm install in full-database-d1*` and logs `` running `pnpm lint` `` in each full scaffold.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-267-fix-the-pnpm-install-step-in-the-scheduled-smoke`, merged to `main`.
- The `smoke` workflow runs on its own schedule, `cron: "17 6 * * *"` (06:17 UTC).
- You need `gh`, signed in to `mimukit/saasaloy`.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: the fix is on `main` and one scheduled run has finished | the scheduled run gets past the install | 🟡 Normal |

## Scenario 1: the fix is on `main` and one scheduled run has finished

**Setup.** Run once, for every case in this scenario.

1. Wait for the first 06:17 UTC scheduled run after the merge.

- [ ] Setup complete

### TC-1.1: the scheduled run gets past the install  ·  🟡 Normal

**Goal.** The `schedule` trigger on `main` behaves like the `workflow_dispatch` run on the branch.

**Steps**

1. List the latest scheduled run of `smoke` on `main`.

   ```sh
   gh run list --workflow smoke.yml --branch main --event schedule --limit 1
   ```

2. Search its log for the install error and the lint lines. Put the run ID from step 1 in place of `RUN_ID`.

   ```sh
   gh run view RUN_ID --log | grep -E "ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER|running \`pnpm lint\` in"
   ```

   - [ ] The output holds four `` running `pnpm lint` `` lines and no `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER` line
     - a failure after the install belongs to its own issue, not to #267

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
CI=true pnpm release:smoke
```

```sh
gh workflow run smoke.yml --ref issue-267-fix-the-pnpm-install-step-in-the-scheduled-smoke
```

```sh
gh run view 40100082317 --log | grep -E "ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER|running \`pnpm lint\` in|passes \`pnpm lint\`"
```

- ✅ `pnpm lint` at `f8ea2557` → exit 0; oxlint, Stylelint and Prettier report no problem
- ✅ `pnpm typecheck` at `f8ea2557` → exit 0
- ✅ `pnpm test` at `f8ea2557` → exit 0; 455 tests pass, 0 fail
- ✅ C1 · `CI=true pnpm release:smoke` at `f8ea2557` on the dev box → exit 0; `` running `pnpm lint` `` in `full-database-d1-api-keys-organization`, `full-database-postgres-api-keys-organization`, `full-database-d1-api-keys-user` and `full-database-postgres-api-keys-user`; each one passes `pnpm lint`; 0 `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER` lines
- ✅ C2 · dispatched run [40100082317](https://github.com/mimukit/saasaloy/actions/runs/40100082317) on the branch at `1ffcb674` → conclusion `success` (`release-smoke` and `a11y` both pass); the same four `` running `pnpm lint` `` lines; each scaffold passes `pnpm lint` in 103 to 104 s; 0 `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER` lines
- C3 · the PR body links run 40100082317 → checked when the PR opens

## Not covered / needs human judgment
- Browser, accessibility, compatibility and UX: the change has no UI.
- Data and state: the change touches no data layer.
- Security, concurrency and performance: the change is one pnpm argument in a CI script.
- The local run of the old code under `CI=true`: not repeated. Scheduled runs 39121947695 to 40088299048 show the failure on the runner.
- The `schedule` trigger itself: only time shows it, so TC-1.1 stays with the human.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
