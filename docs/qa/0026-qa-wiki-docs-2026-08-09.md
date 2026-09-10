# QA Plan: Reader-facing wiki doc set (`docs/wiki/`)

_Generated 2026-08-09 · against `589c9de` · covers `docs/wiki/` (`.wikimap.yaml` + 8 pages) and one `## Documentation` section in `README.md`_

## Summary

- The change adds a reader-facing documentation set under `docs/wiki/` and one link to it from `README.md`.
- "Working" means a reader who follows a page reaches the outcome the page promises, and every command on every page runs and prints what the page says it prints.

## Overall result

_Tick one when you finish the run._

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

**Under test:** branch `issue-77-reader-facing-wiki-doc-set-via-wikikit-init`, commits `9b5504d` and `589c9de`.

**Two places you run things, and they are not interchangeable:**

1. **A fresh scratch clone**, for Scenarios 2, 3, 4 and 7. The tutorial tells a reader to clone the repo and run `pnpm cli:link`. `cli:link` puts one global `saasaloy` bin on your `PATH`, and it points at whichever checkout linked last. **Do not run `pnpm cli:link` from this worktree.** If you already have a global `saasaloy` from another checkout, run `pnpm cli:unlink` there first. `CONTRIBUTING.md#global-linking-main-checkout-only` states the rule.
2. **The repo's `.dev/playground`**, for Scenario 5. `AGENTS.md` names `.dev` as the directory for testing `saasaloy` CLI commands. The playground shim wires `SAASALOY_REGISTRY_DIR` to the current checkout, which is the module-author loop that Scenario 5 tests.

**Prerequisites:**

- Node 24.13.0 or newer. Check with `node -v`.
- pnpm 11 or newer. Check with `pnpm -v`.
- git, and a GitHub account that can view the pull request.
- No global `saasaloy` on your `PATH` when Scenario 2 starts.

Make the scratch root:

```sh
mkdir -p ~/qa-77 && cd ~/qa-77 && node -v && pnpm -v && command -v saasaloy || echo "no global saasaloy — correct start state"
```

**Read this before you judge a failure.** The point of this plan is to separate two outcomes:

- **The docs are wrong** — the page prints a command that errors, names a flag that does not exist, or promises an outcome the tool does not produce. This is a defect in the change under test.
- **The machine is wrong** — Node is too old, a port is busy, GitHub rate-limits you, or `pnpm setup` was never run. This is not a defect in the change. Record it in **Notes** and move on.

