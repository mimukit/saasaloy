# Plan: Derive the MVP modules from the owner's answers

Grilled: 2026-11-22

## Context

During a full agent run, the interview asked the owner: "The Saasaloy MVP set always adds admin, email-console and open sign-up. Which account model should the build use?" The question assumed a fixed module list. The owner's own plan wanted one owner, no open sign-up and no admin app, so the agent could only offer to keep the fixed list or to deviate from it.

The fixed list comes from our own instructions, not from the agent:

- `packages/cli/templates/base/_agents/skills/saasaloy-setup/SKILL.md:205` tells question 13 to "Leave out the MVP set the build always adds": `database`, `api`, `logger`, `validators`, `shell`, `auth`, `app`, `admin`, `email`, `agent`, `api-keys`, `api-keys-user`, and their drivers and providers. Question 13 offers only the modules outside that set.
- `packages/cli/templates/base/_agents/skills/saasaloy-setup/SKILL.md:296` keeps the fixed set out of the spec's `## Modules` table, so the owner never approves it.
- `packages/cli/templates/base/_agents/skills/saasaloy-build/SKILL.md:96-106` installs every module whose `stage` is `validate` or `mvp`, always adds the agent set (rule 5), and names the result as one fixed sentence.
- `saasaloy-setup/SKILL.md:157-161` makes every entity's `Screens` row include an admin read-only list, and `product-spec-template.md:25` repeats it.
- Plan 0074 set "the MVP bar" as `auth`, `admin`, `email` with `email-console`, `app` and one entity. `scripts/agent-bench/score.ts:59-75` scores every run against that bar, and `scripts/scaffold-check.test.ts:48` pins `MVP_MODULES` to the sentence in the build skill.

The `stage` field (`packages/cli/schemas/registry-item.schema.json:73`) says which stage "usually earns" a module. The build skill reads it as "always install".

Goal: the agent proposes the module list from the owner's interview and brief, gives a reason for each module, and installs only what the owner approved. The smallest MVP is the base template's web landing page with no module.

