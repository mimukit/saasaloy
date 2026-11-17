# Research: how agent native Saasaloy is, and what is missing

Created on 2026-11-17. Source revision is `25feb934` on `main`. The published CLI is `saasaloy@0.8.0`. This document gives an opinion. It changes no source file.

Review: pending

## Question

The goal is a project that is completely agent native. Any AI agent that gets this repo can take a new SaaS product from nothing to an MVP, with no person at the keyboard. How near is the project to that goal, and what is missing?

## Method and limits

Seven subagents on the Sonnet model collected facts. Six read one slice each: the CLI, the agent layer of a generated project, the module catalogue, the verification loop, the deploy path, and the discovery surface. The seventh ran the documented path in `.dev/agent-audit/`, first with `npx saasaloy@latest` and then with the local build.

The main session then rebuilt the CLI from `main` and ran the path again in `.dev/agent-audit/verify`. Every fact in "The path does not run today" comes from that run or from a command the main session ran. A fact marked "(collected)" comes from a subagent and has no second check.

Limits:

- No AI agent ran the build. The run covers the mechanical steps of the Intake, Validate and MVP stages. The Brand and Feature stages did not run.
- The agent benchmark (`scripts/agent-bench.ts`) did not run. It needs ports 3000, 3001 and 4000 free, and it costs money.
- No deploy ran.

## The owner's decisions

The owner answered the three open decisions on 2026-11-17. They set the target for the rest of this document.

1. The MVP ends at a local app. A preview deploy is a separate step.
2. An agent may write the brief, and it first interviews the owner.
3. An agent may make a preview deploy. The interview collects what the deploy needs. The step is optional, and the owner can skip it.

The owner's vision in one sentence: an agent collects the necessary information from the owner before it starts, and then builds the MVP from start to finish with no more questions.

## The target workflow

One session, three parts, and the owner is necessary only in the first part.

| Part | Who | What happens |
| --- | --- | --- |
| Intake | Agent and owner | The agent scaffolds the project and interviews the owner one time. It writes the brief, the product spec, the env values and the deploy choice. |
| Build | Agent alone | The staged build of `saasaloy-build`, to a local app that is seeded and tested. |
| Preview | Agent alone, optional | A deploy to a preview address, only when the owner chose it in the interview. |

"Completely agent native" then has an exact meaning: after the last interview answer, the agent asks nothing and a person fixes nothing.

## Verdict

The design covers most of the goal. The path does not run today.

Plan 0074 built the correct parts: a CLI that refuses when it would have to guess, module data an agent can filter, a local provider for each capability, a staged build with a log, and one gate command. I keep all of it.

Three facts decide the verdict:

1. An agent that follows `llms.txt` gets the published CLI 0.8.0, and that package does not contain the `saasaloy-build` skill. The path ends at step 3 of 3.
2. A project scaffolded from `main` fails `pnpm check` before the agent writes one line. The build skill tells the agent to stop on a red gate.
3. The only scored benchmark run is 1 of 7, dated 2026-10-24. No run exists after the work of plan 0074 landed.

So the true state is "designed for an unattended MVP, measured at an unattended scaffold". The five defects that break the path are small.

The interview already exists as `saasaloy-setup`, and the agent already writes the brief from the owner's answers. So decision 2 changes less than it seems. The larger gaps are these: the interview is not joined to the build, it does not ask about the product, and a person still writes the env file by hand.

## Readiness by level

| Level | What an agent can do alone | State today |
| --- | --- | --- |
| 1 | Scaffold a project and add modules with no terminal | Works on `main`. Fails on the published CLI. |
| 2 | Build a local MVP from a brief and an env file that a person prepared in an earlier session | Designed. The gate is red on a fresh scaffold. Last measurement is 1 of 7. |
| 3 | Interview the owner, then build the local MVP in the same session with no more input | Not designed as one path. The parts exist. |
| 4 | Make a preview deploy when the owner chose it in the interview | Forbidden by rule. No preview target exists. |
| 5 | Operate and update the product | Partial. Read-only production tools exist for Postgres only. |

