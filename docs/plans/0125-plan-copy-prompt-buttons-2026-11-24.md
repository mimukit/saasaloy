# Plan: Copy prompt buttons beside CLI commands

Grilled: 2026-11-25

## Context

Saasaloy wants to be agent native. Today a reader who works through an AI agent copies a `saasaloy` command, then writes the surrounding instructions by hand. The landing page shows the install command in a `CommandField` with a Copy button (`apps/web/src/components/command-field.tsx`), and every docs code block gets a plain Copy button (`apps/web/src/lib/docs-code.ts`). Neither offers a prompt that an agent can follow.

The reference is the Neon setup block: two tabs, "Agent prompt" and "CLI", and one Copy button whose label changes with the tab. The agent prompt is one sentence that tells the agent to fetch a Markdown page and follow it.

The user is a developer who builds a product with Saasaloy through Claude Code, Codex or a similar agent.

Success: every place where a reader runs a `saasaloy` task command also offers a copyable agent prompt for the same task.

Target: all 16 inventoried places carry an Agent prompt tab, and a test fails when a `saasaloy` task block on a docs page lacks one.

### Inventory (from the 2026-11-24 survey)

| # | Surface | Place | Prompt |
|---|---|---|---|
| 1 | Landing | Hero command field | `init` |
| 2 | Landing | Closing "start" block | `init` |
| 3 | Landing | Stages block, 5 commands | `add {module}` |
| 4 | Landing | Module catalog tile, one template for every tile | `add {module}` |
| 5 | Docs | Every page in `docs/wiki/generated/modules/` (55 pages), through the generator | `add {module}` |
| 6 | Docs | `getting-started.md` | `init` |
| 7 | Docs | `how-to/add-a-module.md` | `add {module}` |
| 8 | Docs | `how-to/remove-a-module.md` | `remove {module}` |
| 9 | Docs | `how-to/contribute-a-module.md` | `contribute a module` |
| 10 | Docs | `how-to/deploy-to-cloudflare.md`, deploy | `deploy` |
| 11 | Docs | `how-to/deploy-to-cloudflare.md`, roll back | `deploy` (Roll back section) |
| 12 | Docs | `reference.md`, `saasaloy update` | `update` |
| 13 | Docs | `runbooks/update-overwrote-my-work.md` | `update` (recovery section) |
| 14 | Docs | `runbooks/move-off-the-infra-module.md` | `migrate off infra` |
| 15 | Docs | `generated/modules/database-postgres.md`, local setup | `database setup` |
| 16 | Docs | `generated/modules/database-postgres.md`, production setup | `database setup` (production section) |

