# QA Plan: Postgres only (remove the D1 driver)

_Generated 2026-11-21 · against `d83ab11b`, the rebuild of #366 on the render-and-merge engine (clean except this plan) · covers issue #366: the registry, the CLI engine, the tooling and CI, and the docs, wiki, site and ADRs · replaces `0121-qa-postgres-only-2026-11-20.md` of the first build_

## Summary
- Saasaloy now supports one SQL dialect, Postgres, and the `database-d1` driver and `onlyWith` are gone.
- Working means every gate passes, no shipped file names `database-d1`, and the docs and site explain the change correctly.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-366-remove-the-d1-driver-and-support-postgres-only` at `d83ab11b`.
- No credentials are necessary. The site is static.
- Screenshots: taken in the first build at `c6698034`, local and not committed. The site text they show did not change in the rebuild; the names under each case match the labels in the gallery at `~/qakit/0121-qa-postgres-only-2026-11-20/index.html`.

Launch with:

```sh
pnpm --filter @saasaloy/web build && python3 -m http.server 4399 --bind 127.0.0.1 --directory apps/web/dist/client
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Site built at `d83ab11b` | The why-Postgres page explains the trade-off correctly | 🔴 Critical |
| TC-1.2 | 1: Site built at `d83ab11b` | The landing page free-tier text reads correctly | 🟡 Normal |
| TC-2.1 | 2: Repository at `d83ab11b` | The README promise and the ADR 0065 text read correctly | 🟡 Normal |

## Scenario 1: Site built at `d83ab11b`

**Setup.** Run once, for every case in this scenario.

1. Start the site with the launch command in Environment.

- [ ] Setup complete

### TC-1.1: The why-Postgres page explains the trade-off correctly  ·  🔴 Critical

**Goal.** The page gives a fair and accurate reason for Postgres only, and it names what the move gave up.

**Steps**

1. Open http://127.0.0.1:4399/docs/why-postgres/ and read the whole page.
   - [ ] Each D1 limit matches what the named module does
     - the four limits: no interactive transaction, the bound-parameter cap, `CAST AS TEXT`, no `SELECT … FOR UPDATE`
     - the D1 numbers and their source URLs and date
     - the cost figures: 17 twin files, 34 `onlyWith` gates, 2 merge conflicts that became 19
     - screenshots: `why-postgres-light-1440` · `why-postgres-dark-1440` · `why-postgres-light-375` · `why-postgres-dark-375`
   - [ ] The loss is stated plainly: a deploy needs a Neon account, and local development needs Docker
   - [ ] The page reads well in light and dark, at 1440 px and 375 px

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The landing page free-tier text reads correctly  ·  🟡 Normal

**Goal.** The landing page states the Postgres free tier with the correct numbers and no D1 text.

**Steps**

1. Open http://127.0.0.1:4399/ and read the stack line and the runtime tiles.
   - [ ] The stack line and the `Hyperdrive` tile read correctly in place of D1
     - screenshots: `landing-light-1440` · `landing-dark-1440` · `landing-light-375` · `landing-dark-375`
2. Open the cost and provider questions in the FAQ.
   - [ ] The answers give the Neon numbers (1 GB, 100 compute hours a month, no credit card) and the Hyperdrive limit of 100,000 queries a day in clear words

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2. Stop the server with Ctrl+C.

## Scenario 2: Repository at `d83ab11b`

**Setup.** No setup. Open the files on the branch.

- [ ] Setup complete

### TC-2.1: The README promise and the ADR 0065 text read correctly  ·  🟡 Normal

**Goal.** The README keeps its free promise on the new basis, and ADR 0065 records the decision as the plan settled it.

**Steps**

1. Read the second-philosophy paragraph and the stack table of `README.md`.
   - [ ] The promise names Workers, Hyperdrive, KV, R2 and Neon, links https://neon.com/pricing, and keeps "a hosting bill close to zero"