The owner's target is level 3, with level 4 as an optional step. Level 5 is outside the target.

## What is strong

- **The CLI contract.** Every prompt has a flag. With no terminal a command exits 2 and names the flag. Five commands print one JSON document, also for an error (collected, `packages/cli/src/lib/prompts.ts:56`, `lib/json-output.ts:13`).
- **Module data.** `saasaloy list --json` gives `stage` and `needs` for all 55 modules. The build skill picks modules from that data and not from memory.
- **Local providers.** Every capability that wraps a vendor has a `-console` or `-memory` provider. Only nine modules have a `needs` value, and all nine are providers or `env-infisical` (collected).
- **No hand edits for the MVP set.** `add` applied 12 modules and 281 files in 2 seconds. No Wire-up section needed a code edit.
- **A seed that repeats.** Two runs of `pnpm db:seed` printed the same counts.
- **Speed.** The mechanical path from `init` to a built MVP scaffold takes less than 2 minutes. On that scaffold, typecheck passes in 14 workspaces, 286 tests pass, and the build passes.
- **The staged build.** One commit for each stage, a log that a new session continues from, and a list of the steps left for a person.

## The path does not run today

### Gap 1: the published CLI and `main` do not match

`llms.txt` is read from `main`. It tells the agent to run `npx saasaloy@latest`, and `latest` is 0.8.0 from 2026-10-27. The tags stop at `v0.8.0`, and `packages/cli/package.json` says 0.9.0.

- A project from 0.8.0 holds seven base skills. `saasaloy-build`, `saasaloy-feature` and `saasaloy-update` are absent.
- `npx saasaloy@latest list --json` exits 2: `Module "admin" needs saasaloy >=0.9.0, and 0.8.0 is installed. Upgrade with pnpm add --global saasaloy@latest`. The upgrade command installs 0.8.0 again.
- Five descriptors carry the `>=0.9.0` floor: `admin`, `ci`, `ecommerce`, `payment` and `shell`. The MVP set needs `shell` and `admin`.
- An `add` of the six Validate modules exits 0 on 0.8.0, and the project then fails typecheck, because the old base lacks `@repo/env/dev-port` (collected).

The cause is structural. The CLI and the base come from npm. Module code comes from the head of `main`. Each merge to `main` can break every installed CLI. Issue #314 (pin module refs to the release tag) is open and has no plan.

### Gap 2: the gate is red on a fresh scaffold

`pnpm check` on a bare `init` from `main` exits 1. After the 12 MVP modules it still exits 1, with 44 type-aware lint errors. All 44 are in eight base template files, such as `packages/tooling/src/dev-stop.ts`, `packages/env/src/dev-ports.ts` and `packages/tooling/src/vite/dev-gzip.ts`. `pnpm lint:fix` leaves 33 of them.

This repo cannot see the errors. Its `lint:types` pass covers `packages/cli/src` and `scripts` only (`package.json:19`). The template runs the same pass on its own `packages/*/src` (`packages/cli/templates/base/package.json:26`), so the errors appear only in a generated project.

The nightly smoke run is the one check that scaffolds a full project and lints it. It failed on 2026-11-11, 11-12, 11-15, 11-16 and 11-17. No pull request check scaffolds a project and runs `pnpm check`.

### Gap 3: the documented env file cannot load

The Intake stage runs `saasaloy env --from-file ./env` (`saasaloy-build/SKILL.md:49`). The command refuses the whole file when one key is not declared by an installed module (`packages/cli/src/commands/env.ts:446`).

- At Intake no module is installed, so the command exits 2 and writes nothing.
- After the MVP modules it still exits 2, because of `PUBLIC_SITE_URL`. That key is in the base `.env.example`, in the wiki example, and in the benchmark env file. No module declares it.
- With no `packages/env/.env`, `pnpm env:setup` exits 1. The build of `apps/web` then fails on two unset keys, so the gate cannot pass at Intake or at Brand.

