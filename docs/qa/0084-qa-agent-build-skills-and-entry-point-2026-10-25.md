# QA: the build skill, the feature recipe and the consumer entry point

Issue: #228. Plan: [0074](../plans/0074-plan-agent-native-mvp-build-2026-10-21.md), phases 11 to 13. Branch: `issue-228-take-an-unattended-agent-from-brief-to-mvp`. Every automated result below ran against `3237af6f`, except C15, which ran against `819b7ffc` after the fix commit. The fix edits one skill file, and C2 to C5 re-ran on `819b7ffc` with the same result.

## Automated checks

| ID | Check | How | Result |
|----|-------|-----|--------|
| C1 | `saasaloy-build` and `saasaloy-feature` ship in the base and link into `.claude/skills/` | `init . --force --no-install --testing=tests-after` in `.dev/qa228` beside the benchmark brief, then `node packages/tooling/src/link-skills.ts` | ✅ both folders in `.agents/skills/`, both symlinks in `.claude/skills/`, the brief and `env` kept, testing mode `tests-after` |
| C2 | every module skill has a `## Next` section naming an existing skill | `node --test scripts/skills.test.ts` | ✅ |
| C3 | every skill of a module that writes a `@ui/blocks/` target has a Wire-up section | same | ✅ |
| C4 | email, logger, sms, kv, storage, queue, validators and teams have removal and failure-mode sections | same | ✅ |
| C5 | the skill lint test fails when a rule breaks | renamed `## Next` in `saasaloy-kv` and `## Wire-up` in `saasaloy-waitlist`, ran the test, restored both | ✅ exit 1, naming both skills |
| C6 | `llms.txt` says what Saasaloy is, how to start, that a complete brief is required, and where the build skill is | read the file | ✅ |
| C7 | the wiki how-to covers the brief, the env file, the prompt, the build log, `build/mvp` and the human steps | read `docs/wiki/how-to/build-with-an-agent.md` | ✅ |
| C8 | root `AGENTS.md` sends a consumer agent to `llms.txt`; `README.md` and the wiki index link the how-to | read the three files | ✅ |
| C9 | every link in `llms.txt` resolves, and the test catches a dead one | `node --test scripts/llms-txt.test.ts`, then with one link pointed at a missing file | ✅ pass, then exit 1 on the dead link |
| C10 | one benchmark run prints PASS on every MVP bar line | not run | ❌ not run: another project's dev servers held ports 3000, 3001 and 4000 |
| C11 | the final run is saved as a research report that links its build log | not run | ❌ depends on C10 |
| C12 | a FAIL line left after 3 runs is listed with its `needs-planning` issue | not run | ❌ depends on C10 |
| C13 | the release checklist in `CONTRIBUTING.md` has a benchmark line | read "Releasing", "Before you run it" | ✅ |
| C14 | lint and the script tests stay green | `pnpm lint`; `pnpm test:scripts` (479 tests); `vitest run` of `init.test.ts` and `add.test.ts` (150 tests) | ✅ |
| C15 | the build skill's add step runs with no `--with` error | `add database database-d1 api logger logger-console validators --dry-run --yes` in a fresh `.dev` project | ✅ exit 0 at `819b7ffc` |

## Manual cases

1. Run the benchmark on a box with no other dev server on ports 3000 to 3003 or 4000: `ss -ltn | grep -E ':(300[0-3]|4000)\b'` prints nothing, then `node scripts/agent-bench.ts`. Expect the agent to find `saasaloy-build`, leave one commit per stage on `build/mvp`, and write `docs/build-log.md`. Record the score table as the next `docs/research/` report beside the baseline.
2. For each FAIL line, fix it on this branch or file a `needs-planning` issue, and run again, three runs at most.
3. Read `saasaloy-build` and `saasaloy-feature` as an agent would. Each step names a command or a skill section that exists.
