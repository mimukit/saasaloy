# QA Plan: Copy prompt buttons beside saasaloy commands

_Generated 2026-11-25 · against `687b230d` (clean) · covers issue #396: the landing page prompt tabs and compact copy controls, the docs `saasaloy-command` fence, the module Install sections, the task page For agents sections, the README prompt and the coverage test_

## Summary
- The site offers an agent prompt beside each `saasaloy` command, so a reader copies either the prompt or the command.
- Working means each copy button writes the correct text, the controls keep their layout, and the look matches mockup round 1 of plan 0125.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch / build under test: `issue-396-add-copy-prompt-buttons-beside-saasaloy-commands` at `687b230d`, built with `pnpm --filter web build`.
- Base URL: `http://127.0.0.1:4399`. The site is static, so no credentials and no auth token apply.
- Feature flags / config: none.
- Approved mockup images: round 1 of plan 0125, published in the mockup gist `https://gist.github.com/mimukit/60e583e0d41a1156c2a59e4b5a6a4b2a` as `0125-r1-*.png`.
- Screenshots: local to this run at `687b230d` and not committed. The names under each case match the labels in the gallery.

Launch with:

```sh
pnpm --filter web build
```

```sh
python3 -m http.server 4399 --bind 127.0.0.1 --directory apps/web/dist/client
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Built site, landing page, JavaScript on | The tabbed command field matches round 1 | 🔴 Critical |
| TC-1.2 | 1: Built site, landing page, JavaScript on | The compact controls in the stages and the catalog match option B | 🟡 Normal |
| TC-2.1 | 2: Built site, docs pages, JavaScript on | The docs command block matches round 1 | 🔴 Critical |
| TC-3.1 | 3: Built site, JavaScript off | The fallback reads well with no script | 🟢 Low |

## Scenario 1: Built site, landing page, JavaScript on

**Setup.** Run once, for every case in this scenario.

1. Open `http://127.0.0.1:4399/` in a desktop browser at 1440 px wide.
2. Open the approved images `0125-r1-hero-light-1440.png`, `0125-r1-hero-dark-1440.png`, `0125-r1-hero-light-390.png`, `0125-r1-catalog-b-light-1440.png` and `0125-r1-stages-light-1440.png` from the gist.

- [ ] Setup complete

### TC-1.1: The tabbed command field matches round 1  ·  🔴 Critical

**Goal.** The hero and the closing command fields look like the approved round 1 hero, in light and dark, on desktop and mobile.

**Steps**

1. Look at the hero command field in light mode. Compare it with `0125-r1-hero-light-1440.png`.
   - [ ] The field matches the approved image
     - square corners on the frame, the tabs and the Copy prompt button
     - the "Agent prompt" tab is solid; the "CLI" tab is outlined
     - the prompt wraps inside the field and does not scroll sideways
     - no colour that the approved image does not show
     - screenshots: `hero-light-1440` · `closing-light-1440`
2. Click the "CLI" tab. Then click "Agent prompt" again and click "Copy prompt".
   - [ ] The tab switch and the copied state do not move the field, the button or the text under it
     - screenshots: `hero-cli-light-1440` · `hero-copied-light-1440`
3. Switch the site to dark mode with the theme toggle. Compare the field with `0125-r1-hero-dark-1440.png`.
   - [ ] The same look is clean in dark, with every label legible on its background
     - screenshots: `hero-dark-1440` · `closing-dark-1440`
4. Set the browser width to 375 px. Compare the field with `0125-r1-hero-light-390.png`.
   - [ ] The Copy prompt button is a full-width bar under the prompt, and nothing is clipped
     - screenshots: `hero-light-375` · `hero-cli-light-375` · `hero-copied-light-375` · `hero-dark-375` · `closing-light-375` · `closing-dark-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The compact controls in the stages and the catalog match option B  ·  🟡 Normal

**Goal.** The small "Prompt" and "CLI" buttons in the stages and on the catalog tiles look like the approved option B and keep the tiles even.

**Steps**

1. Set the browser width to 1440 px. Scroll to the stages block. Compare it with `0125-r1-stages-light-1440.png`.
   - [ ] Each stage shows its command with two small outlined buttons beside it, in the approved style
     - the approved stages image shows tabs; the settled decision replaces them with the compact control of option B
     - screenshots: `stages-light-1440` · `stages-dark-1440`
2. Scroll to the catalog. Compare it with `0125-r1-catalog-b-light-1440.png`. Click "Prompt" on the first tile.
   - [ ] The buttons sit on their own line under each command, and every tile in a row keeps one height
     - screenshots: `catalog-light-1440` · `catalog-dark-1440`
   - [ ] The copied button turns solid with a check and "Copied" at the same width
     - screenshots: `catalog-copied-light-1440`
3. Set the browser width to 375 px. Scroll the stages and the catalog again.
   - [ ] The same look is clean at 375 px in light and dark
     - screenshots: `stages-light-375` · `stages-dark-375` · `catalog-light-375` · `catalog-dark-375` · `catalog-copied-light-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Close the browser tab. Nothing else changes.

