# Plan: agent-native build workflow (interview, build, optional preview)

Grilled: 2026-11-17

Created on 2026-11-17 from [research 0011](../research/0011-research-agent-native-readiness-2026-11-17.md). The sister plan 0110 covers the agent surface of a built product. This plan covers how an agent builds the product.

## Context

The owner's goal: an agent that gets this repo collects the necessary information from the owner one time, and then builds a SaaS MVP from start to finish with no more questions. Research 0011 found that the parts exist and the path does not run.

- An agent that follows `llms.txt` gets `saasaloy@0.8.0`, which has no `saasaloy-build` skill. `list --json` exits 2 on it.
- `pnpm check` fails on a fresh scaffold from `main`, with 44 type-aware lint errors in eight base template files. No pull request check scaffolds a project.
- The documented env file does not load, the database steps are in the wrong order, and `main` has no commit when the build opens `build/mvp`.
- The interview (`saasaloy-setup`) and the build (`saasaloy-build`) are two procedures in two sessions, with six manual steps between them.
- The interview asks ten landing page questions. No question collects the entities, the modules, the database driver or the deploy choice.
- No preview deploy target exists, and the base `AGENTS.md` forbids every deploy under `autonomy: afk`.

The users are a project owner who is not at the keyboard after the interview, and the coding agent that does the work.