Out of scope on purpose: `curl` checks, `git diff`, `pnpm --filter … dev`, flag variants such as `--dry-run` and `--abort`, and `how-to/build-with-an-agent.md`, which already addresses agents.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Prompt form | Fetch-a-page, as Neon does. The page `apps/web/src/pages/docs/[...slug].md.ts` already serves each wiki page as raw Markdown with absolute links, so the prompt cannot go stale. No inline step lists. |
| Prompt pattern | `<Task>. Fetch https://saasaloy.com/docs/<slug>.md and follow its <Section> section.` The section is `Install` on a module page and `For agents` on a task page. Example: "Add the waitlist module to my Saasaloy project. Fetch https://saasaloy.com/docs/modules/waitlist.md and follow its Install section." (grill Q11) |
| Section prompts | A prompt for one part of a page names the section in words, such as "follow its Roll back section". The raw route serves whole pages only, and no anchor is needed. (grill Q6) |
| Init guard | The `init` prompt says "in a new empty directory", so an agent does not run `init` inside an existing project. (grill Q7) |
| Default tab | Agent prompt first, CLI second, as in the reference. The Copy button reads "Copy prompt" on the agent tab and "Copy" on the CLI tab. |
| Target | Coverage, not copy rate. Cloudflare Web Analytics (`apps/web/src/lib/analytics.ts`) records no click events, so there is no copy-rate baseline. |
| README | Gets one plain text line under the install block: "Or tell your agent:" and the `init` prompt. GitHub renders no button. |
| One prompt source | Prompt sentences live in one content file, `apps/web/src/content/prompts.ts`, keyed by task, with `{name}` tokens filled by `apps/web/src/lib/interpolate.ts`. The landing blocks and the docs plugin read from it. No prompt text in a component. |
| Landing field | Extend `CommandField` with an optional `prompt` prop. With a prompt it renders the two tabs; without one it renders as today. One island, `client:visible`, as now. |
| Catalog and stages copy | `ModuleCatalog` and `Stages` stay static, with no React island. Their copy buttons are plain HTML with the `hidden` attribute, and one small inline script shows them and handles clicks, as `docs-code.ts` and the docs layout script do. (grill Q5) |
| Catalog tile form | The Phase 1 mockup decides between two tabs and a compact form on a catalog tile. (grill Q10) |
| Docs fence | A new `saasaloy-command` fence, added to `BLOCK_LANGUAGES` in `apps/web/src/lib/docs-blocks.ts` and rendered through the existing `docs-blocks-client.ts` island path. With JavaScript off, the reader sees the prompt and the command as plain text. An unknown task key fails the build, as the other `saasaloy-*` fences do. |
| Fence syntax | The arguments name the task and the module: `` ```saasaloy-command task=add name=waitlist ``. The body holds only the CLI commands, verbatim. A raw Markdown reader (GitHub, `/docs/<slug>.md`) sees the commands and no prompt, because an agent that reads raw Markdown needs the commands. (grill Q3) |
| Copy button in the fence | The `saasaloy-command` block has its own Copy button and `docs-code.ts` skips it. Other code blocks keep their plain Copy button. (grill Q9) |
| Module pages | `scripts/docs-generate.ts` writes an `## Install` section near the top of each generated module page. It holds a `saasaloy-command` fence and the ordered steps: `saasaloy add <name> --dry-run`, `saasaloy add <name> --yes`, `saasaloy env`, `pnpm install`, then a link to the module's skill. The `add {module}` prompt fetches this page. (grill Q1) |
| For agents sections | Each hand-written task page that a prompt fetches gets a `## For agents` section as its first section, at most six lines. It gives the ordered non-interactive commands (`--yes`, `--no-install`, per ADR 0046) and one check. The pages: `getting-started.md`, `how-to/add-a-module.md`, `how-to/remove-a-module.md`, `how-to/contribute-a-module.md`, `how-to/deploy-to-cloudflare.md`, `reference.md`, `runbooks/update-overwrote-my-work.md`, `runbooks/move-off-the-infra-module.md`. (grill Q2) |
| Generated page agent text | The `For agents` text on `generated/modules/database-postgres.md` comes from that module's skill through `docs-generate.ts`. No hand edit of a generated page. (grill Q12) |
| Coverage test | A `node --test` test in `apps/web/src/lib/`, beside `docs-blocks.test.ts`, scans every wiki page. A `bash` or `sh` line that starts with `saasaloy` or `npx saasaloy` plus `init`, `add`, `remove` or `update`, and has no `--dry-run`, `--abort` or `--done`, must sit in a `saasaloy-command` fence. Exceptions go in an allowlist inside the test, each with a reason. `node --test` is the runner `apps/web` already uses (`apps/web/package.json` `test`). (grill Q8) |
| UI house rules | From `apps/web/DESIGN.md`: square corners (`rounded.none`) on the field, tabs and button; no new colour, radius, shadow or type size; tabs use `code-sm`; the copied state never moves the layout; interface motion at or under 200ms on `--ease-out-soft`; links that leave the site open in a new tab. New for this plan: the Copy button label tracks the active tab. |
| Visual reference | The two Neon screenshots the owner shared on 2026-11-24 set the interaction. The Saasaloy look comes from the mockup round in Phase 1. Not approved yet. |
| Outward actions | The grill commits this plan to `main` and pushes it. Issues are filed later with `issuekit`, not by the grill. (grill Q4) |

## Approach

Extend the two copy surfaces that exist: `CommandField` on the landing page and the `saasaloy-*` fence plugin in the docs. Add one prompt content file that both read. The generator writes the module-page blocks and their Install steps, so 55 pages need no hand edit. Each fetched hand-written page gets a short `For agents` section, so the prompt points at text written for an agent.

Reuses: `CommandField` and its copied-state logic, `landing.ts` and `interpolate.ts` for copy, the `docs-blocks.ts` remark plugin and its client island, the `docs-code.ts` hidden-button pattern, the raw Markdown route, `scripts/docs-generate.ts`, and the CLI's non-interactive flags from ADR 0046.

Rejected alternatives:

- Minimal: put a second "Copy prompt" button on every existing code block. Rejected because the prompt would need to be guessed from the command, and many blocks are not tasks.
- Lateral: one site-wide "Set up with your agent" prompt that points at `llms.txt`. Rejected as the only surface because it gives no help at the point of a task. It stays a possible later addition.
- New per-task agent pages such as `/docs/agents/add.md`. Rejected because they add a second source beside the how-to pages.