## Scenario 2: Built site, docs pages, JavaScript on

**Setup.** Run once, for every case in this scenario.

1. Open `http://127.0.0.1:4399/docs/modules/waitlist/` at 1440 px wide. Scroll to the Install section.
2. Open the approved images `0125-r1-docs-light-1440.png`, `0125-r1-docs-dark-1440.png` and `0125-r1-docs-light-390.png`.

- [ ] Setup complete

### TC-2.1: The docs command block matches round 1  ·  🔴 Critical

**Goal.** The `saasaloy-command` block on a module page and on a how-to page looks like the approved round 1 docs block.

**Steps**

1. Compare the Install block with `0125-r1-docs-light-1440.png`.
   - [ ] The block matches the approved image
     - the active tab has `highlight` text over a 2px underline; the inactive tab is muted
     - the Copy prompt button sits at the right end of the tab strip
     - square corners; the numbered Install steps follow the block
     - screenshots: `docs-module-light-1440`
2. Click the "CLI" tab.
   - [ ] The three commands show, and the block does not jump in height in a way that disturbs reading
     - screenshots: `docs-module-cli-light-1440`
3. Open `http://127.0.0.1:4399/docs/how-to/add-a-module/`. Scroll to "Install one".
   - [ ] The how-to block has the same look as the module page block
     - screenshots: `docs-howto-light-1440`
4. Switch to dark mode. Compare with `0125-r1-docs-dark-1440.png`. Then set the width to 375 px and compare with `0125-r1-docs-light-390.png`.
   - [ ] The same look is clean in dark and at 375 px
     - screenshots: `docs-module-dark-1440` · `docs-howto-dark-1440` · `docs-module-light-375` · `docs-module-cli-light-375` · `docs-module-dark-375` · `docs-howto-light-375` · `docs-howto-dark-375`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Set the theme toggle back to your usual theme.

## Scenario 3: Built site, JavaScript off

**Setup.** Run once, for every case in this scenario.

1. Turn off JavaScript in the browser settings.
2. Open `http://127.0.0.1:4399/` at 1440 px wide.

- [ ] Setup complete

### TC-3.1: The fallback reads well with no script  ·  🟢 Low

**Goal.** A reader with no JavaScript still gets a usable prompt or command on the landing page and in the docs.

**Steps**

1. Look at the hero command field.
   - [ ] The hero is acceptable as shipped
     - the field shows the Agent prompt tab and the prompt text
     - the "CLI" tab and the Copy prompt button do nothing with JavaScript off, so the reader cannot see `npx saasaloy init my-app` in the hero
     - the stages and the catalog still show their commands, with no Prompt or CLI buttons
     - screenshots: `hero-nojs-light-1440`