The file loaded only after I removed `PUBLIC_SITE_URL` by hand.

### Gap 4: the database steps are in the wrong order

The build skill names `pnpm db:setup`, then `pnpm db:seed` (`SKILL.md:75`). At the Validate stage `pnpm db:setup` exits 1, because no migration exists. At the MVP stage it works only after `pnpm --filter @repo/db db:generate`, and the build skill does not name that command.

### Gap 5: the build branch has no base

`saasaloy init` runs `git init --initial-branch=main` and makes no commit (`init.ts:240`). The build skill then runs `git switch -c build/mvp`. The first commit lands on `build/mvp`, and `main` never exists. The wiki's review command `git log --oneline main..build/mvp` fails, and "merge the branch" has no target.

## The path is not measured

### Gap 6: the benchmark is 24 days old and optional

- The one scored run passed 1 of 7 MVP bar lines, before phases 3 to 13 of plan 0074 landed.
- Plan 0074 states its done condition as one run with PASS on every line. PR #277 says that run did not happen. Issue #228 is closed.
- No workflow and no release script calls the benchmark. `CONTRIBUTING.md:562` asks for a manual run before a release (collected).
- The benchmark runs one brief on one model through one agent, Claude Code. The run folder sits inside this repo, so the agent can read the repo (collected).
- The scorer checks sign-up and sign-in by HTTP only. No bar line opens a browser (collected).

### Gap 7: continuous integration does not test the product of the tool

`ci.yml` typechecks `packages/cli` and `scripts`. It scaffolds nothing. The nightly smoke run lints and typechecks full scaffolds, and it runs no `test` and no `build` on them (collected, `scripts/release-smoke.ts:119`).

## The intake is not one step

### Gap 8: the interview and the build are two separate procedures

The agent path starts after the interview, not with it. `llms.txt` says the folder "must hold a complete product brief" and "Do not write the brief yourself". It gives an agent with no brief nothing to do.

The wiki gives the owner six manual steps before the agent starts (`docs/wiki/how-to/build-with-an-agent.md`):

1. Scaffold a scratch project.
2. Run `/saasaloy-setup` in it and answer the questions.
3. Copy `docs/product-brief.md` into an empty folder.
4. Delete the scratch project.
5. Write an env file by hand.
6. Start a second agent session with a prompt.

The target workflow replaces all six with one session: `init`, the interview, the build.

### Gap 9: the interview asks about the landing page, not about the product

The ten questions are Name, Language, Audience, Problem, Current alternative, Differentiator, Proof, Tone, Pricing and the sign-up destination. `saasaloy-landing-copy` needs these. The build needs more, and no question collects it:

- **The product.** The Feature stage picks one entity "from the brief's Problem and Differentiator answers" (`saasaloy-build/SKILL.md`). No answer names the entities, their fields, or the screens.
- **The modules.** No question asks for teams, payments, subscriptions or file uploads. The build installs the fixed MVP set.
- **The database driver.** The build always picks D1. `ecommerce` needs Postgres, and the tool moves no data between drivers.
- **The preview deploy.** No question asks for it.

So "collect the necessary information before the work starts" is not true today. The agent must guess the product in the Feature stage, and that is the stage the 2026-10-24 run failed.

### Gap 10: a `weak:` answer stops the build after the owner left

The interview records a thin answer as `weak:` after two follow-up questions (`saasaloy-setup/SKILL.md:123`). The unattended build then stops before the first module on any `weak:` tag (line 281). The skill does warn the owner when it writes `autonomy: afk`.

In a workflow where the interview and the build are one session, this stop comes too late. The interview must end with a brief the build accepts. The owner either gives a better answer or accepts the weak one, and the copy then avoids that claim.

### Gap 11: a person writes an env file that has no secret in it