### Phase 1: Mockup round

Attended: the owner approves the mockup screenshots before any build.

- Use `uikit` and `codex-images` to mock the tabbed command field in three sizes: the hero (`command-field-lg`), a catalog tile, and a docs block. Show light and dark, the agent tab and the CLI tab, the copied state, a long prompt that wraps or scrolls, and the mobile width.
- Show the stages block with its five commands, and the catalog tile in both forms: two tabs and a compact form.
- Publish the round to the mockup gist ("mockups: mimukit/saasaloy"). Keep the images out of the repo.
- Record the approved round, the date and the catalog tile form in this plan's Design decisions table and in `apps/web/DESIGN.md`.

Done when: this plan has a Design decisions row that names the approved mockup round, its approval date and the catalog tile form.

### Phase 2: Prompt content and the tabbed CommandField

- Add `apps/web/src/content/prompts.ts` with the eight task prompts: `init`, `add`, `remove`, `update`, `deploy`, `contribute`, `database-setup`, `migrate-off-infra`. Each holds the task sentence, the docs slug it fetches and the section it names, in the settled prompt pattern.
- Extend `CommandField` with the `prompt` prop, the two tabs, the per-tab Copy label, and the accessible names and live-region text in `landing.ts` `ui.commandField`.
- Pass the `init` prompt to the hero and the closing block in `apps/web/src/pages/index.astro`.
- Update the `command-field` entries in `apps/web/DESIGN.md`.

Done when: on the built site, the hero and the closing block open on the Agent prompt tab, "Copy prompt" puts the `init` prompt from `prompts.ts` on the clipboard (it names a new empty directory and `https://saasaloy.com/docs/getting-started.md` with its For agents section), and the CLI tab copies `npx saasaloy init my-app`.

### Phase 3: Stages and catalog

- Render the copy controls in `apps/web/src/blocks/stages.tsx` and `apps/web/src/blocks/module-catalog.tsx` as plain HTML with `hidden`, in the form the mockup approved.
- Add one small inline script in `apps/web/src/pages/index.astro` that shows the controls and handles the copy. Add no React island.
- Fill each prompt with the stage's or the tile's module name.

Done when: on the built landing page, each stage and each catalog tile copies an `add` prompt that names its own module and its own `/docs/modules/<name>.md` page, and the page adds no new `astro-island` element.

### Phase 4: The docs fence and the module pages

- Add `saasaloy-command` to `BLOCK_LANGUAGES` in `apps/web/src/lib/docs-blocks.ts`, its data in `docs-blocks-data.ts`, and its island in `docs-blocks-client.ts`. Fail the build on an unknown task key.
- Make `docs-code.ts` skip the Copy button on a `saasaloy-command` block.
- Make `scripts/docs-generate.ts` write the `## Install` section with the fence and the ordered steps on every generated module page. Make it write the `For agents` text on `database-postgres.md` from that module's skill. Run `pnpm docs:generate`.
- Add tests to `apps/web/src/lib/docs-blocks.test.ts` for the fence: the static fallback, the prompt text, and the bad-key failure.

Done when: `pnpm --filter web test` passes, `pnpm docs:check` passes, and `/docs/modules/waitlist` shows the tabbed block with the waitlist prompt above the ordered Install steps.

### Phase 5: Task pages, README and the coverage test

- Add a `## For agents` section to each of the eight hand-written task pages in Design decisions.
- Replace the task blocks at places 6 to 16 with `saasaloy-command` fences. Keep the flag-variant and debugging blocks as plain code.
- Add the "Or tell your agent:" line to `README.md`.
- Add the coverage test described in Design decisions.
- Run `pnpm docs:stale` and update the covering pages that `docs/wiki/.wikimap.yaml` names.

Done when: the coverage test passes, the built site shows a `saasaloy-command` block or tabbed field at all 16 inventoried places, and removing the fence from `how-to/add-a-module.md` makes the coverage test fail.

## Open questions

None. The catalog tile form is settled by the Phase 1 mockup.

## Non-goals

- No copy-rate tracking or new analytics events.
- No prompts inside the CLI's terminal output.
- No prompts in the scaffolded project's own docs or skills under `packages/cli/templates/base/`.
- No change to `llms.txt` or `llms-full.txt`.
- No prompt for debugging blocks (`curl`, `git`, `pnpm … dev`) or for flag variants.
- No new per-task agent pages.
- No prompt line in the raw Markdown body of a `saasaloy-command` fence.