Each case names the point where that split happens.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1 — Branch rendered on GitHub, nothing installed | Every page renders and every link lands | 🔴 Critical |
| TC-1.2 | 1 — Branch rendered on GitHub, nothing installed | `README.md` works as the front door | 🟡 Normal |
| TC-1.3 | 1 — Branch rendered on GitHub, nothing installed | The two-track split routes each reader | 🟡 Normal |
| TC-1.4 | 1 — Branch rendered on GitHub, nothing installed | The provenance stamp resolves after merge | 🟢 Low |
| TC-2.1 | 2 — Clean machine, no `saasaloy` on `PATH` | Install the CLI from a clone | 🔴 Critical |
| TC-2.2 | 2 — Clean machine, no `saasaloy` on `PATH` | Scaffold a project and reach the landing page | 🔴 Critical |
| TC-2.3 | 2 — Clean machine, no `saasaloy` on `PATH` | "What you just got" matches the disk | 🟡 Normal |
| TC-2.4 | 2 — Clean machine, no `saasaloy` on `PATH` | The `init` variations the page describes | 🟡 Normal |
| TC-3.1 | 3 — Scaffolded project, no modules installed | `list`, then `add waitlist` and its preview | 🔴 Critical |
| TC-3.2 | 3 — Scaffolded project, no modules installed | `--dry-run` and `--diff` write nothing | 🟡 Normal |
| TC-3.3 | 3 — Scaffolded project, no modules installed | Re-run, `--force`, and the lock pin | 🟡 Normal |
| TC-3.4 | 3 — Scaffolded project, no modules installed | Drift and conflict are held back | 🟡 Normal |
| TC-3.5 | 3 — Scaffolded project, no modules installed | Flag handling matches `reference.md` | 🟢 Low |
| TC-4.1 | 4 — Project with `waitlist` and `email-cloudflare` | `remove` leaves the config patches behind (#36) | 🔴 Critical |
| TC-4.2 | 4 — Project with `waitlist` and `email-cloudflare` | The dependents refusal and `--force` | 🟡 Normal |
| TC-4.3 | 4 — Project with `waitlist` and `email-cloudflare` | Drift confirm, and `--yes` leaving files untracked | 🟡 Normal |
| TC-4.4 | 4 — Project with `waitlist` and `email-cloudflare` | The rest of "What stays behind" | 🟢 Low |
| TC-5.1 | 5 — Module checkout plus a throwaway project | The `SAASALOY_REGISTRY_DIR` install command | 🔴 Critical |
| TC-5.2 | 5 — Module checkout plus a throwaway project | The two failure modes the page warns about | 🟡 Normal |
| TC-6.1 | 6 — Scratch clone with a broken descriptor | The runbook reproduces the real error text | 🔴 Critical |
| TC-6.2 | 6 — Scratch clone with a broken descriptor | Who is protected and who is not | 🔴 Critical |
| TC-6.3 | 6 — Scratch clone with a broken descriptor | The revert path and the verify path | 🟡 Normal |
| TC-7.1 | 7 — All CLI work done, global bin still linked | `pnpm cli:unlink` removes the bin | 🟢 Low |

## Scenario 1 — Branch rendered on GitHub, nothing installed

GitHub is the real rendering target. The set is repo-relative Markdown, so GitHub rewrites every relative link itself. A path that exists on disk can still produce a 404 in the browser. Only a human clicking the rendered pages settles this.

**Setup** — once, for every case in this scenario.

1. Open the pull request for this branch in a browser.
2. Open the **Files changed** tab.
3. For each Markdown file, click the three-dot menu and choose **View file**. This gives you the rendered blob view, which is what a reader sees.

- [ ] Setup complete

### TC-1.1 — Every page renders and every link lands · 🔴 Critical

**Goal** — a reader who clicks through the set on GitHub never hits a 404 or a broken anchor.

**Steps**

1. Open the rendered `docs/wiki/index.md` on the branch.
   - [ ] The page renders as Markdown, not as raw text
     - the three section headings appear: "Use Saasaloy", "Build a module", "Both tracks"
     - no fenced block leaks its backticks into the prose
2. Click every link on `index.md` in turn. Use the browser back button between clicks.
   - [ ] Every link opens a real page, and no link 404s
     - the six wiki page links
     - `../../CONTEXT.md` and `../../CONTRIBUTING.md`, which climb out of `docs/wiki/`
     - `../adr/`, which opens a directory listing
3. Repeat the click sweep on the other seven pages.
   - [ ] The same sweep is clean on `getting-started.md`, `architecture.md` and `reference.md`
   - [ ] The same sweep is clean on the three `how-to/` pages and the runbook, which sit one directory deeper and use `../` and `../../../` prefixes
   - [ ] Every `#anchor` link scrolls to the heading it names, and none lands at the top of the page
     - `reference.md#known-limitations`, linked from `how-to/remove-a-module.md` and `architecture.md`
     - `reference.md#module-coordinates`, linked from `how-to/add-a-module.md` and `how-to/contribute-a-module.md`
     - `CONTRIBUTING.md#manual-qa-the-devplayground` and `CONTRIBUTING.md#global-linking-main-checkout-only`
     - `how-to/remove-a-module.md#what-stays-behind`
     - `how-to/contribute-a-module.md#test-it-before-you-open-the-pr`
4. Read the tables on `reference.md` and `architecture.md`.
   - [ ] Every table renders as a table, with no stray pipes and no cell that swallowed a following cell

**Where a failure means the docs are wrong:** any 404, any anchor that does not scroll, any table that renders as a paragraph. A slow page or a GitHub outage is the machine.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — `README.md` works as the front door · 🟡 Normal

**Goal** — a reader who lands on the repo home page finds the doc set.

**Steps**

1. Open the rendered `README.md` on the branch.
   - [ ] A `## Documentation` section sits between the email section and `## License`
   - [ ] The section is one sentence and one link, and nothing else in the README changed
2. Click the `docs/wiki/` link.
   - [ ] The browser opens the rendered `docs/wiki/index.md`

**Where a failure means the docs are wrong:** the link 404s, or the README gained anything beyond this one section.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — The two-track split routes each reader · 🟡 Normal

**Goal** — a reader picks the right first page from `index.md` without reading the whole set.

**Steps**

1. Read `index.md` once, as a person who wants to build an app on Saasaloy. Stop at the first page you would click.
   - [ ] "Use Saasaloy" is the section you stop in, and `getting-started.md` is the page you pick
   - [ ] Nothing in the "Build a module" section pulls you toward it by mistake
2. Read `index.md` again, as a person who wants to publish a module for other projects.
   - [ ] "Build a module" is the section you stop in
   - [ ] The runbook's one-line description tells you why it belongs to this track, not the other
3. Read the two warnings above the sections — the npm one and the "registry is this repo" one.
   - [ ] Both warnings are things you would want to know before clicking anything, not after
4. Open `getting-started.md` and read only the "Before you begin" section.
   - [ ] The prerequisites are stated as concrete versions, and none of them is a link you must follow first

**Where a failure means the docs are wrong:** you pick the wrong track, or a page's one-line description does not match what the page turns out to be.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — The provenance stamp resolves after merge · 🟢 Low

**Goal** — the stamp on every page names a commit a reader can actually find.

**Run this case after the pull request merges, not before.**

**Steps**

1. Read the last line of any wiki page.
   - [ ] It reads `_Verified against `main`@`48d32d7` on 2026-08-09._`
2. Open `https://github.com/mimukit/saasaloy/commit/48d32d7` in a browser.
   - [ ] GitHub shows the commit, and does not show "This commit does not belong to any branch"

**Known before you start.** `48d32d7` is this branch's own plan commit. It becomes reachable from `main` only when this pull request merges. The repo merges with merge commits, so it will be. If you run this case before the merge, mark it Skipped and say why.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

## Scenario 2 — Clean machine, no `saasaloy` on `PATH`

This is the spine of the plan. It is the acceptance criterion no agent has been able to run: *a reader following `getting-started.md` on a clean machine reaches a running scaffolded project.*

**Run the steps exactly as the page prints them.** Do not substitute a shortcut you know works. The thing under test is the page, not the tool.

**Setup** — once, for every case in this scenario.

1. Confirm no global `saasaloy` exists. If one exists, unlink it from the checkout that owns it.
2. Open `docs/wiki/getting-started.md` in the rendered GitHub view. Read from it, and copy commands from it.

```sh
command -v saasaloy && echo "STOP: unlink this first" || echo "clean start"
```

- [ ] Setup complete

### TC-2.1 — Install the CLI from a clone · 🔴 Critical

**Goal** — section 1 of the tutorial puts a working `saasaloy` on the reader's `PATH`.

**Steps**

1. Run the tutorial's clone block, from the page, in your scratch root.

   ```sh
   cd ~/qa-77 && git clone https://github.com/mimukit/saasaloy.git && cd saasaloy && pnpm install && pnpm cli:link
   ```

   - [ ] `pnpm install` completes without an engine error
   - [ ] `pnpm cli:link` builds the CLI and reports a global package added
2. Run the tutorial's check command.

   ```sh
   saasaloy --help
   ```

   - [ ] The shell finds `saasaloy`
   - [ ] The output lists exactly four commands: `init`, `add`, `remove`, `list`
   - [ ] No fifth command appears
3. Read the paragraph about `pnpm setup` and the paragraph about linking from one checkout only.
   - [ ] Both paragraphs describe a situation you can recognise, and the `CONTRIBUTING.md` link opens the right heading

**Where the split falls.** An engine error naming a Node version below 24.13.0 means **your machine** is wrong, and the page's own "Before you begin" told you so — that is the page working. A `saasaloy: command not found` after `pnpm setup` has already run means **the page** is wrong. A build failure inside `pnpm cli:link` means the repo is broken, not the docs; record it and stop the plan.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — Scaffold a project and reach the landing page · 🔴 Critical

**Goal** — sections 2 and 3 of the tutorial end with a landing page in the browser.

**Steps**

1. Leave the clone. Scaffold the project the page names.

   ```sh
   cd ~/qa-77 && saasaloy init my-app
   ```

   - [ ] The CLI asks whether to install dependencies, in the words the page predicts
   - [ ] The run ends with a "Next steps" block, and exits without an error
2. Answer **no** to the install prompt on this first run. The page says the CLI then prints the command in the next steps.
   - [ ] The next-steps block names `pnpm install`
3. Run section 3 exactly as printed.

   ```sh
   cd ~/qa-77/my-app && pnpm install && pnpm dev
   ```

   - [ ] `pnpm dev` starts and the log names port 3000
4. Open `http://localhost:3000` in a browser.
   - [ ] A landing page renders, with styling applied and no console-breaking error
   - [ ] This is the moment the acceptance criterion passes — a reader who followed only this page got here
5. Stop the dev server with Ctrl-C. Start something else on port 3000, then run `pnpm dev` again.
   - [ ] The server fails loudly about the busy port, and does not move to 3001
   - [ ] The page's `strictPort` claim matches what you saw
6. Stop the process holding port 3000.

**Where the split falls.** A busy port, a firewall, or a proxy is **your machine**. A page that told you port 3000 while the server started on another port is **the page**. If `pnpm install` inside `my-app` fails on a network error, retry once before you call it a defect.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — "What you just got" matches the disk · 🟡 Normal

**Goal** — the tree the page draws is the tree the tool wrote.

**Steps**

1. List the scaffolded project.

   ```sh
   cd ~/qa-77/my-app && ls -a && ls apps packages
   ```

   - [ ] Every entry the page's tree names exists
     - `apps/web/`, `packages/ui/`, `packages/tsconfig/`
     - `saasaloy.json` and `turbo.json`
   - [ ] Nothing the page calls absent is present — there is no `apps/api`, no database package and no auth package
2. Read the paragraph about `saasaloy.json` being the project-root marker. Test it from a subdirectory.

   ```sh
   cd ~/qa-77/my-app/apps/web && saasaloy list
   ```

   - [ ] The command runs from the subdirectory without a "no project" error

**Where the split falls.** A missing directory means the page describes a template that changed. Extra files the page does not mention are fine — the tree is illustrative, and the page does not claim it is exhaustive.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.4 — The `init` variations the page describes · 🟡 Normal

**Goal** — every `init` behaviour section 2 describes is the behaviour you get.

**Steps**

1. Try to scaffold into the directory that already holds a project.

   ```sh
   cd ~/qa-77 && saasaloy init my-app
   ```

   - [ ] The CLI stops, tells you the target is not empty, and names `--force`
2. Scaffold into a directory that holds only a `.git` directory.

   ```sh
   mkdir -p ~/qa-77/git-only && cd ~/qa-77/git-only && git init -q && saasaloy init .
   ```

   - [ ] The scaffold proceeds, which confirms the page's claim that `.git` alone does not count as non-empty
   - [ ] The `.` form works, and the project name comes from the directory name
3. Scaffold to a path, and check the name comes from the last segment.

   ```sh
   cd ~/qa-77 && saasaloy init ./nested/deep-app --no-install
   ```

   - [ ] The project lands at `~/qa-77/nested/deep-app`
   - [ ] `--no-install` suppresses the install prompt completely
   - [ ] `deep-app` is the name recorded in the generated `saasaloy.json`
4. Use a name the page's rule forbids.

   ```sh
   cd ~/qa-77 && saasaloy init My_App
   ```

   - [ ] The CLI rejects the name and states the allowed pattern
5. Run `init` with no name at all, then cancel the prompt.

   ```sh
   cd ~/qa-77 && saasaloy init
   ```

   - [ ] The CLI prompts for a name, as the page says it does

**Where the split falls.** Each of these is a sentence on the page. A behaviour that differs from its sentence is a doc defect, whichever way it differs.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 3. Keep `~/qa-77/my-app` and keep the linked CLI. Scenarios 3, 4 and 7 need both.

```sh
rm -rf ~/qa-77/git-only ~/qa-77/nested
```

## Scenario 3 — Scaffolded project, no modules installed

This scenario walks `docs/wiki/how-to/add-a-module.md` against `~/qa-77/my-app` from Scenario 2. Read the page in the browser and copy commands from it.

These cases call GitHub's API. If you have a `GITHUB_TOKEN`, export it — `reference.md` documents it as the fix for the anonymous rate limit, and this scenario is a good place to confirm that sentence.

**Setup** — once, for every case in this scenario.

```sh
cd ~/qa-77/my-app && git init -q && git add -A && git commit -qm "scaffold baseline" && git status --short
```

The commit gives you a baseline to diff against. Every later case can show exactly what a command touched.

- [ ] Setup complete

### TC-3.1 — `list`, then `add waitlist` and its preview · 🔴 Critical

**Goal** — the preview sections the page enumerates are the sections `add` actually prints.

**Steps**

1. List the registry.

   ```sh
   cd ~/qa-77/my-app && saasaloy list
   ```

   - [ ] The output is module names only, with no descriptions and no versions
   - [ ] `waitlist` appears in the list
2. Start the install. Stop at the confirmation prompt and read the whole preview before you answer.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist
   ```

   - [ ] Every section the page lists appears, and none is missing
     - **Dependencies** — and it resolved `api` and `database`, prerequisites first
     - **Plan** — every file tagged `create`, `overwrite`, `unchanged`, `drift → merge` or `conflict → merge`
     - **Env vars to set** — including `PUBLIC_API_URL` with the descriptor's own description
     - **Aliases registered**, and **Skill links** if the modules ship one
     - **Config patches**, if any module in this graph patches a file another owns
   - [ ] The prompt reads `Proceed?`
3. Answer **no**.

   ```sh
   cd ~/qa-77/my-app && git status --short
   ```

   - [ ] The working tree is clean, which confirms the page's "answer no and nothing is written"
4. Run `add` again and answer **yes** this time.
   - [ ] The install completes and reports the files it wrote
5. Read the page's "Finish the install" section and follow it.

   ```sh
   cd ~/qa-77/my-app && pnpm install
   ```

   - [ ] pnpm links the new workspaces the plan announced as aliases
   - [ ] The page was right that `add` merged the dependencies but did not install them

**Where the split falls.** A missing preview section, or a section header whose wording differs from the page, is a doc defect. A GitHub rate-limit error is your machine — set `GITHUB_TOKEN` and retry, which also tests that sentence in `reference.md`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — `--dry-run` and `--diff` write nothing · 🟡 Normal

**Goal** — both preview flags stop before the write stage, as the page promises.

**Steps**

1. Preview a module that is not yet installed.

   ```sh
   cd ~/qa-77/my-app && saasaloy add email-console --dry-run && git status --short
   ```

   - [ ] The plan prints, no `Proceed?` prompt appears, and the working tree stays clean
2. Preview the same module with a diff.

   ```sh
   cd ~/qa-77/my-app && saasaloy add email-console --diff && git status --short
   ```

   - [ ] The output adds a per-file diff on top of the plan
   - [ ] A long file is truncated with a "more lines" marker, which matches the page's 60-line cap
   - [ ] The working tree still stays clean

**Where the split falls.** Any file appearing in `git status` after either flag is a doc defect and a tool bug at once — the page states plainly that neither can touch disk.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.3 — Re-run, `--force`, and the lock pin · 🟡 Normal

**Goal** — the page's three claims about repeat installs all hold.

**Steps**

1. Re-run the install of a module whose graph is already complete.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist ; echo "exit=$?"
   ```

   - [ ] The output says `Nothing to do`
   - [ ] The exit code is 0
2. Force a re-apply.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist --force
   ```

   - [ ] The CLI re-applies `waitlist`
   - [ ] The already-installed dependencies `api` and `database` are left alone, as the page says
3. Read the lock entry the page describes.

   ```sh
   cd ~/qa-77/my-app && cat saasaloy-lock.json
   ```

   - [ ] Each installed module records a source, a ref and a resolved commit SHA
   - [ ] The resolved SHA is the same for every module installed in one run

**Where the split falls.** A `--force` that also re-applies the dependencies contradicts the page. A missing `resolved` SHA breaks the reproducibility claim the page and `architecture.md` both make.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.4 — Drift and conflict are held back · 🟡 Normal

**Goal** — the two "left alone" plan actions the page names behave as described.

**Steps**

1. Hand-edit a file `waitlist` applied. Add a comment line at the top of it.
   - [ ] You edited a file that appears in `.saasaloy/manifest.json`
2. Re-apply the module and read the plan.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist --force --diff
   ```

   - [ ] Your edited file is tagged `drift → merge`
   - [ ] A **Needs merge** section lists it at the end of the run
   - [ ] The diff shows what the registry would have written, which is what the page tells you to do next
3. Run the same command without `--diff` and let it apply.
   - [ ] Your edit survives, and the registry version does not overwrite it
4. Create a file at a path a not-yet-installed module owns, then plan that module.

   ```sh
   cd ~/qa-77/my-app && saasaloy add email-console --dry-run
   ```

   - [ ] The pre-existing file is tagged `conflict → merge` and listed under **Needs merge**

**Where the split falls.** An overwritten hand-edit is the worst failure in this plan. The page promises restraint by name; if the tool overwrites, the docs are actively misleading.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.5 — Flag handling matches `reference.md` · 🟢 Low

**Goal** — `reference.md` is exhaustive and honest about which commands reject bad input.

**Steps**

1. Give `add` a flag that does not exist.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist --nope ; echo "exit=$?"
   ```

   - [ ] The command cancels before doing any work, with exit 1
2. Give `add` an extra positional argument.

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist extra ; echo "exit=$?"
   ```

   - [ ] The command cancels with exit 1
3. Give `list` a flag, which `reference.md` says is filtered out and never inspected.

   ```sh
   cd ~/qa-77/my-app && saasaloy list --nope ; echo "exit=$?"
   ```

   - [ ] `list` runs normally and exits 0, ignoring the flag
4. Give `init` an unknown flag, which `reference.md` warns is silently ignored.

   ```sh
   cd ~/qa-77 && saasaloy init flagtest --no-install --nope ; echo "exit=$?"
   ```

   - [ ] The scaffold proceeds and the unknown flag produces no error
   - [ ] `reference.md`'s warning to check your spelling is warranted
5. Read the coordinate grammar block on `reference.md`. Try both unsupported forms.

   ```sh
   cd ~/qa-77/my-app && saasaloy add mimukit/saasaloy@feature/x/waitlist ; echo "exit=$?"
   ```

   ```sh
   cd ~/qa-77/my-app && saasaloy add waitlist@v2 ; echo "exit=$?"
   ```

   - [ ] Both produce a `Malformed coordinate` error, as the page says
6. Clean up the flag-test scaffold.

   ```sh
   rm -rf ~/qa-77/flagtest
   ```

**Where the split falls.** A flag listed on `reference.md` that the tool rejects, or a flag the tool accepts that the page omits, is a doc defect. The asymmetry between `add`/`remove` and `init`/`list` is documented on purpose — confirm it rather than treating it as a bug.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 4. Keep the project and the installed modules.

```sh
cd ~/qa-77/my-app && git add -A && git commit -qm "after add scenarios" && git log --oneline
```

## Scenario 4 — Project with `waitlist` and `email-cloudflare` installed

This scenario walks `docs/wiki/how-to/remove-a-module.md` and confirms the documented config-patch gap. `email-cloudflare` is the module that proves it: its descriptor patches `apps/api/wrangler.jsonc` with a `send_email` binding named `EMAIL`, and registers a `cloudflare` provider in the `providers` array in `packages/email/src/index.ts`.

You do not need a Cloudflare account for this scenario. Nothing here sends an email.

**Setup** — once, for every case in this scenario.

```sh
cd ~/qa-77/my-app && saasaloy add email-cloudflare --yes && pnpm install && git add -A && git commit -qm "with email-cloudflare"
```

- [ ] Setup complete

### TC-4.1 — `remove` leaves the config patches behind (#36) · 🔴 Critical

**Goal** — the gap `how-to/remove-a-module.md` and `reference.md#known-limitations` both describe is the gap the tool has.

**Steps**

1. Record the two patched files before you remove anything.

   ```sh
   cd ~/qa-77/my-app && grep -n "send_email" apps/api/wrangler.jsonc && grep -n "cloudflare" packages/email/src/index.ts
   ```

   - [ ] The `send_email` binding named `EMAIL` is present in `apps/api/wrangler.jsonc`
   - [ ] The `cloudflare` provider entry and its import are present in `packages/email/src/index.ts`
2. Preview the removal and read the warnings.

   ```sh
   cd ~/qa-77/my-app && saasaloy remove email-cloudflare --dry-run
   ```

   - [ ] The output prints one warning per patched file
   - [ ] Each warning names the file and says the patch is not reversed by `remove`
3. Remove the module.

   ```sh
   cd ~/qa-77/my-app && saasaloy remove email-cloudflare --yes
   ```

   - [ ] The module's own files are deleted
4. Check the two patched files again.

   ```sh
   cd ~/qa-77/my-app && grep -n "send_email" apps/api/wrangler.jsonc ; grep -n "cloudflare" packages/email/src/index.ts
   ```

   - [ ] **Both edits are still there.** This is the documented behaviour, and the case passes when they survive
   - [ ] The page's exact example — the `send_email` binding and the provider entry — matches what you see
5. Check the manifest dropped the patch records.

   ```sh
   cd ~/qa-77/my-app && cat .saasaloy/manifest.json
   ```

   - [ ] No patch entry for `email-cloudflare` remains, which is the "untracking, not undoing" the page describes
6. Follow the page's link to the tracking issue.
   - [ ] `reference.md#known-limitations` names [#36](https://github.com/mimukit/saasaloy/issues/36) and describes the same gap in the same terms

**Where the split falls.** This case **fails if the patches are gone**, because the docs would then describe a limitation that no longer exists. It also fails if `remove` printed no warning — the page promises one per patched file.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — The dependents refusal and `--force` · 🟡 Normal

**Goal** — `remove` refuses to strand a dependent, and the page's escape hatch works.

**Steps**

1. Try to remove a module another installed module depends on. `waitlist` depends on `api` and `database`, so remove `database`.

   ```sh
   cd ~/qa-77/my-app && saasaloy remove database ; echo "exit=$?"
   ```

   - [ ] The CLI refuses and names the dependent
   - [ ] The message mentions `--force`, in the shape the page quotes
2. Override the refusal.

   ```sh
   cd ~/qa-77/my-app && saasaloy remove database --force --yes
   ```

   - [ ] The module is removed
   - [ ] `waitlist` stays installed, which is the "dependents installed and broken" outcome the page warns about
3. Restore the state for the next case.

   ```sh
   cd ~/qa-77/my-app && git checkout -- . && git clean -fd && git status --short
   ```

   - [ ] The working tree is back at the Scenario 4 setup commit

**Where the split falls.** A refusal that does not name the dependent, or a `--force` that also removes the dependents, contradicts the page.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.3 — Drift confirm, and `--yes` leaving files untracked · 🟡 Normal

**Goal** — the page's two drift outcomes both happen, including the surprising one.

**Steps**

1. Hand-edit a file `waitlist` applied.
2. Remove the module interactively.

   ```sh
   cd ~/qa-77/my-app && saasaloy remove waitlist
   ```

   - [ ] The plan tags your edited file `drift → confirm`
   - [ ] The CLI asks whether to delete it anyway, and the default answer is no
3. Decline the deletion and finish the run.
   - [ ] The file is still on disk
   - [ ] It no longer appears in `.saasaloy/manifest.json`, which is the "it is yours now" the page describes
4. Restore, re-install, hand-edit again, then remove under `--yes`.

   ```sh
   cd ~/qa-77/my-app && git checkout -- . && git clean -fd && saasaloy add waitlist --yes
   ```

   Edit an applied file again, then:

   ```sh
   cd ~/qa-77/my-app && saasaloy remove waitlist --yes ; echo "exit=$?"
   ```

   - [ ] No prompt appears at all
   - [ ] The drifted file survives on disk, untracked
   - [ ] The exit code is 0, which the page calls the designed outcome rather than a failure

**Where the split falls.** A prompt appearing under `--yes`, or a drifted file being deleted, contradicts the page directly. Both directions are doc defects.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.4 — The rest of "What stays behind" · 🟢 Low

**Goal** — the other four claims in that section are each true.

**Steps**

1. Compare the root `package.json` before and after a removal.

   ```sh
   cd ~/qa-77/my-app && git diff HEAD -- package.json
   ```

   - [ ] The removed module's npm dependencies are still listed, as the page says
2. Read `saasaloy.json` after removing a module that registered an alias.

   ```sh
   cd ~/qa-77/my-app && cat saasaloy.json
   ```

   - [ ] An alias whose target directory is now gone has been dropped
   - [ ] The removed module no longer appears in the installed list
3. Check the skill links, which the page says are removed properly, unlike patches.

   ```sh
   cd ~/qa-77/my-app && ls -la .claude/skills 2>/dev/null ; ls -la .agents/skills 2>/dev/null
   ```

   - [ ] A skill a removed module installed is gone from both locations
   - [ ] The asymmetry the page draws between skill links and config patches holds
4. Look for the now-empty directories the page says `remove` cleans up.
   - [ ] No empty directory the module created is left behind

**Where the split falls.** Any of the four claims failing is a doc defect. If none of your installed modules ships a skill, mark step 3 in Notes rather than guessing.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 5. Keep the linked CLI for Scenario 7.

```sh
rm -rf ~/qa-77/my-app
```

## Scenario 5 — Module checkout plus a throwaway project

This scenario walks `docs/wiki/how-to/contribute-a-module.md`. It uses this worktree as the module checkout, so it tests the loop a module author actually runs.

**Setup** — once, for every case in this scenario.

```sh
mkdir -p ~/qa-77/throwaway && cd ~/qa-77/throwaway && saasaloy init . --no-install && pnpm install
```

Note the absolute path of this worktree's `modules/` directory. You need it in every case below:

```sh
echo /home/dev/worktrees/saasaloy/issue-77-reader-facing-wiki-doc-set-via-wikikit-init/modules
```

- [ ] Setup complete

### TC-5.1 — The `SAASALOY_REGISTRY_DIR` install command · 🔴 Critical

**Goal** — the page's local-registry command installs a module from a checkout, as printed.

**Steps**

1. Run the page's command, with the absolute path filled in and a module that exists in the checkout.

   ```sh
   cd ~/qa-77/throwaway && SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-77-reader-facing-wiki-doc-set-via-wikikit-init/modules saasaloy add waitlist --diff
   ```

   - [ ] The plan and the per-file diff print, and nothing is written
   - [ ] The content comes from the local checkout, not from GitHub — no network fetch appears in the output
2. Pass a repo coordinate at the same time, which the page says the local source overrides.

   ```sh
   cd ~/qa-77/throwaway && SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-77-reader-facing-wiki-doc-set-via-wikikit-init/modules saasaloy add mimukit/saasaloy/waitlist --dry-run
   ```

   - [ ] The CLI warns that the local directory wins over the coordinate
   - [ ] The plan is still built from the local checkout
3. Do the same with `list`.

   ```sh
   cd ~/qa-77/throwaway && SAASALOY_REGISTRY_DIR=/home/dev/worktrees/saasaloy/issue-77-reader-facing-wiki-doc-set-via-wikikit-init/modules saasaloy list mimukit/saasaloy
   ```

   - [ ] `list` prints the same warning and lists the local module names

**Where the split falls.** A command that errors when copied from the page with only the path substituted is a doc defect. A missing warning contradicts the page's last sentence in that section.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-5.2 — The two failure modes the page warns about · 🟡 Normal

**Goal** — both warnings on the page describe a failure you can actually produce.

**Steps**

1. Use a relative path, which the page says resolves against the directory you run `add` from.

   ```sh
   cd ~/qa-77/throwaway && SAASALOY_REGISTRY_DIR=./modules saasaloy add waitlist --dry-run ; echo "exit=$?"
   ```

   - [ ] The command fails, because `./modules` does not exist under the throwaway project
   - [ ] The error names the missing directory, which is what makes the page's "use an absolute path" advice actionable
2. Run the same install from inside the tool repo, which the page says cancels.

   ```sh
   cd /home/dev/worktrees/saasaloy/issue-77-reader-facing-wiki-doc-set-via-wikikit-init && saasaloy add waitlist --dry-run ; echo "exit=$?"
   ```

   - [ ] The command cancels with `No saasaloy.json found`, in the page's own words
   - [ ] Nothing in this worktree changed
3. Open `CONTRIBUTING.md#manual-qa-the-devplayground` from the page's link.
   - [ ] The playground loop the page points to exists, and the shim it describes is the one `pnpm play:init` drops
   - [ ] The page correctly presents the playground as the iterating path and `SAASALOY_REGISTRY_DIR` as the manual one

**Where the split falls.** A warning on the page you cannot reproduce means the page is describing a failure mode that no longer exists. Step 2 failing in any other way — for example writing files into the worktree — is a serious defect; stop and record it.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 6.

```sh
rm -rf ~/qa-77/throwaway
```

## Scenario 6 — Scratch clone with a broken descriptor

This scenario walks `docs/wiki/runbooks/bad-descriptor-on-main.md`.

**Never rehearse this runbook against the real `mimukit/saasaloy` `main` branch.** Step 3 of the runbook pushes to `main`. Rehearse it on a personal fork or on a local bare repo. Break the descriptor only in your scratch clone.

**Setup** — once, for every case in this scenario.

1. Clone the repo to a scratch path, as the runbook's step 2 does.

   ```sh
   git clone https://github.com/mimukit/saasaloy.git ~/qa-77/saasaloy-check
   ```

2. Break one descriptor on purpose. Open `~/qa-77/saasaloy-check/modules/waitlist/registry-item.json` and delete the `"type"` key, which the schema requires.
3. Scaffold a project to install into.

   ```sh
   mkdir -p ~/qa-77/incident-app && cd ~/qa-77/incident-app && saasaloy init . --no-install
   ```

- [ ] Setup complete

### TC-6.1 — The runbook reproduces the real error text · 🔴 Critical

**Goal** — the runbook's step 2 command produces one of the three errors the Symptoms section quotes.

**Steps**

1. Run the runbook's step 2 command against your broken clone.

   ```sh
   cd ~/qa-77/incident-app && SAASALOY_REGISTRY_DIR=$HOME/qa-77/saasaloy-check/modules saasaloy add waitlist --dry-run ; echo "exit=$?"
   ```

   - [ ] The command fails with the invalid-descriptor error, and the ajv errors print one per line
   - [ ] The wording matches the Symptoms block on the runbook
   - [ ] `--dry-run` stopped before anything was written, as the runbook says
2. Now break a prerequisite instead. Restore `waitlist`, then delete the `"type"` key from `~/qa-77/saasaloy-check/modules/database/registry-item.json`.

   ```sh
   cd ~/qa-77/incident-app && SAASALOY_REGISTRY_DIR=$HOME/qa-77/saasaloy-check/modules saasaloy add waitlist --dry-run ; echo "exit=$?"
   ```

   - [ ] The error names the prerequisite and appends `(required by waitlist)`, as the runbook says
3. Rename a module folder so the folder and the descriptor `name` disagree.
   - [ ] The third quoted error appears, about the folder and descriptor name having to match
4. Restore the clone to a clean state before the next case.

   ```sh
   cd ~/qa-77/saasaloy-check && git checkout -- . && git clean -fd && git status --short
   ```

**Where the split falls.** An error whose text differs from the runbook's quoted block is a doc defect — an incident responder greps for these strings. A missing `(required by …)` suffix means the runbook overstates what the tool tells you.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-6.2 — Who is protected and who is not · 🔴 Critical

**Goal** — the runbook's protected / not-protected split is the split the tool implements.

This is the case that decides how loud a real incident has to be, so it is worth running carefully.

**Steps**

1. Break `waitlist` in the scratch clone again.
2. Confirm the runbook's claim that a broken module still lists.

   ```sh
   cd ~/qa-77/incident-app && SAASALOY_REGISTRY_DIR=$HOME/qa-77/saasaloy-check/modules saasaloy list
   ```

   - [ ] `waitlist` still appears in the list, despite the broken descriptor
   - [ ] The runbook's "a green `list` proves nothing here" is correct
3. Confirm a **first-time** add is not protected. Use the fresh project, which has no lock entry.
   - [ ] The add fails, which matches the runbook's first "not protected" bullet
4. Confirm an already-locked consumer **is** protected. Restore the clone, install `waitlist` from GitHub into a second project so a lock entry exists, then break `main`'s copy in your fork and re-add without a ref.
   - [ ] The re-add succeeds, because it resolved the SHA the lockfile recorded
   - [ ] The runbook's "Protected" paragraph names exactly these three conditions: an existing lock entry, the same `owner/repo`, and no explicit `@ref`
5. Confirm an explicit `@ref` bypasses the lock pin. Re-add the same module with a ref that names the broken tip.
   - [ ] The add fails, which matches the runbook's second "not protected" bullet

**Where the split falls.** If a first-time add turns out to be protected, or a locked consumer turns out not to be, the runbook sends a responder to the wrong users. That is the most damaging kind of doc defect in this set.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-6.3 — The revert path and the verify path · 🟡 Normal

**Goal** — the runbook's steps 3, 4 and 5 are runnable and correct.

**Run steps 1 and 2 against a fork or a local bare remote, never against `mimukit/saasaloy`.**

**Steps**

1. Commit the broken descriptor to your fork's `main`, then run the runbook's revert block.

   ```sh
   git checkout main && git pull && git revert <bad-sha> && git push origin main
   ```

   - [ ] Every command runs as printed, with only `<bad-sha>` substituted
   - [ ] The revert commit becomes the new tip
2. Repeat with a merge commit, using the runbook's variant.

   ```sh
   git revert -m 1 <merge-sha>
   ```

   - [ ] The merge revert works, and the runbook's `-m 1` is the right parent
3. Run the runbook's step 4 verify block.

   ```sh
   saasaloy init /tmp/verify-app --no-install && cd /tmp/verify-app && saasaloy add waitlist --dry-run
   ```

   - [ ] Both commands run as printed
   - [ ] `--dry-run` reaches the validation stage, which is what makes it "enough" as the runbook claims
4. Run the step 5 pinned-coordinate escape hatch with a real known-good SHA.

   ```sh
   cd /tmp/verify-app && saasaloy add mimukit/saasaloy@<last-good-sha>/waitlist --dry-run
   ```

   - [ ] The pinned coordinate resolves and plans against that SHA
5. Read the "Why there is no faster lever" section.
   - [ ] The claim that the repo has no CI still holds — there is no `.github/` directory on `main`
   - [ ] The claim that `pnpm lint` runs no tasks still holds
6. Clean up.

   ```sh
   rm -rf /tmp/verify-app ~/qa-77/saasaloy-check ~/qa-77/incident-app
   ```

**Where the split falls.** A git command that does not run as printed is a doc defect. If [#71](https://github.com/mimukit/saasaloy/issues/71) has landed a real lint task by the time you run this, step 5's second checkpoint fails and the runbook needs an update — record that rather than treating it as a pass.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

## Scenario 7 — All CLI work done, global bin still linked

**Setup** — nothing to do. This scenario runs last because it removes the CLI every earlier scenario needed.

- [ ] Setup complete

### TC-7.1 — `pnpm cli:unlink` removes the bin · 🟢 Low

**Goal** — the tutorial's closing command leaves the machine as it found it.

**Steps**

1. Run the command `getting-started.md` prints at the end, from the clone.

   ```sh
   cd ~/qa-77/saasaloy && pnpm cli:unlink
   ```

   - [ ] The command reports the global package removed
2. Confirm the bin is gone.

   ```sh
   command -v saasaloy || echo "removed"
   ```

   - [ ] The shell no longer finds `saasaloy`
3. Remove the scratch root.

   ```sh
   rm -rf ~/qa-77
   ```

**Where the split falls.** A `saasaloy` that survives the unlink means the tutorial leaves the reader's machine dirty.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester. Listed here for context and sign-off._

Every `path:` in `.wikimap.yaml` resolves to a file:

```sh
for p in index.md getting-started.md how-to/add-a-module.md how-to/remove-a-module.md how-to/contribute-a-module.md architecture.md reference.md runbooks/bad-descriptor-on-main.md; do test -f "docs/wiki/$p" && echo "OK $p" || echo "MISSING $p"; done
```

Every relative link and every in-repo anchor across the eight pages and `README.md`:

```sh
python3 scratchpad/linkcheck.py
```

Every page carries the provenance stamp as its last line:

```sh
for f in $(find docs/wiki -name '*.md' | sort); do echo "$f :: $(tail -1 "$f")"; done
```

No forbidden install command and no non-existent command appears anywhere in the set:

```sh
grep -rn -E "npm install saasaloy|npx saasaloy|pnpm add -g saasaloy|saasaloy sync" docs/wiki/
```

`README.md` gained exactly the one section:

```sh
git diff main...HEAD -- README.md
```

- ✅ `.wikimap.yaml` paths → all 8 pages exist on disk; the file lists 8 entries and no more.
- ✅ `.wikimap.yaml` `documents:` globs → all 22 globs match at least one real path (`packages/cli/templates/base/**` → 10, `modules/*/registry-item.json` → 7, `.agents/skills/**` → 2, the rest → 1 each).
- ✅ Link and anchor check → **60 relative links resolved, 0 broken.** This covers the six cross-page anchors, the two `CONTRIBUTING.md` anchors, the four schema links, the eight ADR links in `architecture.md`, and the one ADR link in the runbook.
- ✅ Provenance stamps → all 8 pages end with `` _Verified against `main`@`48d32d7` on 2026-08-09._ ``
- ✅ Forbidden commands → no `npm install saasaloy`, no `npx saasaloy`, no `pnpm add -g saasaloy`, and no `saasaloy sync` (the pre-existing `README.md:28` defect was not copied into the set).
- ✅ `README.md` diff → exactly 2 added content lines, forming one `## Documentation` section before `## License`. Nothing else in the file changed.
- ✅ Script names → `cli:link`, `cli:unlink`, `cli:dev` and `cli` all exist in the root `package.json`, so `getting-started.md`'s install and teardown commands name real scripts.
- ✅ Port claim → `packages/cli/templates/base/apps/web/astro.config.mjs` sets `server: { port: 3000 }` and `vite.server.strictPort: true`, matching `getting-started.md` section 3.
- ✅ `--diff` cap → `packages/cli/src/commands/add.ts:77` sets `MAX_DIFF_LINES = 60`, matching the "capped at 60 lines" claim on `reference.md` and `how-to/add-a-module.md`.
- ✅ `waitlist` descriptor → `dependsOn: ["api", "database"]` and `envVars.PUBLIC_API_URL`, matching `how-to/add-a-module.md`.
- ✅ `email-cloudflare` descriptor → patches `apps/api/wrangler.jsonc` (`kind: wrangler-binding`, `bindingType: send_email`, entry name `EMAIL`) and `packages/email/src/index.ts` (`kind: plugin-array`, `providers`, `call: cloudflare`). Both pages describe these two patches correctly.
- ✅ Node floor → `packages/cli/package.json` declares `"node": ">=24.13.0"` and `.nvmrc` pins `v24.18.0`, matching `getting-started.md`. The root `package.json` still says `>=24.0.0`; the page cites the stricter CLI value on purpose.
- ✅ Template layout → `apps/web`, `packages/ui`, `packages/tsconfig`, `saasaloy.json`, `turbo.json` all exist under `packages/cli/templates/base/`, matching the "What you just got" tree.
- ✅ Build gate → `pnpm exec turbo run test --force` (121 tests, 10 files), `build` and `typecheck` all passed earlier in this session, on this exact tree. **Not re-run here.** The change is Markdown only and touches no build or scaffold path, so a rebuild would produce no new information. `pnpm lint` is a declared no-op — `packages/cli` has no `lint` script, and [#71](https://github.com/mimukit/saasaloy/issues/71) owns adding one.

## Not covered / needs human judgment

- **The tutorial end to end.** No agent has executed `getting-started.md`. Every command in it was checked statically against `packages/cli/src/`, which is not the same as running it. Scenario 2 is the whole point of this plan.
- **The provenance SHA `48d32d7`.** It is this branch's own plan commit. It becomes reachable from `main` only when this pull request merges. The repo merges with merge commits, so it will. TC-1.4 confirms it after the merge, and is expected to be Skipped before.
- **The `email-cloudflare` paid-plan and sending-domain claim.** `reference.md` states that `email-cloudflare` needs a Workers paid plan and a sending domain onboarded by hand. This mirrors `README.md` and is not verifiable from the code. A human with a Cloudflare account is the only way to confirm it. Nothing in this plan sends an email.
- **GitHub rendering.** Checked on disk, not in a browser. Relative paths that climb out of `docs/wiki/` — `../../CONTEXT.md`, `../../../modules/`, `../../../.agents/skills/create-module/SKILL.md` — are the ones GitHub rewrites, so TC-1.1 is a human case by necessity.
- **Nothing in CI gates these docs.** There is no link check and no command check, and that was an accepted decision in the issue. `wikikit audit` on demand is the whole verification story. **Run `wikikit audit` before any release, and again whenever `packages/cli/src/commands/`, `packages/cli/schemas/` or `packages/cli/templates/base/` changes** — those are the paths the `documents:` globs in `.wikimap.yaml` point at, and a change under any of them can stale a page silently.
- **Third-party registries.** `how-to/contribute-a-module.md` and `reference.md` both describe `owner/repo/module` coordinates. Confirming one needs a second GitHub repo with a `modules/` directory. Scenario 5 tests the local-directory path instead, which uses the same loader and the same validation.
- **Accessibility, compatibility and performance dimensions are skipped on purpose.** The change ships no UI and no runtime code. The only rendering surface is GitHub's own Markdown viewer, whose accessibility is not this repo's to test. The landing page in TC-2.2 is the base template, not part of this change.
- **Security and permissions dimension is skipped.** The change adds no code path, reads no credential and grants no access. The one security-adjacent line in the plan is the warning on Scenario 6 not to rehearse a revert against the real `main`.