Target: in every agent bench brief, the set of installed modules equals the approved spec's `## Modules` table, each row has a reason that cites an answer, and no interview question names a fixed module set. A new landing-only brief installs zero modules and passes the landing checks. Interview replies stay within the 15 to 17 baseline of [research 0016](../research/0016-research-agent-bench-v0-10-0-codex-rescore-2026-11-21.md).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| The floor | The base template, which ships `apps/web` with the landing page. No module is fixed. The owner settled this on 2026-11-22. |
| Who decides | The agent derives the list from the answers and proposes it with one reason for each module. The owner approves the list in the product read-back, which the spec hash in `docs/product-approvals.json` already covers. |
| Dependency closure | The agent derives the list, but not freely. An entity needs the technical set that `saasaloy-feature` step 2 names: `database` with `database-postgres`, `api`, `logger` with `logger-console`, `validators`, `auth`, `shell` and `app`. The proposal adds that set as one group with the reason "the product has an entity". A trigger table in `saasaloy-setup` maps answers to modules, so two agents give the same list for the same answers. |
| `admin` | Proposed only when the project needs staff work (staff see or manage other users' data), or when a picked module depends on `admin`: `teams`, `payment`, `subscription`, `cms`, `feature-flags`, `file-uploads`, `multitenant` and `ecommerce` do. Users other than the owner are app users, so they do not call for `admin`. It is not a default. The admin part of each entity's `Screens` exists only when `admin` is in the list. Without `admin`, no superadmin is seeded, because that seed lives in `modules/admin`. Asked 2026-11-22. |
| Ask when unsure | When an answer does not clearly trigger or rule out a module, the agent asks the owner one question in the module proposal, with the module and its reason as samples. It never assumes. This applies to every row of the trigger table. Asked for `admin`, defaulted for the rest, 2026-11-22. |
| `email` | Proposed with `email-console` when the product has sign-in, because the password reset mail needs it, or when another answer sends mail. The owner may drop it. Then the read-back warns "Without email, users cannot reset a password.", and the handover lists `saasaloy add email email-console --yes`. `auth` builds without `email`, because the reset mail is a `when: installed email` entry. Asked 2026-11-22. |
| Resolved list | The agent runs `saasaloy add <picks> --dry-run --json` and shows its resolved list. A module that `dependsOn` pulls in is marked "needed by `<pick>`", so the count the owner approves equals the count the build installs. The spec's `## Modules` holds the picks with reasons and a "Needed by" column for pulled-in modules. Defaulted 2026-11-22. |
| Trigger table | One file, `.agents/skills/saasaloy-setup/module-triggers.md`, that both `saasaloy-setup` and the build's no-spec path read. Defaulted 2026-11-22. |
| Brief with no spec | A brief with `autonomy: afk` and no spec derives the list from the brief with the trigger table, and logs each module and its reason under `## MVP` as `- <module>: <reason>`. A module the agent is unsure about stays out and goes under `## Left for a human` as `- Decide on <module>: <the unclear answer>. Run saasaloy add <module> --yes to add it.` Asked 2026-11-22. |
| Test runner | The Node test runner, with `scripts/skills.test.ts` for skill text and the fake agent in `scripts/agent-bench/fake-agent.ts` for interviews and builds. Defaulted 2026-11-22. |
| Live bench run | Attended. The maintainer starts the live run in Phase 3, because it takes about an hour and costs agent usage (`CONTRIBUTING.md:571`). Asked 2026-11-22. |
| Decision record | An ADR, written with `domainkit` in Phase 4, replaces plan 0074's fixed MVP bar. Defaulted 2026-11-22. |
| The agent set | `agent`, `api-keys` and `api-keys-user` stay the recommended default whenever the product has an entity, because plan 0110 makes every built product usable by AI agents. The owner may drop them. The `api-keys-organization` swap rule stays. |
| Zero entities | Question 11 accepts "no signed-in product yet". The spec's `## Entities` then holds `None.`, and the build skips the Feature stage. |
| `stage` field | A hint for grouping and for the order of the build stages. The build never installs a module because of its stage. |
| `MVP_MODULES` | It stays the CI scaffold set, the widest common build, renamed to `SCAFFOLD_MODULES`. Its test stops parsing the build skill. The bench gate keeps it as the list of modules whose change calls for a bench run. |
| Sign-up policy | Out of scope. The owner chose a separate plan on 2026-11-22. |
| Order with plan 0122 | This plan builds on plan 0122 (design approval). Both edit `saasaloy-setup` and `saasaloy-build`. Phase 1 starts after plan 0122's skill changes land on `main`. |

## Approach

Recommended: keep the interview shape and change question 13 from "pick extras beyond the fixed set" to "approve the full derived list". This reuses the read-back, the approval record, the spec's `## Modules` table and the build's `saasaloy add` call. The build stops reading `stage` and installs the spec's table.

Rejected:

- Minimal: drop only `admin` from the fixed set. It fixes the screenshot case but keeps a landing-only product impossible.
- Lateral: named presets ("landing", "SaaS", "team SaaS") that the owner picks. It hides the reasons and returns to fixed lists with more names.

### Phase 1: The interview proposes the full list

- In `saasaloy-setup/SKILL.md`, rewrite "The capabilities question" as "The module proposal". Remove step 1 ("Leave out the MVP set"). Keep the provider and tooling exclusions.
- Write `.agents/skills/saasaloy-setup/module-triggers.md`: each answer or entity pattern, the modules it adds, the reason text, and what counts as unclear. Rows include: an entity exists; staff work on other users' data; sign-in exists; paid tiers in question 9; a team audience; an entity of the organization; a waitlist destination in question 10.
- Ask one question for each unclear row, inside the module proposal.
- Run `saasaloy add <picks> --dry-run --json`, and present the proposal as one table of every module to install, grouped by stage, with the reason or "needed by `<pick>`". Samples: take the list, drop a named module, add a named module.
- When the owner drops `email`, show the reset warning in the read-back.
- When the owner drops a module that another pick or an entity needs, say which one needs it, and ask once.
- In question 11, add the sample "No signed-in product yet: landing page only". Make the admin part of `Screens` conditional on `admin` in the list.
- In the read-back, item 2 lists the full module table. In "The spec", `## Modules` lists every module, its local providers and its reason. Remove "It does not list the MVP set".
- Update `product-spec-template.md`: `## Modules` holds every module, `## Entities` may hold `None.`, and the admin screen part is conditional.

Done when: `scripts/skills.test.ts` pins the trigger table and fails on the phrase "MVP set" in `saasaloy-setup`, and a fake-agent interview test for a landing-only answer set writes a spec whose `## Modules` row is `None.`.

### Phase 2: The build installs the approved list

- In `saasaloy-build/SKILL.md`, rewrite "Stage: Validate and Stage: MVP": install each module in the spec's `## Modules`, in two calls split by its `Stage` column (`validate` first, every other stage second). Keep rules 1 to 3 (drop `needs`, pick `database-postgres`, pick the local provider). Remove rules 4 and 5 and the fixed-set sentence.
- Skip a stage call that has no module. Skip the Feature stage when `## Entities` is `None.`. Set the tests-after mode only when an entity exists.
- Rewrite "Without a spec": derive the list from the brief with `module-triggers.md`, log each module and its reason under `## MVP`, and build one entity only when the brief centres on one. Leave out each unclear module and log it under `## Left for a human` with its `saasaloy add` command.
- In `saasaloy-feature/SKILL.md` step 2, make the agent set conditional on `agent` being installed, as `admin` already is.

Done when: a fake-agent build of an `autonomy: afk` brief with no spec and an unclear staff answer logs `- Decide on admin:` under `## Left for a human` and installs no `admin`, and the fake-agent harness builds three specs and the installed list from `saasaloy list --installed --json` equals each spec's table: landing only (zero modules), one entity without `admin` or the agent set, and Shelfnote with its approved list.

### Phase 3: Bench and CI follow the spec
Attended: the live bench run over the four briefs waits for the maintainer to start it. The code changes run unattended.

- In `scripts/agent-bench/score.ts`, score `auth`, `reset`, `entity`, `entities`, `agent-audit` and the admin list only when the spec lists the module or an entity. Report the others as `n/a`, never `PASS`. Add a check `modules`: the installed list equals the spec's table.
- Add a fourth bench brief, a landing-only product, under `scripts/agent-bench/briefs/`. Rewrite `shelfnote/answers.md:60` ("Nothing beyond the MVP set") as an explicit answer.
- Rename `MVP_MODULES` to `SCAFFOLD_MODULES` in `scripts/scaffold-check.ts`, `scripts/bench-gate.ts`, `scripts/release-preflight.ts` and their tests. Remove the test that parses the build skill.

Done when: `pnpm test` passes, and a live bench run over the four briefs passes the `modules` check on each, with replies inside the 15 to 17 baseline.

### Phase 4: Documentation

- Template `AGENTS.md` (lines 153 to 158 and 285), `llms.txt:31`, `docs/wiki/how-to/build-with-an-agent.md:90`, `docs/wiki/getting-started.md:113` and `CONTRIBUTING.md:571-575`: replace "the MVP set" with the derived list.
- `CONTEXT.md`: rewrite "MVP bar" so the checks follow the approved list, and add the term "module proposal".
- Write an ADR that replaces plan 0074's fixed MVP bar with the derived list, then run `pnpm docs:generate` and `pnpm docs:stale`.

Done when: `grep -rn "MVP set" packages/cli/templates llms.txt docs/wiki CONTRIBUTING.md` prints nothing, and `pnpm docs:check` and `pnpm lint` exit 0.

## Open questions

None. The grill on 2026-11-22 settled each question.

## Non-goals

- A sign-up policy (open, invite only, single owner) and a customer `disableSignUp` setting. The owner chose a separate plan.
- New modules, or changes to any module's files.
- Changes to the `stage` values in the descriptors.