The wiki tells the owner to write eight local values. Each one has a default in `.env.example`, and `BETTER_AUTH_SECRET` is optional on loopback (collected, `modules/auth/registry-item.json:13`). No command writes the defaults. The build skill also forbids an invented value, so the agent may not create the file.

The interview has nothing to ask here. A command must write the local defaults.

### Gap 12: no preview deploy exists, and the rule forbids every deploy

`AGENTS.md:274` in the base forbids a deploy, a push, a vendor account and a secret edit under `autonomy: afk`. No key widens this, and the brief has no field for a deploy choice. Production is the only deploy target (collected, `docs/wiki/how-to/deploy-to-cloudflare.md:9`).

Subagent E classified each step from local MVP to live:

| Step | Class |
| --- | --- |
| Cloudflare account, payment card, domain purchase, payment provider KYC | Human by nature |
| Resource creation, secrets upload, migration, deploy, tag, rollback | Automatic with one scoped `CLOUDFLARE_API_TOKEN` |
| Push, release, deploy, first superadmin | Blocked by policy only |
| A preview target, a writer for the deploy values with no terminal, a superadmin command with no prompt | Tooling is missing |

A D1 project on a `workers.dev` address needs no paid plan and no domain. The owner supplies one Cloudflare token, and that is all the interview must collect for a preview. The token is a secret, so the owner puts it in a file and gives the agent the path. It does not go into the conversation.

## The MVP is thin

### Gap 13: the Feature stage builds one entity from 7.9 KB of text

`saasaloy-feature` gives an order of 11 steps and no code. It has no worked example and no file template. It does not say how to derive columns or screens from the brief (collected). The product is exactly this stage, and it is the stage with the least support. The 2026-10-24 run failed this bar line.

### Gap 14: normal account screens are missing