2. Open `http://127.0.0.1:4399/docs/modules/waitlist/`. Scroll to the Install section.
   - [ ] The plain-text fallback reads well: "Agent prompt:" and the prompt, then the commands in a code block
     - screenshots: `docs-module-nojs-light-1440`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Turn JavaScript back on. Stop the server with Ctrl+C in its terminal.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Revision `687b230d`, clean tree. Each gate ran once at this revision; logs are in `.afkkit/logs/qa-*.log`.

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm --filter web build
```

```sh
pnpm --filter web test
```

```sh
pnpm test:scripts
```

```sh
pnpm docs:check
```

```sh
pnpm docs:stale --base origin/main
```

```sh
pnpm docs:stale
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
curl -s http://127.0.0.1:4399/ | grep -c 'npx saasaloy init my-app'
```

```sh
curl -s http://127.0.0.1:4399/docs/modules/waitlist.md | grep -c 'Fetch https'
```

Gates:

- ✅ `pnpm --filter web build` → exit 0; pagefind indexed 76 pages (`qa-web-build.log`)
- ✅ `pnpm --filter web test` → exit 0; 88 tests, 88 pass, 0 fail (`qa-web-test.log`)
- ✅ `pnpm test:scripts` → exit 0; 1053 tests, 1053 pass (`qa-test-scripts.log`)
- ✅ `pnpm docs:check` → exit 0; "60 generated pages are current" (`qa-docs-check.log`)
- ✅ `pnpm docs:stale --base origin/main` → exit 0; "no page covers a file this change touches without changing the page" (`qa-docs-stale.log`)
- ✅ `pnpm lint` → exit 0; four passes clean, "All matched files use Prettier code style!" (`qa-lint.log`)
- ✅ `pnpm typecheck` → exit 0; 1 task successful (`qa-typecheck.log`)
- The full `pnpm test` did not run here; the dispatcher runs it. The earlier green full run at `07d89b7c` (`g3-full-test.log`) is not this revision.

Acceptance checks (`.afkkit/checks.md`):

- ✅ C1 · `apps/web/src/content/prompts.ts` holds eight keys `init`, `add`, `remove`, `update`, `deploy`, `contribute`, `database-setup`, `migrate-off-infra`, built through one pattern `"{task} Fetch {origin}/docs/{slug}.md and follow its {section} section."` → each key has a task, a slug and a section; the prompts test "every key in the pattern" passes
- ✅ C2 · landing hero and closing field open on "Agent prompt" (`aria-selected="true"` on tab 0 in both, 2 tablists) → "Copy prompt" wrote `Create a new Saasaloy project in a new empty directory. Fetch https://saasaloy.com/docs/getting-started.md and follow its For agents section.` to the clipboard in both fields
- ✅ C3 · CLI tab in both fields → label "Copy", clipboard `npx saasaloy init my-app`, then "Copied"
- ✅ C4 · `apps/web/DESIGN.md` → tokens `command-tab`, `command-tab-active`, `docs-command-tab`, `docs-command-tab-active`, `copy-compact`, `copy-compact-copied`, and prose that names the two tabs, the arrow keys and the labels "Copy prompt", "Copy" and "Copied"
- ✅ C5 · 38 compact groups (5 stages, 33 catalog tiles with "Show all modules" on) → 38 of 38 "Prompt" buttons copy `Add the <name> module to my Saasaloy project. Fetch https://saasaloy.com/docs/modules/<name>.md and follow its Install section.` with `<name>` equal to the command on the same tile; 38 of 38 "CLI" buttons copy `npx saasaloy add <name>`; all 33 distinct `/docs/modules/<name>.md` return HTTP 200
- ✅ C6 · `astro-island` count on the built landing page → 3, equal to the base count of 3 recorded on `origin/main` in `.afkkit/g1-result.md`
- ✅ C7 · `/docs/modules/waitlist/` and `/docs/how-to/add-a-module/` render the tabbed block (1 and 2 blocks); curl of the static HTML shows `Agent prompt: Add the waitlist module ...` and the commands `saasaloy add waitlist`, `saasaloy env`, `pnpm install` as text; a browser context with JavaScript off shows the same text; the unit test "fails on an unknown task, a missing or stray name, an unknown module and no body" passes
- ✅ C8 · `[data-docs-copy]` inside a `saasaloy-command` block → 0 on both pages; outside the blocks every `pre` has a plain "Copy" button (3 of 3 on waitlist, 11 of 11 on add-a-module); unit test "gives a code block a Copy button, but not one inside a saasaloy-command block" passes
- ✅ C9 · 55 of 55 pages in `docs/wiki/generated/modules/` have `## Install` with a `saasaloy-command task=add name=<name>` fence and steps in order `add <name> --dry-run`, `add <name> --yes`, `saasaloy env`, `pnpm install`, skill link; `database-postgres.md` has `## For agents` at line 23 with two `task=database-setup` fences
- ✅ C11 · `## For agents` content lines (prose and commands, fence lines and blank lines not counted, per the settled count rule) → getting-started 4, add-a-module 5, remove-a-module 5, contribute-a-module 3, deploy-to-cloudflare 4, reference 6, update-overwrote-my-work 3, move-off-the-infra-module 4
- ✅ C12 · `saasaloy-command` fences at places 6 to 16 → getting-started 3, add-a-module 2, remove-a-module 2, contribute-a-module 2, deploy-to-cloudflare 3 (one with `section="Roll back"`), reference 1, update-overwrote-my-work 1, move-off-the-infra-module 2, database-postgres 2 (one with `section="Production setup"`); the `--dry-run`, `--diff` and `--abort` blocks stay plain `bash`/`sh`. Known open problem P1: place 13 carries an `update` prompt that fetches `reference.md`, not the runbook's recovery section (owner decision, not re-tested here)
- ✅ C13 · `README.md` line 67 "Or tell your agent:", line 69 the init prompt in a blockquote
- ✅ C14 · coverage test on a copy of `HEAD` in the scratch folder → green exit 0; with the "Install one" fence in `how-to/add-a-module.md` changed to `bash`, exit 1, failure names `{ page: 'how-to/add-a-module.md', line: 'saasaloy add waitlist' }` (`qa-coverage-bite-green.log`, `qa-coverage-bite-red.log`); the worktree was not edited
- ✅ C10 · `pnpm --filter web test` exit 0 (88 pass) and `pnpm docs:check` exit 0 (60 pages current)
- ✅ C15 · `pnpm docs:stale --base origin/main` (the CI mode, settled in `.afkkit/assumptions.md`) → exit 0, no stale covering page. Known open problem P2: plain `pnpm docs:stale` exits 0 but lists 10 pages, stale only from commits `329f37ac`, `609e7f02`, `6232c01d`, `dbd30b90` already on main (`qa-docs-stale-plain.log`)