2. Read `docs/adr/0065-adr-postgres-is-the-only-sql-dialect-2026-11-20.md` and the status of ADR 0026.
   - [ ] ADR 0065 states the decision, and ADR 0026 reads as superseded only where it keeps D1

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
ls modules/database-d1; grep -rn onlyWith modules
```

```sh
find modules -name '*.sqlite.ts' -o -name '*.d1.ts' -o -name '*.pg.ts'
```

```sh
grep -rln onlyWith packages/cli/src packages/cli/schemas
```

```sh
grep -rni 'd1' .github/workflows/
```

```sh
grep -rIn '\bD1\b' apps/web/src
```

```sh
bash -c "grep -rIl 'database-d1' . --exclude-dir={node_modules,.git,.dev,.afkkit,dist,.astro,.turbo} | sed 's#^\./##' | grep -vE '^(docs/(adr|plans|research|refactor|qa|status)/|packages/cli/CHANGELOG\.md)'"
```

```sh
pnpm exec turbo run test --force --concurrency=4 && pnpm run test:modules && pnpm run test:base && pnpm run test:tooling && pnpm run test:scripts
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm docs:check
```

```sh
pnpm docs:stale
```

```sh
pnpm scaffold:check
```

```sh
pnpm release:smoke
```

```sh
pnpm --filter @saasaloy/web build
```

- ✅ C1 · `ls modules/database-d1` → "No such file or directory"; `grep -rn onlyWith modules` → 0 lines
- ✅ C2 · the `find` for `.sqlite.ts`, `.d1.ts` and `.pg.ts` → 0 files
- ✅ C3 · `scripts/table-names.test.ts` keeps the plural-name checks and has no twin rule; `test:modules` (1700 tests) and `test:scripts` (1027 tests) pass inside the full suite
- ✅ C4 · `grep -rln onlyWith packages/cli/src packages/cli/schemas` → `lib/retired-keys.ts` and its test, plus 3 tests that prove the old-ref read or the strict refusal (`commands/env.test.ts`, `engine/project.test.ts`, `lib/schema.test.ts`); `render.ts` has no `gateOf` and no `variantSets`, and `project.ts` has no `variantSides`
- ✅ C5 · the full-suite command → exit 0 (the `saasaloy` package: 1352 tests in 75 files); `pnpm typecheck` → exit 0; `pnpm lint` → exit 0
- ✅ C6 · `grep -rni 'd1' .github/workflows/` → 0 lines
- ⚠️ C7 · `pnpm scaffold:check` at `4cbf667a` → exit 0. `pnpm release:smoke` at `4cbf667a` → exit 1, and only in the upgrade step, which now starts from 0.10.0: CLI 0.10.0 refuses `add mimukit/saasaloy@v0.10.0/email-react`. The next commit names the module bare for a 0.10.0 or later release (`upgradeAddTarget`, with tests). `pnpm release:smoke --upgrade-only` then stops on "the upgrade from 0.10.0 expects no update note, so the step proves nothing": no update note lies between 0.10.0 and 0.11.0. Neither cause is in this change, and the second one blocks the 0.11.0 release smoke until a note ships or the step changes. Every other smoke step passes, including the skipped-release step, which converts a 0.7.0 project and finds the base of 214 of 215 files (the 215th is the deleted block)
- ✅ C8 · `grep -rIn '\bD1\b' apps/web/src` → 0 lines
- ✅ C9 · the plan's target grep for `database-d1` → 1 file, `packages/cli/test/fixtures/old-descriptors/v0.9.0/auth/registry-item.json`, the exact v0.9.0 descriptor that proves B1
- ✅ C10 · `pnpm --filter @saasaloy/web build` → exit 0; `apps/web/dist/client/docs/why-postgres/index.html` has the title "Why Postgres, not D1 | Docs | Saasaloy"; the built landing page names Neon
- ✅ C11 · `pnpm docs:check` → "60 generated pages are current"; `pnpm docs:stale` → "every hand-written page is current"; 15 wiki pages carry `main`@`33bc729b`
- ✅ C12 · `packages/cli/package.json` reads 0.11.0 and `modules/database` requires `>=0.11.0`, because 0.10.0 shipped without this change; `packages/cli/CHANGELOG.md` opens with `## Unreleased` and a `### ⚠ BREAKING CHANGES` entry for `database-d1` and `onlyWith`
- ✅ C13 · B1 on the new engine: `retired-keys.test.ts` loads the v0.9.0 `auth` fixture at an old ref (valid, `onlyWith` read as `when.installed`), refuses the same load at the running CLI's ref, and selects only the `.pg.ts` source for each target with `database-postgres` installed; `engine/project.test.ts` proves a module with `onlyWith` at an old ref is not dropped by the partial load; `env.test.ts` covers the read at `entry.resolved`. The subagent broke the code 7 ways, and each break failed a test
- ✅ C14 · `release:smoke` ends with "updates a 0.7.0 project with a base found for each file and a deleted block kept deleted": the 0.7.0 `auth` descriptor carries `onlyWith`, so this run exercises the old-ref translation end to end
- ✅ C15 · ADR 0065 exists, ADR 0026 reads "superseded by ADR 0065", and ADR 0068 has a 2026-11-21 amendment for the driver-switch base search

## Not covered / needs human judgment
- The accuracy of the D1 numbers on the why-Postgres page against Cloudflare's pages on a later date: the page quotes them as read on 2026-11-20.
- The CI `scaffold` job with the `postgres:18` service and `--server`: only CI runs that path; a unit test covers the argument choice.
- The `e2e.yml` workflow: only CI runs it.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
