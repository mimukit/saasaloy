# Plan: Two codebase tours on the docs site that re-record themselves

Grilled: 2026-11-19

## Context

Plan 0114 (#362) adds a docs site at `/docs`. Its pages explain each part of Saasaloy on its own. No page shows the parts working together, in order, on a real project. The owner asked for an interactive tour of the codebase and its modules, with an example SaaS built from start to deploy, as its own plan and issue.

A tour goes stale faster than a prose page. It quotes code, file trees, command output and diffs, and each of those changes with the CLI. A tour with pasted output would be wrong after the next `add` change.

The owner settled the scope on 2026-11-19:

- **Two tours.** The *product tour* builds an example SaaS step by step, from `init` to deploy, for a builder. The *repo tour* walks the Saasaloy repo itself (the CLI, the registry, the applier, a module's anatomy, the gates), for a contributor.
- **A new example product**, written only for the tour. The bench briefs (Prepline, Receiptbox, Shelfnote) stay test fixtures.
- **Both build paths, side by side.** Each product tour step shows the CLI command and the agent skill that does the same work.

Goal: a reader, human or agent, follows one tour and sees how Saasaloy builds a product and how its code fits together, and every quoted output in the tour matches the CLI and the code it names.

Target: no number. The check is mechanical: CI re-records the CLI steps and resolves every code anchor, so a change that alters a step or removes a quoted symbol shows in the PR as a diff or a failure. The owner chose this on 2026-11-19. A tour completion rate was rejected because it needs analytics events the site does not send.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Tours | Two: the product tour and the repo tour (owner, 2026-11-19). |
| Example product | Shiplog, a changelog app for small software teams (grill Q1, asked). Editors publish entries, viewers read them, subscribers get them by email, and a coding agent posts an entry over MCP through the `agent` module. The brief says Shiplog is a fictional example (grill Q11, defaulted). Its brief lives in `scripts/agent-bench/briefs/shiplog/` in the bench format (`brief.md`, `answers.md`, `env`, `expect.json`), so the agent recording reuses the bench harness. |
| Product tour steps | Eleven (grill Q10, asked): (1) the brief and `saasaloy init shiplog`; (2) `add api database-d1`; (3) `add auth app`; (4) `add admin teams multitenant`; (5) `add email email-console`, then `add email-plunk` and the `EMAIL_PROVIDER` swap; (6) the `entries` entity; (7) `add api-keys-organization agent`; (8) `add queue-memory subscription subscription-console`; (9) landing copy and brand; (10) `pnpm check`; (11) the deploy. Step 8 adds `queue-memory` because `subscription` depends on `queue`, which needs a provider. |
| The entity step's CLI tab | No CLI command builds an entity. The CLI tab lists the files the agent wrote, from the frozen run, with the note "No CLI command. Write these files, or run the `saasaloy-feature` skill." (grill Q2, asked). |
| The deploy step | Shows the `saasaloy-deploy` skill's steps and commands, marked "not recorded". A recording cannot deploy, and a dry run needs a full install and build (grill Q5, defaulted). |
| Repo tour steps | The ten steps in Phase 6 (grill Q12, defaulted). |
| Build paths | Each product tour step shows the CLI path and the agent path side by side (owner, 2026-11-19). |
| Where tour text lives | One plain Markdown file per step in `docs/wiki/tour/<tour>/NN-<slug>.md`. It reads as a linear walkthrough on GitHub and in an agent's context. It follows plan 0114's wiki rules: no front matter, no MDX. |
| How a step names code and recordings | Reserved fenced blocks from plan 0114. ```` ```saasaloy-anchor ```` holds `path#symbol` lines. ```` ```saasaloy-step ```` names a recorded step by id. GitHub shows both as code blocks, and the site renders them as panels. |
| Code excerpts | Read from the repo at build time, never pasted. An anchor `packages/cli/src/lib/resolve.ts#resolveModules` renders the declaration of that symbol. Production builds at the release tag (plan 0114), so the excerpt matches the release. |
| How an anchor finds its symbol | A text search for an exported declaration: `export` then `function`, `const`, `class`, `type`, `interface` or `enum`, then the name. A module descriptor anchor names a JSON key path, for example `modules/email/registry-item.json#envVars`. The repo pins TypeScript 7, whose compiler API is not settled, so the plan does not depend on it. |
| A broken anchor | A missing file, a missing symbol, or a name that matches two declarations fails the site build and the `tour:check` script. |
| CLI recording | `scripts/tour-record.ts` runs the built CLI in `.dev/tour/shiplog/` with `SAASALOY_REGISTRY_DIR` set to this checkout's `modules/`, so it needs no network. For each step it records the command, the normalized output, the `add --dry-run --json` plan, and the file tree after the step. |
| Where recordings live | Committed JSON in `apps/web/src/content/tour/shiplog/cli/NN-<step>.json`, so a CLI change shows as a diff in the PR. `pnpm tour:record` writes them, and `pnpm tour:check` records again in memory and fails on a difference, as `pnpm docs:check` does. |
| What a recording holds | The command, the normalized stdout, the dry-run plan, the paths the step created or patched, and the full text of the files the step's Markdown asks for in a `saasaloy-step` block. Not the full diff, which runs to thousands of lines for a module like `auth`. At most 400 quoted lines per step; a larger step fails `tour:check` and names the step (grill Q7, defaulted). |
| Stable recordings | A spike at the start of Phase 4 checks that two runs give the same bytes. The recorder normalizes absolute paths, dates, SHAs, durations and the registry ref (grill Q6, defaulted). |
| Where `tour:check` runs | The `site` workflow, with path filters `packages/cli/**`, `modules/**`, `docs/wiki/tour/**` and `apps/web/**`. It builds the CLI first, so `ci.yml` stays fast (grill Q8, defaulted). |
| Agent recording | One real run of the bench in interview mode (`node scripts/agent-bench.ts --interview --brief shiplog`), frozen. `pnpm tour:freeze <run-dir>` copies, for each skill stage, the commands the agent ran (read from the tool calls), the files it wrote, the `docs/build-log.md` lines, `docs/product-spec.md` and the commit list. It copies no prose transcript (grill Q4, asked). It writes them into `apps/web/src/content/tour/shiplog/agent/`, with the CLI version and date of the run. |
| Agent recording refresh | By judgment, by hand, as an attended task, when a skill change matters (grill Q3, asked). The tour shows "Agent run recorded with saasaloy v<version> on <date>". When that version is older than the site's version, the line adds "older than this release". |
| Freshness | Each tour Markdown file gets a `.wikimap.yaml` entry whose `documents:` globs are its anchor files, so plan 0114's PR comment covers the narrative. `tour:check` covers the recordings and anchors. |
| Pages | Interactive-only pages under `apps/web/src/pages/docs/tour/`: `/docs/tour/product` and `/docs/tour/repo`, one URL per step (`/docs/tour/product/03-add-auth`), so a step can be linked and an agent can fetch one. The raw Markdown is served at the `.md` URL, as plan 0114 does for every page. |
| Order with plan 0114 | This plan needs plan 0114's `/docs` route and its fenced block plugin (#362, phases 3 and 4). Its issue is filed `blocked` by #362 (grill Q9, defaulted). |
| Attended phases | Phase 1 (the mockup), Phase 2 (the brief approval) and Phase 3 (the bench run) need the owner and come before the unattended phases (grill Q13, defaulted). The Phase 1 mockup runs when #362 is close to merge, with the built docs layout as its reference (grill Q14, asked). |
| Approved outward actions | The Phase 1 images go to the `mockups: mimukit/saasaloy` gist and to one comment on the tracking issue, under the owner's standing mockup rule. The Phase 3 bench run starts only when the owner starts it. No other action outside the branch. |
| Tests | Node's built-in test runner beside the source, as plan 0114 uses. No new runner. |
| UI house rules this plan follows | All of plan 0114's rows from `apps/web/DESIGN.md`, and its approved round 1 docs layout. New for this plan: the CLI and agent views of a step are two tabs with square corners, the active tab solid `primary`, as the catalog filter tabs are. A file tree and a diff are Geist Mono on a `card` surface with hairlines, and a created path is marked "+" and a patched path "U", as the hero source tree marks them. |

## Approach

A tour is a folder of plain Markdown steps. Each step names its code by anchor and its recorded output by step id, and the site fills both in at build time. The recordings come from the real CLI, and CI records them again on each PR. It reuses:

- Plan 0114's `/docs` layout, fenced block plugin, `.wikimap.yaml` freshness comment, raw Markdown routes and gates.
- `SAASALOY_REGISTRY_DIR` in `packages/cli/src/lib/registry.ts` for an offline registry, and `saasaloy add --dry-run --json` (`packages/cli/src/commands/add.ts`) for the plan document.
- `pnpm play:init` in the root `package.json` for the scaffold steps (`init --force --no-install`, then the shim).
- `scripts/agent-bench.ts`, its harness and the brief format in `scripts/agent-bench/briefs/` for the agent recording.
- The `saasaloy-setup`, `saasaloy-build`, `saasaloy-feature` and `saasaloy-deploy` skills in `packages/cli/templates/base/_agents/skills/` as the agent side of each step.
- The hero source tree in `apps/web/src/illustrations/repository-tree.tsx` as the visual reference for the file tree panel.

Rejected: a screen recording or video of a session. It cannot be checked and goes stale on the next release. Rejected: an in-browser sandbox (WebContainers) that runs the CLI live. It is the ideal for a reader, but it needs the npm registry and GitHub from the browser, and Workers features the sandbox cannot run. Rejected: tour definitions in a TypeScript file. GitHub and agents would lose the walkthrough.

### Phase 1: approve the tour mockup (#363)

Attended: the owner approves the mockup screenshots. Run this phase when #362 is close to merge, with the built docs layout as the reference.

- Mock up three screens in light and dark, at 375 px and 1440 px: a product tour step with the CLI tab active (`add auth`), the same step with the agent tab active, and a repo tour step with two code anchors.
- Each screen shows the step list, the narrative, the panel for the file tree or the code, previous and next, and the step count.
- Upload the images to the `mockups: mimukit/saasaloy` gist, show them in chat, and post the round to the tracking issue.
- Record the approval as a "Mockup approved" Design decisions row with the date, the round, the gist file prefix and the comment URL.

Done when: this plan has a "Mockup approved" row with the date, the round, the gist file prefix and the comment URL.

### Phase 2: the tour product brief (#363)

Attended: the owner approves the brief, because it is product copy that the site shows.

- Write `scripts/agent-bench/briefs/shiplog/` in the bench format: `brief.md`, `answers.md`, `env` and `expect.json`.
- The answers lead the interview to the eleven steps' module list, in order. `expect.json` names `entries` as the entity.

Done when: the brief folder exists, `node --test scripts/agent-bench/*.test.ts` passes, and the owner has approved the brief in the PR.

### Phase 3: the agent recording (#363)

Attended: the owner starts the bench run, because it uses an agent account and takes time.

- Add `scripts/tour-freeze.ts` and `pnpm tour:freeze <run-dir>`.
- Run `node scripts/agent-bench.ts --interview --brief shiplog`, read its `score.md`, and freeze the run when the score passes.

Done when: `apps/web/src/content/tour/shiplog/agent/` holds the frozen run with its CLI version and date, and the run's `score.md` shows a pass.

### Phase 4: the CLI recorder (#363)

- Add `scripts/tour-record.ts` with `pnpm tour:record` and `pnpm tour:check`. It reads the step list from the `saasaloy-step` blocks in `docs/wiki/tour/product/`.
- Normalize what changes between runs: absolute paths, dates, SHAs, durations and the registry ref.
- Add `pnpm tour:check` to `ci.yml`.
- Add `scripts/tour-record.test.ts`: two runs give the same files, a changed descriptor changes a recording, and the check mode fails on a stale recording.

Done when: `pnpm tour:record` run twice writes no diff, and changing one `description` in a module descriptor makes `pnpm tour:check` exit non-zero.

### Phase 5: anchors and the tour pages (#363)

- Add the `saasaloy-anchor` and `saasaloy-step` blocks to plan 0114's fenced block plugin, and the anchor search described in Design decisions.
- Add `/docs/tour/product/[step]` and `/docs/tour/repo/[step]`: the step list, the narrative, the CLI and agent tabs, and the file tree, code and output panels.
- Add the tour pages to the sitemap, `/llms-full.txt`, the docs sidebar and the gate route lists.

Done when: the site build fails on an anchor to a missing symbol, a tour step page renders its anchors and its recording, and `gate:a11y` and `gate:lighthouse` pass with one step of each tour in their route lists.

### Phase 6: the repo tour (#363)

- Write the repo tour steps in `docs/wiki/tour/repo/`: the repo map, a command's entry point, dependency resolution, the registry read, a module descriptor, the applier and its patch kinds, the lock and the ledger, update and the merge plan, a capability with providers, and the gates.
- Add each file to `.wikimap.yaml` with its anchor files as `documents:`.

Done when: `/docs/tour/repo` renders every step, every anchor resolves, and `pnpm docs:freshness` lists no tour page.

### Phase 7: the product tour (#363)

- Write the eleven product tour steps in `docs/wiki/tour/product/`. Each step holds a CLI block and an agent block. The entity step and the deploy step follow their Design decisions rows.
- Run `pnpm tour:record`, and commit the recordings.
- Add each file to `.wikimap.yaml`.

Done when: `/docs/tour/product` renders eleven steps with both tabs, `pnpm tour:check` passes, every anchor resolves, and `pnpm docs:freshness` lists no tour page.

## Open questions

None. Every question from the draft was settled in the grill on 2026-11-19. Nothing is deferred.

## Non-goals

- A live sandbox that runs the CLI in the browser.
- Video or screen recordings.
- A tour of every module. The catalog and the module pages of plan 0114 cover each one.
- Tours of a third-party registry.
- A tour completion metric or new analytics events.
- Changes to the bench scoring.