### Browser checks
_Driven with `playwright-cli` (Chromium, clipboard read and write granted) against `http://127.0.0.1:4399` (static server over `apps/web/dist/client`) at `687b230d`. 34 screenshots, local to this run and not committed._

- ✅ `/` · hero field tabs → `["Agent prompt", "CLI"]`, tab 0 selected, `tabindex` `[0, -1]`
- ✅ `/` · hero button label per state → "Copy prompt", "Copied", back to "Copy prompt" after 2.2 s; CLI tab "Copy", then "Copied"
- ✅ `/` · hero button width over the four labels at 1440 px → 144, 144, 144, 144; field height 118 before and after the tab switch
- ✅ `/` · closing field, same checks → labels as hero; width 144 in every state; field height 138 before and after
- ✅ `/` · tab switch by click → `aria-selected="true"` on CLI
- ✅ `/` · arrow keys on both fields → ArrowLeft selects and focuses "Agent prompt", ArrowRight selects CLI, Home selects tab 0, End selects tab 1
- ✅ `/` · compact buttons → labels "Prompt"/"CLI", "Copied" after a click, width 81.2 before and after on all 76 buttons; the polite live region reads "Prompt copied to the clipboard."
- ✅ `/` · compact groups un-hidden by the inline script → 38 of 38 visible
- ✅ `/docs/modules/waitlist/` · block → tabs "Agent prompt"/"CLI"; "Copy prompt" copies the waitlist add prompt; ArrowRight selects CLI; "Copy" copies `saasaloy add waitlist\nsaasaloy env\npnpm install`; width 144 in all four states
- ✅ `/docs/how-to/add-a-module/` · both blocks → agent prompt as above; CLI copies `saasaloy add waitlist --dry-run\nsaasaloy add waitlist --yes\npnpm install` and `saasaloy add waitlist`; width 144 in all states
- ✅ `/docs/modules/waitlist.md` · raw route → the `saasaloy-command task=add name=waitlist` fence with three commands; 0 lines with `Fetch https`
- ✅ `/` · JavaScript off, curl → the init prompt 4 times and `npx saasaloy init my-app` 4 times in the HTML
- ✅ `/` · JavaScript off, browser → prompt text visible; 0 compact groups visible; the stages and catalog commands visible. The CLI panel is hidden and its tab is inert, so `npx saasaloy init my-app` is not visible in the hero (judged in TC-3.1)
- ✅ `/`, `/docs/modules/waitlist/`, `/docs/how-to/add-a-module/` · horizontal overflow, light and dark, 1440 px and 375 px → `scrollWidth` equals `clientWidth` in all 12 cases (1440/1440, 375/375)
- ✅ `/` at 375 px with all 33 tiles shown · rows overflowing → none; each tabpanel 325/325
- ✅ `/docs/modules/api-keys-organization/` at 375 px (longest module name) · page 375/375; block panel and `pre` 325/325
- ✅ console errors and warnings over every page and variant above → 0
- Worst-case data: every rendered value comes from `modules/*/registry-item.json` and `docs/wiki` at build time. A browser mock cannot reach build-time data, and the project declares no disposable target, so the run used the longest real names instead (above).

## Not covered / needs human judgment
- The visual match with mockup round 1 in light and dark, which TC-1.1, TC-1.2 and TC-2.1 hold.
- Clipboard behaviour in Safari and Firefox. The agent drove Chromium only.
- Screen reader output for the tabs and the live region. The agent checked roles, `aria-selected` and the live region text, not speech.
- Worst-case values outside the real registry, because the data is build-time and the project has no disposable target.
- Whether an agent that follows each prompt finishes the task. That needs a real agent session and a scaffolded project.
- P1 (place 13 recovery prompt) and P2 (plain `docs:stale` lists 10 pages from main) stay owner decisions, recorded in `.afkkit/problems.md`.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