Target: every agent benchmark line passes on 3 briefs (the owner's number, 2026-11-17; baseline 1 of 7 lines on one brief, 2026-10-24, `docs/research/0005-research-agent-bench-baseline-2026-10-24.md`). The benchmark gets new lines for the interview and the preview in this plan.

## Design decisions (settled)

Each row says how it was settled on 2026-11-17: by the owner before the grill, asked in the grill, or taken as a grill default that the owner did not change.

| Decision | Resolution |
|----------|-----------|
| Where the MVP ends | At a local app that is seeded and tested. A preview deploy is a separate, optional step. Owner. |
| Who writes the brief | The agent, after it interviews the owner. The rule against an invented price, proof, customer name or URL stays. Owner. |
| Preview deploy | Allowed for an agent when the owner chose it in the interview. The owner can skip it. Owner. |
| Plan shape | Two plans. This one covers the build workflow. Plan 0110 covers the agent-usable product. Owner. |
| Registry version | The default registry reads modules at the release tag of the CLI that runs. `saasaloy add <module>@main` stays as an explicit choice. This changes ADR 0012's default and needs a new ADR (issue #314). Asked. |
| Old locks | A lock that names a `main` commit stays valid. `saasaloy update` moves it to the tag. Default. |
| Local env values | A missing `packages/env/.env` counts as an empty file, so the `.env.example` defaults apply. A required key with no default still fails by name at the gate. `saasaloy env --from-file` stays strict (ADR 0046) and learns the base's own keys. No new command. Asked. |
| The first commit | `saasaloy init` commits the scaffold on `main` with the subject `chore(repo): initial commit`. Under `--no-git` it makes none. With no git identity it warns and skips, and the Intake stage makes the commit. Asked. |
| Home of the interview | `saasaloy-setup`, extended. No new skill. Default. |
| Where the answers go | The ten landing answers stay in `docs/product-brief.md`. The product part goes to a new `docs/product-spec.md`. The run settings (`autonomy`, `deploy`) stay in the brief's frontmatter. Default. |
| Spec format | Markdown with fixed headings and one table for each entity. The table holds the fields, who may see the entity, and its actions: `list`, `create`, one `update`, plus named domain verbs. A test checks the headings. Default. |
| Interview length | About 15 questions. The agent proposes the product part from the first ten answers, as one table for each entity, and the owner corrects it. Asked. |
| The unattended flag | The owner's one confirmation at the read-back sets `autonomy: afk`. An owner who wants an attended build says so there. Default. |
| A thin answer | The owner improves it or accepts it at the read-back. An accepted one gets the tag `weak-accepted:`, counts as filled, and the copy avoids the claim. Default. |
| Screens with no mockup | The read-back is the approval. It names each screen. A Feature screen uses present `shell` parts only: the `data-table` block, the `detail-panel` block, and the `form` and `field` components. No new block, so this plan has no mockup phase. Asked. |
| Entity limit | None. The Feature stage builds each entity of the spec in the owner's order of priority, with one commit for each entity. Phase 8 measures the cost. Asked. |
| A picked module that needs an account | The build installs its local provider and lists the vendor step for the owner. The read-back says so. Default. |
| A wish that no module covers | It goes to a "Not in this build" section of the spec, and to one log line. Default. |
| The scaffold check | A pull request job builds the CLI, scaffolds the MVP set for D1 from the local registry, and runs `pnpm check`. Both drivers run each night. Default. |
| `CI=1` and the lockfile | The build skill runs `pnpm install --no-frozen-lockfile` after an `add`. `add` runs no install. Default. |
| Preview target | `pnpm deploy:preview`, apart from the production gates of ADR 0048. It deploys from `build/mvp`, pushes nothing, writes no deploy tag, and its Worker names end in `-preview`. Default. |
| Preview database | A D1 project uses a preview D1 database. A Postgres project uses a temporary neon.new database from the `--neon` backend. The log and the command output state the day that database ends. Asked. |
| Preview token | The Cloudflare token is read from `~/.config/<project>/cloudflare-preview.env`, never from the conversation. Default. |
| Preview accounts | No seed account with the public password. The preview makes one owner account with a random password, written to `.preview/credentials` with mode 0600. Git ignores the file, and the log names it. Asked. |
| Cookies on `workers.dev` | A spike in phase 1 proves sign-in across the Workers. If it fails, phase 7 stops and returns to the owner. Default. |
| When the benchmark runs | By hand on this box, before a release that needs it. No schedule and no repository secret. It uses the model of the October baseline, so scores compare. Asked. |
| Which releases need a run | A release that changes a base skill, the unattended CLI contract, or a module of the MVP set. `release-preflight` reads the changed paths since the last tag. It refuses such a release when the score report is absent or holds a FAIL line. Other releases need the scaffold check only. Asked. |
| The scripted owner | A fixed answers file that the harness gives turn by turn. Default. |
| New benchmark briefs | One team product and one paid product, beside Shelfnote. They exercise `teams` and a local payment provider. Asked. |
| Outward actions a builder may take | File a GitHub issue for each benchmark FAIL line that no phase covers. Create temporary neon.new databases in tests. Asked. |
| Outward actions that stay the owner's | The npm publish. Each deploy into the owner's Cloudflare account, the preview tests of phase 7 included. The deploy of `saasaloy.com`. Asked. |
| Tests | No new kind of test. CLI changes use the present vitest suites in `packages/cli`. Skill changes are checked by `scripts/skills.test.ts` and by the benchmark. |

## Approach

Fix the path first, then guard it, then join the interview to it, then add the preview, then measure the whole workflow. The plan reuses what plan 0074 built: the refuse-not-guess CLI, `stage` and `needs` in `list --json`, the staged build with its log, the `pnpm check` gate, and `scripts/agent-bench.ts` with its scorer.

Rejected, one line each:

- A new `saasaloy-start` skill that wraps setup and build: a third procedure to keep in step, when `saasaloy-build` already runs the other skills in order.
- An agent that writes the brief from one sentence with no interview: the owner chose an interview, and invented facts reach the landing page.
- A `saasaloy env --defaults` command: a missing file that counts as empty does the same with no new surface.
- A scheduled benchmark on a GitHub runner: the owner chose a hand run before a release.
- A production deploy by an agent: the owner limited the scope to a preview.

### Phase 1: owner inputs and the cookie spike

Attended: the owner supplies a Cloudflare token, approves two benchmark briefs, and starts the spike deploy.

This phase is first so the later phases can run with nobody at the keyboard, except the parts marked attended in phases 5, 7 and 8.

- A Cloudflare API token in `~/.config/saasaloy/cloudflare-preview.env`, with mode 0600. Scopes: Workers Scripts edit and D1 edit.
- Two more benchmark briefs beside Shelfnote, each with a file of owner answers for the interview: one team product and one paid product. The builder drafts them and the owner approves them.
- A throwaway spike: deploy the `web`, `app`, `admin` and `api` Workers of one scaffold to `workers.dev` addresses, then sign up and sign in. ADR 0004 assumes subdomains of one owned domain, so the cookie and CORS setup needs proof here.

Done when: `stat -c %a` on the token file prints `600`, `scripts/agent-bench/` holds three brief folders the owner approved, and a note in this plan records whether a session cookie works across the four `workers.dev` hosts and which settings it needed.

### Phase 2: make the path run on `main`

- Fix the 44 type-aware lint errors in the eight base template files that research 0011 names.
- The local env source reads a missing `packages/env/.env` as empty. `saasaloy env --from-file` counts the base's own keys (such as `PUBLIC_SITE_URL`) as declared.
- `saasaloy init` commits the scaffold on `main` as `chore(repo): initial commit`.
- `pnpm db:setup` exits 0 and says so when no migration exists, on both drivers.
- `saasaloy-build`: run the env step after each `add`, name `pnpm --filter @repo/db db:generate` before `db:setup`, run `pnpm install --no-frozen-lockfile`, and make the first commit in the Intake stage when `init` skipped it.
- Remove the two conflicts between the base `AGENTS.md` and the build skill: who runs `pnpm env:setup`, and whether the agent may write `packages/env/.env`.
- Give the build log a rule for a dirty tree on resume, and record a stage's commit hash in a way that survives a stop after the commit.

Done when: in a fresh folder, `saasaloy init . --force --yes --testing=tests-after` leaves one commit on `main`, `pnpm check` exits 0 right after it with no env step, the Validate `add`, the MVP `add` and the database steps all exit 0 in the order the build skill gives, and `pnpm check` exits 0 after each `add`.

### Phase 3: check a scaffold on every pull request

- Add a `scaffold` job to `ci.yml`: build the CLI, scaffold the MVP module set for `database-d1` from the local registry, run `pnpm check`.
- Extend the nightly full-scaffold checks in `scripts/release-smoke.ts` from `lint` and `typecheck` to `test` and `build`, on both drivers.
- Make the nightly smoke run green again. Its three failures on 2026-11-17 are the env validation error in the web dev server, `add ecommerce` on D1, and the lint errors of phase 2.

Done when: a test pull request that adds one type-aware lint error to a base template file fails the `scaffold` job, the same pull request without the error passes it, and the nightly smoke run is green on two days in a row.

### Phase 4: one version for the CLI, the base and the modules

- The default registry resolves at the tag `v<version>` of the CLI that runs. `@main` on a module name still reads `main`. Write the ADR that changes ADR 0012's default.
- A lock that names a `main` commit still resolves, and `saasaloy update` moves it to the tag.
- `release-preflight` fails when `llms.txt` names a skill, a command or a flag that the package under release does not hold.
- `llms.txt` states its prerequisites: Node, pnpm, a git identity, network access, and `GITHUB_TOKEN` for the rate limit.
- A CLI that meets a descriptor floor above its own version prints a command that gives a newer version, not the version it already is.

Done when: a CLI built at a test tag fetches every module at that tag (the lock records the tag's commit), a module merged to `main` after the tag is absent from `list --json` and present with `@main`, and the preflight test fails on an `llms.txt` that names a skill the package lacks.

### Phase 5: release, and record a baseline

Attended: the owner publishes to npm and starts the benchmark run. This phase follows phases 2 to 4 because it ships their fixes.

- Release the next version through the present release procedure in `CONTRIBUTING.md`.
- Run the benchmark one time on the Shelfnote brief with the present prompt, and record the score under `docs/research/`.
- File one issue for each FAIL line that no later phase of this plan covers.

Done when: `npm view saasaloy version` equals `packages/cli/package.json`, a project from `npx saasaloy@latest init` holds `.agents/skills/saasaloy-build/SKILL.md`, `npx saasaloy@latest list --json` exits 0, and the score report exists with its date and run id.

### Phase 6: join the interview to the build

- `saasaloy-setup` gets a product part after the ten questions, for about 15 questions in total. The agent proposes one table for each entity from the earlier answers: the fields, who may see it, and its actions. The owner corrects the tables. The skill asks which optional capabilities the product needs, with choices from `saasaloy list --json`, and recommends one database driver from those picks. Each new question carries sample answers, as the present ones do.
- The last question asks for a preview deploy. With a Postgres pick, it says that the preview runs on a temporary database.
- The interview ends with a read-back: the brief, the module list, each entity with its screens, the wishes that are not in this build, and the steps that stay with the owner. The owner confirms one time. That confirmation settles each thin answer, approves the screens, and sets `autonomy: afk`.
- The skill writes `docs/product-brief.md`, `docs/product-spec.md` and the frontmatter, and then `saasaloy-build` starts in the same session.
- `saasaloy-build` reads the spec: the module picks in the Validate and MVP stages, the driver, and one Feature pass with one commit for each entity, in the owner's order. `saasaloy-feature` takes its columns, its actions and its screens from the spec, and builds the screens from the `data-table` and `detail-panel` blocks and the `form` and `field` components.
- `llms.txt`, `docs/wiki/how-to/build-with-an-agent.md`, the base `AGENTS.md` "Unattended work" section and the `init` next-steps list all give one path: `init`, the interview, the build. An agent with no brief and no person in the session stops and says why.
- Move the agent pointer to the top of `README.md`, and add a `/llms.txt` route to `apps/web`. The deploy of the site stays the owner's.

Done when: an agent that starts in an empty folder with one sentence and a scripted owner reaches the Handover stage, the transcript shows no question after the read-back, `docs/build-log.md` names one commit for each entity of the spec, the wiki page lists zero manual steps before the prompt, and the build output of `apps/web` holds `llms.txt`.

### Phase 7: the optional preview deploy

Attended: the live check at the end deploys into the owner's Cloudflare account, and the owner starts it. The other tasks run unattended, and a builder may create temporary neon.new databases in their tests.

- `pnpm deploy:preview` in `packages/tooling`: it deploys every Worker to a preview environment with names that end in `-preview`, runs the migrations, and prints each address. A D1 project gets a preview D1 database. A Postgres project gets a temporary neon.new database, and the output states the day it ends. The command has none of the production gates and writes no deploy tag. `pnpm deploy:preview --delete` removes what it made.
- The command makes one owner account with a random password and writes it to `.preview/credentials`. It seeds no account with the public password.
- `saasaloy-build` gets a Preview stage after Handover. It runs only with `deploy: preview` in the brief and a readable token file at `~/.config/<project>/cloudflare-preview.env`. Without them it logs the step under `## Left for a human`.
- The base `AGENTS.md` forbidden list changes: a preview deploy is allowed under those two conditions. A production deploy, a push, a vendor account and a secret edit stay forbidden.
- The settings that the spike of phase 1 found go into the preview environment.

Done when: with `deploy: preview` and the token file, the build log ends with the preview addresses and the name of the credentials file, `curl` gets 200 from the web address, a sign-up and a sign-in by HTTP against the preview api both succeed, and a sign-in as `superadmin@example.test` with the seed password is refused. The same holds for a `database-postgres` project, whose log also states the day the database ends. With `deploy: none`, the transcript holds no `wrangler` call.

### Phase 8: measure the whole workflow

Attended: the owner starts each scored run on this box.

- The benchmark gets an interview mode: the harness answers the questions from a fixed file, turn by turn, and the agent starts from one sentence. New bar lines: the interview ended with one read-back and no later question, each entity of the spec exists end to end, and the preview answers when the brief asks for one.
- The run folder moves outside the repo, and the run uses its own port block, so a run works while other dev servers hold ports 3000 to 4000 and the agent cannot read this repo.
- The agent command is a parameter of `scripts/agent-bench.ts`, so a later plan can run a second agent with no harness change.
- `release-preflight` reads the changed paths since the last tag. When they touch a base skill, the unattended CLI contract or a module of the MVP set, it refuses the release unless a score report for the three briefs exists and holds no FAIL line. `CONTRIBUTING.md` states the rule.
- Each report records the turns, the time and the cost of the run, so the cost of a build with several entities is known.

Done when: `node scripts/agent-bench.ts` prints PASS on every bar line for each of the three briefs, `release-preflight` fails on a score report that holds a FAIL line, and it passes with no report for a change that touches none of the named paths.

## Open questions

None. The grill of 2026-11-17 settled each one, and no decision is deferred.

Two results are still unknown, and a phase measures each one:

- Whether a session cookie works across `workers.dev` hosts. Phase 1 measures it. A failure stops phase 7 and returns the design to the owner.
- The cost of an unattended build with several entities. Phase 8 records it. The owner can then set an entity limit.

## Non-goals

- The agent surface of a built product: OpenAPI, MCP, `llms.txt` for the product, API keys. Plan 0110 covers it.
- The account screens in `app`: password reset (#230), email verification, settings. They need a mockup phase and their own plan.
- A worked reference entity for `saasaloy-feature`, a new `shell` block, and a browser check in the build gate (#345).
- A production deploy, a push, a vendor account or a secret edit by an agent.
- A scheduled benchmark run, and a benchmark run with a second agent such as Codex. Phase 8 only makes the agent command a parameter.
- A `saasaloy env --defaults` command.
- The architecture changes of research 0010.