`modules/app/files/src/routes` holds four files: `__root`, `index`, `sign-in` and `sign-up`. The api sends a reset mail, and no screen receives the token (issue #230). The app has no email verification, no profile or settings page, no account deletion and no billing page (collected).

### Gap 15: no check opens a browser

The build skill drops `e2e` because it needs a browser download. The shipped e2e flows cover health, waitlist and admin login, and none covers sign-up in the `app` (collected). An MVP can pass every gate with a sign-up form that does not work.

## Discovery and portability

### Gap 16: an agent can miss the entry point

- `https://saasaloy.com/llms.txt` returns 404.
- `README.md` names `llms.txt` one time, on line 77 of 144, below the attended quick start.
- The npm README is the 0.8.0 copy and does not mention agents (collected).
- `llms.txt` states no prerequisite: Node 24.15, pnpm 12.3.4, a git identity, network access, and `GITHUB_TOKEN` against the 60 requests per hour limit.
- Every `llms.txt` link is a `github.com/.../blob/` page, so an agent gets HTML and not Markdown.
- The descriptor `$schema` host `saasaloy.dev` does not resolve.
- `docs/wiki/index.md` says "nine commands" and "0.3.0 today". `docs/wiki/modules.md` lacks six modules (collected).

### Gap 17: "any agent" is not proven

Every measurement used Claude Code. The base `AGENTS.md` names the ten base skills by slug and not by path. Several skills use slash commands. `.claude/skills` links exist only after `pnpm install` (collected). ADR 0015 says Codex and Cursor read `.agents/skills`, and no run confirms it.

### Gap 18: smaller defects in the contract

- `AGENTS.md:268` says a person runs `pnpm env:setup`, and the build skill tells the agent to run it. `AGENTS.md:274` forbids an edit of `packages/env/.env`, and the build skill writes it.
- The build log records a stage's commit hash in the next stage's commit. A stop between the two leaves a stage with no hash. The skill has no rule for a dirty tree on resume (collected).
- The MVP build reads about 425 KB of guide and skill text, near 106,000 tokens (collected, estimated at 4 bytes for each token).
- With `CI=1`, `pnpm install` after an `add` fails on the frozen lockfile (collected). Without `CI`, it passed in my run.
- `update`, `init`, `remove` and `testing` have no `--json`. The `update` merge plan is Markdown (collected).
- The base guide gives no recipe to start a dev server, wait for it, and stop it. `ASTRO_DEV_BACKGROUND=1` is not in it (collected).
- `add` needs GitHub on every call, with no cache and no retry (collected, `packages/cli/src/lib/registry.ts:296`).

## What I recommend, in order

### 1. Make the path run

Each item is small, and together they move the project from level 1 to a real level 2.

1. Fix the 44 lint errors in the eight base files.
2. Release 0.9.0. Add a test that fails when `llms.txt` names a skill or flag that the published package lacks.
3. Make `saasaloy env --from-file` accept a base key, write the keys it knows, and report the others. Add `saasaloy env --defaults`, which writes the local defaults and a random secret.
4. Name `db:generate` in the build skill, and make `db:setup` exit 0 when no migration exists.
5. Make `saasaloy init` commit the scaffold on `main`.
6. Run the benchmark, and record the score in `docs/research/`.

### 2. Keep it running

1. Add a pull request check: scaffold the MVP set, then run `pnpm check`. It takes less than 2 minutes.
2. Resolve the default registry at the release tag of the CLI that runs (issue #314).
3. Put the benchmark on a schedule, in a run folder outside the repo. A lower score than the last report blocks a release.

### 3. Join the interview to the build

This step is the owner's vision. It moves the project from level 2 to level 3.

1. Rewrite the entry in `llms.txt` as one path: `init`, then the interview, then `saasaloy-build`. With no brief and no person in the session, the agent stops and says why.
2. Extend the interview with a product part: the entities, their main fields, who can see them, and the screens. Write the answers to a spec section that `saasaloy-feature` reads.
3. Add questions for the module choices and the database driver. Offer answers from `saasaloy list --json`, and recommend one driver from the modules the owner picked.
4. Add the preview question as the last one. Record the answer in the brief's frontmatter, for example `deploy: preview` or `deploy: none`.
5. End the interview with a read-back. The agent shows the brief, the module list and the entity list, and the owner confirms one time. A `weak:` answer is settled here, not in the build.
6. Drop the env file from the required input. The defaults command of step 1 replaces it.
7. Keep the interview short. Each new question carries sample answers, as the ten present questions do.

The rule against an invented price, proof, customer name or URL stays as it is.

### 4. Raise the MVP

1. Ship the reset screens (#230), email verification and a settings page in `app`.
2. Give `saasaloy-feature` a worked reference entity. Let the build loop over each entity of the spec, not over one.
3. Add an `app` sign-up flow to `e2e`, and keep `e2e` in the unattended build when a browser is present.

### 5. Add the optional preview step

This is a separate stage after Handover. It runs only when the brief says `deploy: preview`.

1. Add a preview deploy target on D1 and `workers.dev`, apart from the production gates.
2. Change the forbidden list in the base `AGENTS.md`: a preview deploy is allowed when the brief asks for it and the token file exists. A production deploy, a push and a vendor account stay forbidden.
3. Read the Cloudflare token from a file path the owner gave in the interview. Add a writer for the deploy values that needs no terminal.
4. Print the preview address and the seeded sign-in in the build log.

### 6. Prove "any agent"

Run the benchmark with three briefs and with a second agent, such as Codex. Fix what the second agent cannot find.

## Open points after the owner's decisions

1. The interview grows from 10 questions to about 15. I recommend that limit, and a test of the length with one real owner.
2. The preview needs a database the public can reach. I recommend D1 for a preview, also when the owner picked Postgres for production. A prototype settles whether one project can do both.
3. The benchmark has no interview today. I recommend a second benchmark mode with scripted owner answers, so the whole target workflow has a score.

## Evidence left on the box

The three run folders are in `.dev/agent-audit/` (930 MB, ignored by git): `published`, `local` and `verify`. Delete them with `rm -rf .dev/agent-audit` when the review is done.
