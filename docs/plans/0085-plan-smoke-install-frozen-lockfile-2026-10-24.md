# Plan: unfreeze the scaffold installs in the scheduled smoke job

Grilled: 2026-10-24

## Context

Issue #267. The scheduled `smoke` workflow (`.github/workflows/smoke.yml`, job `release-smoke`) stops at `pnpm install in full-database-d1` with `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER`. The issue dates the first failure to 2026-10-19. The run history puts it one day earlier: runs 39121947695 and 39132580896 on 2026-10-18 fail at the same step, and the last green run is 39026153848 on 2026-10-17. Every run since has failed, up to 40088299048 on 2026-10-24.

The full error line in run 39947749613 names the cause, which the issue body cut off:

```
Cannot install with "frozen-lockfile" because pnpm-lock.yaml has no
`importers["apps/admin"]` entry. Regenerate the lockfile with `pnpm install --lockfile-only`.
```

GitHub Actions sets `CI=true`, and pnpm turns `frozen-lockfile` on by default when `CI` is set. `lintFullScaffold` in `scripts/release-smoke.ts` installs twice: once on the bare base, which writes `pnpm-lock.yaml`, and once after 40 `saasaloy add` runs, which create new workspaces such as `apps/admin`. The second install meets a lockfile that lacks those workspaces and refuses. The dev box has no `CI` variable, so the same script passes there. The pnpm version is not the cause: the runner logs `Done in 6.6s using pnpm v12.3.4`, the same version as the dev box.

The step arrived with commit `596b0580` (`ci(repo): lint every module in a real project in the smoke`, merged in #159 on 2026-10-18). It has never passed in CI. This is a gap in that commit, not a regression from a later change.

Goal: the daily smoke job reaches the checks it exists for, `pnpm lint` and later the full-scaffold typecheck from #220, so it warns again about breaks that arrive with no commit of ours.

Target: a `workflow_dispatch` run of `smoke` on the PR branch logs `` release-smoke: running `pnpm lint` in full-database-d1 `` (and the same line for `full-database-postgres`). #267 closes on that line. The job may stay red after it, and a failure after the install belongs to the issue that owns it, not to #267.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the fix goes | `scripts/release-smoke.ts`, not `smoke.yml`. The release preflight runs the same script, so a workflow-only fix leaves `CI=true pnpm release:preflight` broken. |
| How to unfreeze | Pass `--no-frozen-lockfile` to the scaffold installs. Each scaffold is a fresh project with no committed lockfile, the state a developer is in on their own machine. Removing `CI` from the child env is the rejected alternative: it also changes how turbo, vitest and the other tools in `pnpm lint` behave, and the smoke wants those to run the CI way. |
| Which installs take the flag | All three scaffold installs: the two in `lintFullScaffold` and the one in `projectDir` (`run("pnpm", ["install"], ...)` near line 623). Only the second `lintFullScaffold` install fails today, but the other two pass only because no lockfile exists yet. One rule for every scaffold install keeps the next added step from failing the same way. One shared constant holds the argument list, with a comment that names `CI=true` as the reason. |
| Test approach | No new unit test. The fix is an argument list, and the check that proves it is the run itself, locally with `CI=true` and on the runner. `scripts/release-smoke.test.ts` covers the pure helpers only and stays as it is. |
| When #267 closes | When the runner gets past the install and logs `` running `pnpm lint` `` in both full scaffolds. A green job is not required. |
| Where the runner proof comes from | A `workflow_dispatch` run of `smoke` on the PR branch, before the merge: `gh workflow run smoke.yml --ref <branch>`. Approved outward action, so an unattended build runs it without a stop. The PR body links the run ID. |
| Install error output | No change to `runQuiet`. The frozen-lockfile line was in its last 30 lines. Only the issue body cut it off. |
| The auth lint failure from #220 | #266 owns it. `71e5badb` (PR #261) already fixed the 9 errors in `modules/auth/files/api/routes/auth.vitest.ts`, and plan 0086 closes the `*.vitest.ts` lint gap. The dispatched run in Phase 2 is the first CI evidence for #266 too. |
| Overlap with plan 0086 | Plan 0086 adds `--testing=tests-after` to the `init` call in `lintFullScaffold`, next to the installs this plan changes. The second of the two PRs to merge rebases over the first. |

## Approach

Change the install argument list in `scripts/release-smoke.ts`, then prove it with `CI=true` on the dev box and with one dispatched run. It reuses `runQuiet`, `run` and `lintFullScaffold` as they are.

### Phase 1: unfreeze the scaffold installs (built 2026-10-24)

- Add a constant near the top of `scripts/release-smoke.ts`, for example `const SCAFFOLD_INSTALL = ["install", "--no-frozen-lockfile"] as const;`, with a comment: the runner sets `CI=true`, pnpm then freezes the lockfile, and a scaffold's lockfile is never committed, so `add` outgrows it.
- Use the constant in the three scaffold installs.
- Leave `.github/workflows/smoke.yml` unchanged. Its own `pnpm install --frozen-lockfile` is for this repo, which commits its lockfile.
- Run the repo gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

Done when: `CI=true pnpm release:smoke` on the dev box prints `` release-smoke: running `pnpm lint` in full-database-d1 `` and the same line for `full-database-postgres`, and prints no `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER`. The same command without the fix fails at `pnpm install in full-database-d1`, which shows the local run reproduces the CI fault.

### Phase 2: prove it on the runner (built 2026-10-24)

- Push the branch, then run `gh workflow run smoke.yml --ref <branch>`.
- Wait for the run. Read its log for the two `` running `pnpm lint` `` lines.
- Put the run ID and its result in the PR body. Name any failure after the install and the issue that owns it.

Done when: the dispatched run on the PR branch logs `` release-smoke: running `pnpm lint` in full-database-d1 `` and the same line for `full-database-postgres`, and logs no `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER`. The PR body links that run.

## Open questions

None. The grill on 2026-10-24 settled all three.

## Non-goals

- The auth lint failure and the `*.vitest.ts` lint gap (#266), #252 (`@repo/admin` payments imports) and #253 (`SendEmail` in `@repo/email-react`). Each has its own issue.
- A green `smoke` job. #267 closes once the job gets past the install.
- The `a11y` job in the same workflow.
- `saasaloy init` and `saasaloy add` behaviour in a user's CI. `init` installs with no lockfile, and a user's CI installs a lockfile they committed.
