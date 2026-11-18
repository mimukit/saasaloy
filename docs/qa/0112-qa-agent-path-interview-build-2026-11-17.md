# QA Plan: agent path from init through the interview to the build (issue #347)

_Generated 2026-11-17 · against `0f56c3f4cc69b4bb7b43c4978077d9e3ceef9cac` (clean), refreshed 2026-11-17 against `859a27cc93ef93886a14151c161997a848bf44d2` (clean except this plan, untracked) after the fixes for B1 to B4 · covers issue #347 Phases 1 to 5: a fresh scaffold that passes its gate, the `scaffold` CI job and the nightly checks, the CLI release tag, the interview joined to the build, and the benchmark harness_

## Summary
- The branch makes one agent path (`saasaloy init`, the `saasaloy-setup` interview, the `saasaloy-build` skill) run on a fresh scaffold, and adds a benchmark that scores it.
- Working means that a fresh scaffold passes `pnpm check` after each build step, the skills agree on one path, and the release gates catch a broken scaffold or a bad benchmark run.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-347-make-the-agent-path-run-and-join-the-interview-to` at `859a27cc`. The only change in the tree is this plan, untracked. The fix commits are `86f14ceb`, `5d619d7e`, `2e745753` and `859a27cc`. The acceptance list is `.afkkit/checks.md` (C1 to C42). C34 is the only human-only check.
- The CLI is the local build: `node packages/cli/dist/index.js`, with `SAASALOY_REGISTRY_DIR` set to this worktree's `modules/`.
- Disposable target: a scaffold under `.dev/<name>/` in this worktree. The repo's `AGENTS.md` says to use `.dev` for every `saasaloy` CLI run. The reset is `rm -rf .dev/<name>`. A Postgres stack that a scaffold's `pnpm db:setup` starts is disposable too, and `docker compose down -v` in that scaffold removes it.
- No dev server and no browser driver is necessary. This change has no screen to judge, so this run took no screenshots.
- A real AI agent run (`claude`, `codex`) is the owner's step. The agent used `scripts/agent-bench/fake-agent.ts` only.

Build the CLI with:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh scaffold, owner at the keyboard | The interview text reads well to an owner | 🟡 Normal |
| TC-1.2 | 1: Fresh scaffold, owner at the keyboard | A live interview has the right tone and length | 🟡 Normal |

## Scenario 1: Fresh scaffold, owner at the keyboard

**Setup.** Run once, for every case in this scenario.

1. Make an empty folder under `.dev/`, then scaffold into it with the local CLI.

```sh
mkdir -p .dev/qa-owner && cd .dev/qa-owner && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js init . --force --yes --testing=tests-after
```

- [ ] Setup complete

### TC-1.1: The interview text reads well to an owner  ·  🟡 Normal

**Goal.** An owner who reads the interview questions and their sample answers understands each one and can answer it quickly.

**Steps**

1. Open `.agents/skills/saasaloy-setup/SKILL.md` in the scaffold. Read "Step 1 — the questions", "Propose the entities", "The capabilities question", "The driver question", "The preview question" and "The read-back".
   - [ ] Each of the fifteen questions reads as a plain question that an owner with no technical background can answer
     - the three sample answers under each question are realistic and different from each other
     - the entity proposal sample (fields, who may see it, actions, screens) is clear to an owner who never saw a database
     - the driver question explains the cost of `database-postgres` in owner words
   - [ ] The read-back and its "Build it?" answers (a, b, c) make clear what each answer starts

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A live interview has the right tone and length  ·  🟡 Normal

**Goal.** A real agent interview with the owner feels short, friendly and useful, and its samples help the owner answer.

**Steps**

1. Open your coding agent in `.dev/qa-owner`. Give it the sentence from `docs/wiki/how-to/build-with-an-agent.md`.

   ```text
   Build a SaaS MVP with Saasaloy (https://github.com/mimukit/saasaloy). Interview me first.
   ```

2. Answer each question. Use a sample answer at least three times.
   - [ ] The tone is friendly and direct, with no jargon the owner must look up
   - [ ] The length is acceptable: about fifteen questions, two or three for each message, and no question asked twice
   - [ ] The sample answers help: you can take, change or reject one quickly
3. Read the read-back. Answer `c` once, change one entity field, and read the new read-back.
   - [ ] The read-back shows the brief, the modules, each entity with its screens, the wishes not in this build and your steps, in one message that you can check in two minutes or less
4. Stop the agent before it starts the build. The build is out of scope for this case.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
rm -rf .dev/qa-owner
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Refresh: every check below ran again at `859a27cc93ef93886a14151c161997a848bf44d2`. The only change in the tree was this plan, untracked. No result from the first run at `0f56c3f4` is reused. Logs are in `.afkkit/logs/QA2-*.log` (gitignored, local to this run). Result: 41 agent checks, 41 ✅ and 0 ❌.

### Failures first

No agent check fails at `859a27cc`. The first run at `0f56c3f4` had 7 ❌ (C9, C13, C14, C30, C31, C36, C41), and its logs are `.afkkit/logs/QA-*.log`. The fixes for B1 to B4 in `.afkkit/findings.md` clear all of them:

- `86f14ceb` types the env copy in `dev-ports-script.test.ts` (B3). This clears C9, C13 and C14.
- `2e745753` counts only a `wrangler` subcommand or a deploy script as a deploy (B1). This clears C36 and C41.
- `859a27cc` makes the `AGENTS.md` stop rule name `./product-brief.md` too (B2). This clears C30 and C31.
- `5d619d7e` turns GitHub's 422 for a missing tag into the exit-2 refusal (B4).

### Commands run

The repo gate, once each:

```sh
pnpm typecheck
```

```sh
pnpm lint
```

```sh
pnpm test
```

Build the CLI:

```sh
pnpm --filter saasaloy build
```

The release smoke:

```sh
pnpm release:smoke
```

The scaffold job on the clean tree:

```sh
CI=true pnpm scaffold:check
```

The scaffold job with one injected error in a tracked template file, restored right after the run:

```sh
sed -i 's/^  ).join("");$/  ).join("") as string;/' packages/cli/templates/base/packages/ui/src/lib/random-id.ts && CI=true pnpm scaffold:check; git checkout -- packages/cli/templates/base/packages/ui/src/lib/random-id.ts
```

The C9 end to end run, one log per step in `.afkkit/logs/QA2-C9-NN-*.log`, from an empty `.dev/qa-e2e`, with `SAASALOY_REGISTRY_DIR` set:

```sh
node ../../packages/cli/dist/index.js init . --force --yes --testing=tests-after
```

```sh
pnpm lint && pnpm lint:types && pnpm env:setup && pnpm --filter @repo/web build && pnpm check
```

```sh
node ../../packages/cli/dist/index.js add database database-d1 api logger logger-console validators --yes && pnpm install --no-frozen-lockfile && pnpm db:setup && pnpm env:setup && pnpm db:seed && pnpm check
```

```sh
node ../../packages/cli/dist/index.js add shell auth app admin email email-console --yes && pnpm install --no-frozen-lockfile && pnpm --filter @repo/db db:generate && pnpm db:setup && pnpm env:setup
```

```sh
node ../../packages/cli/dist/index.js env --set EMAIL_PROVIDER=console --set EMAIL_FROM=noreply@example.test && pnpm env:setup && pnpm db:seed && pnpm check
```

The `init` variants, from `.dev/`:

```sh
node ../packages/cli/dist/index.js init qa-nogit --no-git --no-install
```

```sh
env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node ../packages/cli/dist/index.js init qa-noid --no-install
```

The Postgres no-migration run, from `.dev/qa-pg` after `init qa-pg --yes`:

```sh
node ../../packages/cli/dist/index.js add database database-postgres --yes && pnpm install --no-frozen-lockfile && pnpm db:setup && docker compose down -v
```

The live missing-tag refusal, from a scaffold, with no local registry and no token:

```sh
env -u SAASALOY_REGISTRY_DIR -u GITHUB_TOKEN -u GH_TOKEN node ../../packages/cli/dist/index.js list --json
```

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/mimukit/saasaloy/commits/v0.9.0
```

The benchmark with the fake agent, with the runs folder in the session scratchpad:

```sh
node scripts/agent-bench.ts --interview --brief shelfnote --agent "node scripts/agent-bench/fake-agent.ts" --runs "$RUNS_DIR" --no-build --static
```

```sh
node scripts/agent-bench.ts --interview --brief shelfnote --agent "node scripts/agent-bench/fake-agent.ts" --runs .dev/qa-runs --no-build --static
```

The test sets:

```sh
node --test scripts/agent-bench/score.test.ts scripts/agent-bench/interview.test.ts scripts/agent-bench/harness.test.ts scripts/agent-bench/agent-bench.test.ts
```

```sh
node --test scripts/release-preflight.test.ts scripts/skills.test.ts scripts/llms-txt.test.ts scripts/product-spec.test.ts scripts/scaffold-check.test.ts scripts/release-smoke.test.ts scripts/release-order.test.ts
```

```sh
cd packages/cli && pnpm exec vitest run src/commands/release-tag.test.ts src/lib/cli-requires.test.ts src/lib/registry.remote.test.ts src/lib/updater.test.ts --reporter=verbose
```

The site build:

```sh
pnpm --filter @saasaloy/web build && cmp apps/web/dist/client/llms.txt llms.txt
```

The probes of `deployCalls`, `judgePreview`, `checkBenchmark` and `llmsSurfaceProblems` are small node scripts in the session scratchpad that import the exported functions. Their output is in `QA2-C36-deploy-calls-probe.log`, `QA2-C41-bench-gate-probe.log` and `QA2-C18-llms-surface.log`.

### Acceptance checks (`.afkkit/checks.md`)

Phase 1, make the path run on main:

- ✅ C1 · In a fresh `init . --yes --testing=tests-after` scaffold, `pnpm lint` exits 0 and `pnpm lint:types` exits 0. The type-aware pass covers `packages/{config,env,tooling,ui}/src`, which holds all eight files. The injected run of C13 shows that the pass reads them.
- ✅ C2 · Right after `init`, `packages/env/.env` is absent. `pnpm env:setup` exits 0 and `pnpm --filter @repo/web build` exits 0 ("5 page(s) built"). After the MVP add, `pnpm env:setup` exits 1 with "api has no value for EMAIL_FROM, EMAIL_PROVIDER".
- ✅ C3 · `saasaloy env --from-file` with `PUBLIC_SITE_URL=http://localhost:3000` exits 0 and writes the key. A file with `NOT_DECLARED_KEY=x` exits 2: "No installed module declares NOT_DECLARED_KEY, and packages/env/.env.example does not list it — nothing written."
- ✅ C4 · `init` leaves branch `main` with 1 commit, `0b8e69a chore(repo): initial commit`. `--no-git` leaves no `.git` (`rev-parse` exit 128). With no git identity, `init` exits 0, prints "Made no commit: no git identity is set (user.name and user.email)", and `HEAD` does not exist.
- ✅ C5 · D1: `pnpm db:setup` exits 0 with "No migration exists yet, so there is nothing to apply." Postgres (Docker backend): exit 0 with "No migration exists yet, so db:migrate is skipped." The stack `qa-pg` was removed with `docker compose down -v`.
- ✅ C6 · `saasaloy-build/SKILL.md` runs `pnpm env:setup` after every `add` (line 105), names `pnpm --filter @repo/db db:generate` before `pnpm db:setup` (lines 103 and 104), runs `pnpm install --no-frozen-lockfile` (line 101), and makes the first commit at Intake when `init` skipped it (line 64).
- ✅ C7 · Base `AGENTS.md:271` and `saasaloy-build/SKILL.md:20` agree. The agent runs `pnpm env:setup` itself and writes `packages/env/.env` only through `saasaloy env`. `AGENTS.md:277` forbids a hand edit.
- ✅ C8 · `saasaloy-build/SKILL.md` has "A dirty tree on resume" (line 40). Step 0 reads finished stages from `feat(build): <stage>` subjects in `git log main..HEAD` and writes a missing `Commit:` line from them (lines 31 and 32).
- ✅ C9 · Every step exits 0 in the build-skill order: `init`, `pnpm check` after `init`, Validate add, install, `db:setup`, `env:setup`, `db:seed`, `pnpm check`, MVP add, install, `db:generate`, `db:setup`, `env --set`, `env:setup`, `db:seed`, `pnpm check`. The one expected exit 1 is the first `env:setup` after the MVP add, which names the two keys (C2). After the MVP add, `pnpm test` gives 287 vitest tests passed, and `pnpm build` gives "4 successful, 4 total".

Phase 2, scaffold check on every PR:

- ✅ C10 · `.github/workflows/ci.yml` has job `scaffold` (line 77): checkout, pnpm, node, `pnpm install --frozen-lockfile`, `pnpm scaffold:check`. The script builds the CLI, runs `init` with `--testing=tests-after`, adds the 12 `MVP_MODULES` on `database-d1` from `modules/`, and runs `pnpm check`.
- ✅ C11 · `FULL_SCAFFOLD_CHECKS` is `lint`, `typecheck`, `test`, `build`. In this smoke run all four full scaffolds pass all four checks, for example "full-database-postgres-api-keys-user passes `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (210s)" and "full-database-d1-api-keys-user passes … (244s)".
- ✅ C12 · In this smoke run the three 2026-11-17 failures do not occur. The web dev step on `http://localhost:3000/` passes. `ecommerce` is left out of the D1 scaffolds (52 modules for D1, 53 for Postgres) and no add fails. `pnpm lint` passes in all four full scaffolds.
- ✅ C13 · `CI=true pnpm scaffold:check` on the clean tree exits 0: "a fresh scaffold with 12 modules on database-d1 passes `pnpm check` (43s)". With `as string` injected into `packages/cli/templates/base/packages/ui/src/lib/random-id.ts`, it exits 1 with "random-id.ts:15:15: error typescript(no-unnecessary-type-assertion)" and "scaffold-check: pnpm check failed". `git checkout` restored the file, and `git status --porcelain` then showed only this plan.
- ✅ C14 · `pnpm release:smoke` exits 0. The last line is "saasaloy@0.9.0 packs, installs outside the workspace, scaffolds a project that takes the api module and serves its web app in dev, passes `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` with every module and testing on in 4 project(s)". The upgrade step lists all 19 expected update notes.

Phase 3, one version:

- ✅ C15 · Live, `saasaloy list --json` with no `SAASALOY_REGISTRY_DIR` and no token exits 2. The message reads "mimukit/saasaloy has no tag v0.9.0 for saasaloy 0.9.0, the CLI that runs." It names `saasaloy add <module>@main` and `saasaloy list @main`. GitHub answers 422 for `commits/v0.9.0`, and 200 for `v0.8.0` and `main`. The tests "resolves the running CLI's release tag …", "keeps a 422 for another cause an error, not a missing tag" and "lists the module merged after the tag with @main" pass.
- ✅ C16 · `release-tag.test.ts` "keeps a lock that names a main commit valid, and update moves it to the tag" and the six `compareInstalled — the release tag (ADR 0062)` tests pass.
- ✅ C17 · `docs/adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md` exists with status "accepted. Amends ADR 0012". ADR 0012's status line says "Amended by ADR 0062 (2026-11-17)".
- ✅ C18 · Against the built CLI, `llmsSurfaceProblems` gives `[]` for the real `llms.txt`. A copy that names `saasaloy-buildx`, `saasaloy launch` and `list --jsonx` gives three problems, one for each. `release-preflight.ts` calls `fail("llms.txt names what the release does not hold")` on a non-empty list.
- ✅ C19 · `llms.txt` `## Prerequisites` (lines 7 to 15) names Node 24.15.0+, pnpm 12.3.4, a git identity, network access to the npm registry, `api.github.com` and `codeload.github.com`, and `GITHUB_TOKEN`.
- ✅ C20 · `cli-requires.test.ts` "prints a command that installs a version inside the floor, never @latest" passes. The command shape is `pnpm add --global 'saasaloy@<range>'`. `npm view 'saasaloy@>=0.8.0' version` gives `0.8.0`, so the range form resolves to a version inside the floor.
- ✅ C21 · All seven `release-tag.test.ts` tests pass against a real temporary git registry with tag `v<version>` and a later `main` commit. `list` gives the tag's modules only, `list @main` adds the later module, `add late` exits 2, and `add late@main` applies it.

Phase 4, join the interview to the build:

- ✅ C22 · `saasaloy-setup/SKILL.md` has questions 1 to 10 (landing) and 11 to 15 (entities, order, capabilities, driver, preview). Question 11 is a proposal of one table for each entity with Table, Fields, Who may see it, Actions and Screens, and the owner corrects it.
- ✅ C23 · Step 0 item 6 reads `saasaloy list --json` once for questions 13 and 14. "The driver question" recommends `database-postgres` when a pick depends on it, and `database-d1` otherwise.
- ✅ C24 · Question 15 is "always the last question". It records `deploy: preview` or `deploy: none` in the brief's frontmatter (SKILL.md lines 227 and 316).
- ✅ C25 · "The read-back" has the six parts in order (brief, module list, entities with screens, not in this build, left for the owner, what happens next) and one "Build it?" question. Answer a sets `autonomy: afk`, rewrites `weak:` as `weak-accepted:` and approves the screens.
- ✅ C26 · The skill writes `docs/product-brief.md` and `docs/product-spec.md` from `product-spec-template.md`. `scripts/product-spec.test.ts` passes, including the fixed `##` headings check.
- ✅ C27 · `saasaloy-build/SKILL.md` takes the driver from the spec's `## Database driver` (rule 2), adds the spec's picks (rule 5), and the Feature stage builds every entity in order, "with no limit", one `feat(build): feature <table>` commit each.
- ✅ C28 · `saasaloy-feature/SKILL.md` "Read the spec" maps Fields to columns, Actions to routes and Screens to `DataTable` (`@repo/ui/blocks/shell/data-table`), `DetailPanel`, `Form` and `Field` (`@repo/ui/components/shell/*`). The `skills.test.ts` test that the shell module writes each part passes.
- ✅ C29 · Build rule 5 gives a pick with a non-empty `needs` its local provider and puts the vendor step under `## Left for a human`. `skills.test.ts` "gives a picked module that needs an account its local provider" passes.
- ✅ C30 · `llms.txt:19`, the wiki page, base `AGENTS.md` "Unattended work" and the `init` next steps (`/saasaloy-setup  # the interview; it starts the build`) give one path. The wiki page says "You write no file, scaffold nothing, and copy no env values first". `AGENTS.md:270` now stops only "When neither `docs/product-brief.md` nor `./product-brief.md` exists", which agrees with `llms.txt:30` and `saasaloy-build/SKILL.md:26`.
- ✅ C31 · `llms.txt:29`, `AGENTS.md:270`, `saasaloy-setup/SKILL.md:36` and `saasaloy-build/SKILL.md:26` tell an agent with no brief in either place and no person to write nothing, say why, and stop. The `skills.test.ts` test "stops only with no brief in docs/ or the folder, and counts a scripted owner as a person" passes.
- ✅ C32 · `README.md` line 5 is a TIP callout under the title: "Are you an AI agent? Read `llms.txt` first." `pnpm --filter @saasaloy/web build` exits 0, and `cmp apps/web/dist/client/llms.txt llms.txt` reports no difference.
- ✅ C33 · At `859a27cc`: `pnpm typecheck` exits 0, `pnpm lint` exits 0, and `pnpm test` exits 0. The CLI has 2087 tests in 78 files, the scripts have 901, and every suite reports 0 fail. `skills.test.ts` and `llms-txt.test.ts` pass in that run, and again in the script set (164 of 164).

Phase 5, benchmark harness:

- ✅ C35 · Interview mode with the fake agent made 11 calls in one session. Call 1's stdin is the one sentence in `scripts/agent-bench/opening.md`. Call 2 is "1. Shelfnote" from `briefs/shelfnote/answers.md`, calls 3 to 10 carry the numbered answers and one follow-up, and call 11 is the read-back answer `a`.
- ✅ C36 · `MVP_BAR` has the new lines 8 (interview, PASS in the fake run), 9 (each spec entity) and 10 (preview, N/A in the fake run). The probe gives `deployCalls` = `[]` for a `grep` and a `cat` of `apps/api/wrangler.jsonc` and an `rm -rf apps/api/.wrangler/state`, and `judgePreview("none")` = N/A. `pnpm exec wrangler deploy`, `npx wrangler@4 deploy`, `pnpm deploy:preview` and `wrangler secret put` each still give FAIL.
- ✅ C37 · The run folder is in the session scratchpad, outside the repo. The agent's cwd, `SAASALOY_REGISTRY_DIR` and first PATH entry are all under that folder, and the agent has no `GITHUB_TOKEN`. The run took block 116 (ports 11160 to 11169), and the agent got `DEV_PORTS_BLOCK=116`. `--runs .dev/qa-runs` exits 2.
- ✅ C38 · `--agent "node scripts/agent-bench/fake-agent.ts"` ran in place of the default, and `score.md` records it on its `Agent:` line.
- ✅ C39 · `score.md` and `run.json` record `Time: 0 min`, `Turns: 22 over 11 agent calls` and `Cost: $0.11, the sum of what each agent call reported`.
- ✅ C40 · `briefs/prepline/` (team product, `teams` and `multitenant`) and `briefs/receiptbox/` (paid product, `payment` with its local provider) each hold `answers.md`, `brief.md`, `env` and `expect.json`, marked "draft, awaiting the owner's approval in #350".
- ✅ C41 · Through the exported functions:
  - a non-gated change with no report passes;
  - a base skill change with no report is refused;
  - a contract change with a clean three-brief report is cleared;
  - a report that does not cover HEAD is refused;
  - this branch since `v0.8.0` (186 gated paths) is refused, because report 0005 has no interview score for the three briefs;
  - a `deploy: none` run that only read `wrangler.jsonc`, scored by the fixed scorer, gives an N/A row, and its report clears an MVP module change.

  CONTRIBUTING.md line 562 states the rule.
- ✅ C42 · `node --test` on the four `scripts/agent-bench/*.test.ts` files: 86 pass, 0 fail.

### Other observations

- The fixed `deployCalls` still counts two commands that deploy nothing. `pnpm exec wrangler d1 execute DB --local --command 'select 1'` counts because the `d1` subcommand matches. `pnpm deploy:production --dry-run` counts because the script name matches. No shipped skill tells an unattended build to run either one, so no check changes. A real run in #350 shows if an agent runs them.
- `AGENTS.md:269` still names only `docs/product-brief.md` as the place of `autonomy: afk`. The build's Intake moves `./product-brief.md` to `docs/` first, so this agrees with the build skill.
- `score.md` of the fake run says `Tree: dirty`, because this plan was untracked in the tree during the run.

### Browser checks
_No browser check applies. The change has no screen, and this run started no browser._

## Not covered / needs human judgment
- C34: the tone and length of the interview, and the help that the sample answers give. Scenario 1 covers it.
- A real agent run of the interview and the build (`claude -p`, the three benchmark briefs). The owner runs them in issue #350. The cost sum over `--resume` calls and the question matching against real agent output stay unverified until then.
- The scorer's runtime lines on a port block (`pnpm dev:ports`, `pnpm dev`, the 401 entity probe). They need a full scaffold built by an agent.
- A live `list @main --json` against GitHub. It downloads more than 50 modules and passes the anonymous rate limit. The temporary git registry tests cover it.
- The nightly smoke workflow on GitHub. It runs only after merge.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
