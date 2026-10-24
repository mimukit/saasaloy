# QA Plan: Agent benchmark and baseline

_Generated 2026-10-24 · updated 2026-10-24 against `feab7f4` (clean, plus this file; rebased onto `main`, which holds neither #223 nor #224) · covers `scripts/agent-bench.ts`, `scripts/agent-bench/`, and `docs/research/0005-research-agent-bench-baseline-2026-10-24.md` (issue #222)_

## Summary

- The benchmark starts a headless Claude Code run on a fixed brief and scores the result against the plan 0074 MVP bar.
- "Working" means a PASS/FAIL table with 7 rows, no process left after the run, and a baseline report that names where the agent stopped.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-222-add-an-agent-benchmark-and-record-the-baseline`.
- The baseline run folder is `.dev/bench/2026-10-24T02-44-17-861Z/` in the worktree. Its logs are in `.dev/bench/2026-10-24T02-44-17-861Z.out/`. Git ignores both.
- Scenario 2 needs the `claude` CLI and its credentials, and it costs about $1.

```sh
cd ~/worktrees/saasaloy/issue-222-add-an-agent-benchmark-and-record-the-baseline && pnpm install
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Branch checked out, no agent run | The brief fixture is a fair input | 🔴 Critical |
| TC-1.2 | 1: Branch checked out, no agent run | The baseline report names the right stop point | 🔴 Critical |
| TC-1.3 | 1: Branch checked out, no agent run | The env fixture is safe to commit | 🟡 Normal |
| TC-2.1 | 2: Box with no other dev server running | A new run ends with the table and no process left | 🟢 Low |

## Scenario 1: Branch checked out, no agent run

**Setup.** No setup. The Environment step is enough.

- [ ] Setup complete

### TC-1.1: The brief fixture is a fair input  ·  🔴 Critical

**Goal.** The brief is a complete B2C single-user brief that a human would write, with `autonomy: afk`.

**Steps**

1. Open `scripts/agent-bench/brief.md`.
   - [ ] The brief is complete and plausible for a B2C single-user product
     - the frontmatter holds `autonomy: afk`
     - all ten `saasaloy-setup` sections are present and filled, with no `weak:` tag
     - the extra "Core feature" section names `books` and its fields; decide if you accept this eleventh section
   - [ ] The product (Shelfnote, a private reading log) is the product you want the benchmark to use

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The baseline report names the right stop point  ·  🔴 Critical

**Goal.** The report states the first step where the agent stopped, and its limits are honest.

**Steps**

1. Open `docs/research/0005-research-agent-bench-baseline-2026-10-24.md`.
   - [ ] "Where the agent stopped" names a step you agree is the first one the agent did not reach
     - the report names the signed-in product UI: no `app` module on `main`, so the agent put the reader screens in `apps/web`
   - [ ] The "Limits of this run" section is enough for you to trust the baseline
     - the agent read the parent repo's README, two wiki pages and the head of `scripts/agent-bench.ts`
     - the repo's project skills loaded
     - the first attempt was stopped and not scored
2. Open the score of the run.

   ```sh
   cat .dev/bench/2026-10-24T02-44-17-861Z.out/score.md
   ```

   - [ ] The table in the report matches this file

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The env fixture is safe to commit  ·  🟡 Normal

**Goal.** The committed env file holds no real credential.

**Steps**

1. Open `scripts/agent-bench/env`.
   - [ ] Every value is a loopback URL, a provider name, a test address or the bench-only secret

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** No reset. Scenario 1 changes nothing.

## Scenario 2: Box with no other dev server running

**Setup.** Run once, for the case in this scenario.

1. Stop every dev server on the box. The agent runs `pkill -f "wrangler|vite"`, which also stops servers outside its folder.
2. Confirm that ports 3000, 3001, 3002 and 4000 are free.

```sh
for p in 3000 3001 3002 4000; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "port $p busy"; done; echo checked
```

- [ ] Setup complete

### TC-2.1: A new run ends with the table and no process left  ·  🟢 Low

**Goal.** A second run reaches the same end state and leaves the box clean.

**Steps**

1. Start the benchmark. It takes about 10 minutes.

   ```sh
   node scripts/agent-bench.ts
   ```

   - [ ] The output ends with a 7-row table and the line "no process the benchmark started is still running"
2. Compare the new score with the baseline.
   - [ ] Differences from the baseline are ones you can explain by a second run of the same agent

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Remove the new run folder and its logs. Replace `<run-id>` with the id the run printed.

```sh
rm -rf .dev/bench/<run-id> .dev/bench/<run-id>.out
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm run typecheck:scripts
```

```sh
pnpm run lint
```

```sh
pnpm run test:scripts
```

```sh
node --test scripts/agent-bench/score.test.ts
```

```sh
node scripts/agent-bench.ts
```

```sh
node scripts/agent-bench.ts --score .dev/bench/fixture-runtime
```

- ✅ C4 · `pnpm run typecheck:scripts` at `feab7f4` → exit 0
- ✅ `pnpm run lint` (all four passes) at `feab7f4` → exit 0
- ✅ `pnpm run test:scripts` at `feab7f4` → 426 tests, 0 fail
- ✅ C4 · `node --test scripts/agent-bench/score.test.ts` at `eefe231` and `feab7f4` → 17 tests, 0 fail. Each parser test was seen red under a deliberate break (status order, seed count, empty-count match, FAIL-row filter, turbo prefix), then green after the break was reversed.
- ✅ B1 fix · `findConsoleMail` on a mail with `@repo/api:dev: ` before each line → finds the mail (test "finds the mail behind turbo's task prefix")
- ✅ B2 fix · `--score` on a fixture whose `check` script is `sleep 313`, then SIGHUP to the runner after 6 s → the runner exits and no `sleep 313` process is left
- ✅ C1 · `node scripts/agent-bench.ts` (run `2026-10-24T02-44-17-861Z`, code of `0b58314`; the later fix changes only the signal handling and the mail parser, which this run did not reach) → the output ends with a 7-row PASS/FAIL table, 1/7 pass
- ✅ C2 · the same run → the runner printed "no process the benchmark started is still running"; afterwards ports 3000, 3001, 3002 and 4000 were free
- ✅ C2 · `--score` on a project scaffolded from `main` with `auth`, `admin`, `email` and `email-console` (code of `2ff37d5` plus the reset fix) → 7 rows; ports free and no process with its working directory in the fixture afterwards
- ✅ C3 · `--score --static` on a fixture project with a build log → each FAIL row printed `stop point: stage "Stage 2: modules" is stopped; blocked: saasaloy env has no flag for a value.`
- ✅ C3 · the baseline project has no `docs/build-log.md` → each FAIL row printed `stop point: no docs/build-log.md`
- ✅ C5 · `docs/research/0005-research-agent-bench-baseline-2026-10-24.md` exists and names the first step where the agent stopped (the signed-in product UI)
- ✅ C7 · `scripts/agent-bench/prompt.md` names the repo URL, `./product-brief.md` and `./env`, and asks for a SaaS MVP, nothing else
- ✅ Isolation · a probe with the user `CLAUDE.md` excluded → the agent reported no CLAUDE.md, AGENTS.md or user-instruction content in its context
- ❌ Isolation · the baseline agent ran `cd ../../..` and read the parent repo's README, two wiki pages and the first 60 lines of `scripts/agent-bench.ts`. Known limit, recorded in the report; the issue keeps the run inside `.dev/bench/`.

### Browser checks

_No browser checks. The change is a script and a report, with no screen._

## Not covered / needs human judgment

- The fitness of the brief and of the report's conclusion (TC-1.1, TC-1.2).
- Run-to-run variance: one baseline run cannot show it. TC-2.1 gives a second data point.
- The scorer's HTTP lines against a project that passes them: no project on `main` can, so the PASS branches of the auth and reset lines have not run yet. Phase 13 of plan 0074 runs them.
- Compatibility, accessibility and performance: the change has no UI and no runtime path in a shipped project.
- Security: the runner removes `GITHUB_TOKEN` and `GH_TOKEN` from the agent's env. No check confirms that the agent could not push by another credential on the box.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
