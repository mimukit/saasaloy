# QA Plan: linter adoption (oxlint + Prettier + Stylelint, repo and template)

_Generated 2026-08-09 · against `c5f684b` · covers `issue-71-adopt-a-linter-across-the-repo-and-templates` vs `main` (11 commits, issue #71)_

## Summary

- Nothing in this repo had ever been linted. `turbo.json` declared an empty `lint` task and no
  workspace declared a `lint` script, so `pnpm lint` printed "No tasks were executed" and exited 0.
  This branch deletes that silent success and replaces it with a four-pass gate built on
  **Ultracite's oxlint provider** — `oxlint` + `oxlint-tsgolint` for linting, Prettier for
  formatting, Stylelint for CSS — wired into `pnpm lint`, `pnpm lint:fix` and `pnpm format`, with
  husky + lint-staged + commitlint on top.
- The same stack ships **inside the base template**, so every project `saasaloy init` produces gets
  its own `oxlint.config.mjs`, `prettier.config.js`, `stylelint.config.js`, `.prettierignore`,
  `commitlint.config.js`, `lint-staged.config.js`, `_husky/` (copied out as `.husky/`), seven new
  scripts and seventeen exact-pinned devDependencies. `saasaloy init` now runs `git init` so
  husky's `prepare` hook has a work tree to install into.
- "Working" means: a real violation makes `pnpm lint` fail, in this repo **and** in a generated one;
  a generated project's commit hooks reject a non-conventional message on a real `git commit`; the
  type-aware pass covers the two paths with a resolvable `tsconfig.json` and stays off the shipped
  assets that have none; and the formatting sweep over `modules/*/files/**` reads as safe
  **overwrite** churn to an already-scaffolded project, not as **drift** routed to AI-merge.

**Split of work in this document.** The gate itself (`pnpm lint`, `pnpm test`, `pnpm typecheck`,
`pnpm build`, `pnpm deps:verify`) was already run green during implementation and is **not** re-run
here. What the agent did run is the teeth: planted violations against each pass in both repos, the
type-aware split in both directions, the preset-merge hazard, and the full overwrite-vs-drift
re-apply — see [Automated verification](#automated-verification-by-ai-agent). What is left for a
human is everything that needs a real commit, a real install, or a judgement call: the hooks firing
on an actual `git commit`, a fresh scaffold standing on its own, whether the suppression list reads
as justified, and whether the sweep's diff is really formatting-only.

**`saasaloy init`'s git-init guard has its own plan.**
[`qa-init-git-init-2026-08-09.md`](qa-init-git-init-2026-08-09.md) covers all eight of its shapes
and records five as already run. Scenario 4 below picks up only what that document left open. Do not
re-run its Scenarios 1, 3, 4, 5 or 7.

## Run log

| Field | Value |
|---|---|
| Tester | |
| Date run | |
| Build / commit | |

**Overall**

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan — do this once, before Scenario 1.

- Branch under test: `issue-71-adopt-a-linter-across-the-repo-and-templates`, at `c5f684b`.
- Node 24+ and pnpm 11, per the repo's toolchain. Everything below runs from the worktree root
  unless a case says otherwise.
- The repo's dependencies must be installed — the linter is fourteen new packages:

  ```sh
  pnpm install
  ```

- Confirm the three that matter resolved to the pinned versions (`1.77.0`, `7.10.1`, `7.0.2001`):

  ```sh
  pnpm ls oxlint ultracite oxlint-tsgolint --depth 0
  ```

- Export the built CLI once; several cases invoke it directly:

  ```sh
  export SAASALOY="$PWD/packages/cli/dist/index.js"
  ```

- **Start from a clean working tree.** Half the cases plant a violation into a real file and revert
  it. `git status --porcelain` should be empty (or show only this QA document) before you start, and
  again when you finish.

**Two things are red on this branch and on `main`, for unrelated reasons. Do not chase them.**

- `pnpm verify:preset` — Lightning CSS re-serialises `oklch(0.6231 0.1880 259.8145)` as
  `oklch(62.31% .188 259.815)` and `verify-preset.ts`'s `normalize()` does not flatten that.
- `pnpm deps:check` — 11 outdated dependencies, none of them the ones this branch adds.

Both were confirmed to fail identically on `main`.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — this repo, installed, clean tree | Each of the four passes fails on a planted violation | 🔴 Critical |
| TC-1.2 | 1 — this repo, installed, clean tree | `lint:fix` and `format` repair what TC-1.1 planted | 🟡 Normal |
| TC-1.3 | 1 — this repo, installed, clean tree | A real commit through husky, lint-staged and commitlint | 🔴 Critical |
| TC-1.4 | 1 — this repo, installed, clean tree | The type-aware path split, and the guard rails around it | 🟡 Normal |
| TC-1.5 | 1 — this repo, installed, clean tree | The suppression list reads as justified, not as surrender | 🟡 Normal |
| TC-1.6 | 1 — this repo, installed, clean tree | The sweep over `modules/*/files/**` is formatting, not behaviour | 🟡 Normal |
| TC-2.1 | 2 — a fresh `saasaloy init` project, installed | The scaffold carries the whole toolchain and is green on arrival | 🔴 Critical |
| TC-2.2 | 2 — a fresh `saasaloy init` project, installed | The generated project's gate has teeth, and `lint:fix` repairs it | 🔴 Critical |
| TC-2.3 | 2 — a fresh `saasaloy init` project, installed | A bad commit message is rejected; a conventional one lands | 🔴 Critical |
| TC-2.4 | 2 — a fresh `saasaloy init` project, installed | `saasaloy add` leaves the project's `pnpm lint` green | 🟡 Normal |
| TC-2.5 | 2 — a fresh `saasaloy init` project, installed | `AGENTS.md` describes the project you actually got | 🟡 Normal |
| TC-2.6 | 2 — a fresh `saasaloy init` project, installed | `pnpm build` and `pnpm typecheck` survived the sweep | 🟢 Low |
| TC-3.1 | 3 — a project scaffolded before this branch | The re-apply reads as overwrite, and the diff is formatting only | 🔴 Critical |
| TC-3.2 | 3 — a project scaffolded before this branch | A hand-edited file still routes to drift → merge | 🟡 Normal |
| TC-4.1 | 4 — `init` shapes the git-init plan left open | `saasaloy init .` in an empty directory | 🟡 Normal |
| TC-4.2 | 4 — `init` shapes the git-init plan left open | Windows | 🟢 Low |

---

## Scenario 1 — this repo, installed, clean working tree

The tool repo's own gate. Every case here plants something into a real file and reverts it, so keep
`git status` in view.

**Setup** — once, for every case in this scenario.

```sh
git status --porcelain
```

- [ ] Setup complete — the tree is clean (or shows only this QA document)

### TC-1.1 — Each of the four passes fails on a planted violation · 🔴 Critical

**Goal** — `pnpm lint` is a gate, not a formality: a real violation of each pass makes it exit
non-zero, and the passes run in the documented order.

**Steps**

1. Plant a type-aware-only violation — a floating promise in a maintainer script:

   ```sh
   printf 'async function w(): Promise<void> {\n  await Promise.resolve();\n}\n\nexport function go(): void {\n  w();\n}\n' > scripts/__qa-scratch.ts
   ```

2. Plant a plain-pass violation in the CLI's source:

   ```sh
   printf 'export function scratch() {\n  return new Array(3);\n}\n' > packages/cli/src/__qa-scratch.ts
   ```

3. Plant a CSS violation and a formatting-only violation:

   ```sh
   printf '.qa { COLOR: #FFFFFF }\n' > __qa-scratch.css && printf '{"a":   1}\n' > __qa-scratch.json
   ```

4. Run the whole gate:

   ```sh
   pnpm lint
   ```

   - [ ] It **fails**, and it fails at `lint:types` — the *first* pass, not somewhere later
     - the reported rule is `typescript(no-floating-promises)`, pointing at `scripts/__qa-scratch.ts`
     - the exit code is non-zero; check with `echo $?` if your shell does not show it
   - [ ] The failure is legible without knowing the config — file, line, rule name and a `help:` line

5. Run each pass on its own so nothing hides behind the short-circuit:

   ```sh
   pnpm run lint:types ; echo "types=$?" ; pnpm run lint:code ; echo "code=$?" ; pnpm run lint:css ; echo "css=$?" ; pnpm run format:check ; echo "format=$?"
   ```

   - [ ] All four report non-zero, each naming its own planted file
     - `lint:types` → `no-floating-promises` in `scripts/__qa-scratch.ts`
     - `lint:code` → `unicorn(no-new-array)` in `packages/cli/src/__qa-scratch.ts`
     - `lint:css` → `color-hex-length` in `__qa-scratch.css`
     - `format:check` → `[warn] __qa-scratch.json`
   - [ ] `lint:code` **also** reports the floating-promise file's other problems if any, but does
     **not** report `no-floating-promises` — that rule needs types and only pass 1 has them

6. Leave the planted files in place for TC-1.2.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — `lint:fix` and `format` repair what TC-1.1 planted · 🟡 Normal

**Goal** — the fix path mirrors the reporting path, including its type-aware half (the last commit
on this branch exists to make that true), and it never reaches for `--fix-suggestions`.

**Steps**

1. With TC-1.1's four files still planted, run the fixers:

   ```sh
   pnpm run lint:fix && pnpm run format
   ```

   - [ ] `lint:fix` runs **two** oxlint invocations, the first with `--type-aware` over
     `packages/cli/src scripts`, then the plain one, then Stylelint
   - [ ] `__qa-scratch.css` is rewritten to `#fff` and `__qa-scratch.json` is reflowed

2. Re-run the gate:

   ```sh
   pnpm lint
   ```

   - [ ] It still fails — the two oxlint findings are **not** auto-fixable, and that is correct.
     A gate that quietly rewrote a floating promise or a `new Array(n)` would be worse than one
     that stops.

3. Confirm the dangerous flag is absent:

   ```sh
   grep -n "fix-suggestions" package.json packages/cli/templates/base/package.json ; echo "matches=$?"
   ```

   - [ ] No match in either file (`grep` exits 1). On this repo `--fix-suggestions` rewrites
     `a[i++]` to `a[i += 1]` in `packages/cli/src/lib/diff.ts` — a different program that the whole
     test suite still passes.

4. Remove every planted file and confirm the tree is clean again:

   ```sh
   rm -f scripts/__qa-scratch.ts packages/cli/src/__qa-scratch.ts __qa-scratch.css __qa-scratch.json && git status --porcelain
   ```

   - [ ] `git status` is clean again, and `pnpm lint` is green

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — A real commit through husky, lint-staged and commitlint · 🔴 Critical

**Goal** — the hooks are installed and actually fire on a real `git commit` in this repo, not just
when commitlint is invoked by hand.

> The eleven commits already on this branch do not prove this: they may have been made before
> `pnpm install` ran `prepare`, or with the hook path not yet set. Check it for yourself.

**Steps**

1. Confirm husky claimed the hook path:

   ```sh
   git config core.hooksPath
   ```

   - [ ] Prints `.husky/_`, and `ls .husky` shows the committed `pre-commit` and `commit-msg`
     (mode 0644 is fine — husky's shims run them through `sh`)

2. Stage a deliberately unformatted file:

   ```sh
   printf 'export  const   qa=1\n' > __qa-hook.ts && git add __qa-hook.ts
   ```

3. Try a non-conventional commit message:

   ```sh
   git commit -m "just some words"
   ```

   - [ ] lint-staged runs first and reports its tasks over the staged file
   - [ ] commitlint then **rejects** the message with `type may not be empty` / `subject may not be
     empty`, and no commit is created (`git log -1` still shows `c5f684b` or later work, not this)

4. Retry with a conventional message:

   ```sh
   git commit -m "chore(qa): scratch commit"
   ```

   - [ ] The commit succeeds
   - [ ] `git show --stat HEAD` shows `__qa-hook.ts` **reformatted by lint-staged** — the recorded
     content is `export const qa = 1;`, not what you typed. This is the half most likely to be
     broken silently: lint-staged must re-stage what it rewrote.

5. Confirm the documented bypass works:

   ```sh
   git reset --hard HEAD~1 && printf 'export  const   qa=1\n' > __qa-hook.ts && git add __qa-hook.ts && git commit --no-verify -m "just some words"
   ```

   - [ ] It succeeds, unformatted, with no commitlint complaint

6. Clean up — **`git reset --hard` here throws away the scratch commit only; make sure the QA
   document is not staged**:

   ```sh
   git reset --hard HEAD~1 && rm -f __qa-hook.ts && git status --porcelain
   ```

   - [ ] The branch is back at the commit you started from and the tree is clean

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — The type-aware path split, and the guard rails around it · 🟡 Normal

**Goal** — the split exists because `--type-aware` is a global CLI switch: it is scoped by path
arguments, and pointing it anywhere else fails in a way no config can suppress. Confirm someone who
tries will be told why.

**Steps**

1. Point the type-aware pass at shipped template assets, the thing the split exists to avoid:

   ```sh
   ./node_modules/.bin/oxlint -c oxlint.config.mjs --type-aware packages/cli/templates/base/packages/ui/src
   ```

   - [ ] It reports `typescript(tsconfig-error): Invalid tsconfig … File '@repo/tsconfig/base.json'
     not found.` — `@repo/tsconfig` is a `workspace:*` reference that resolves only after the
     project is scaffolded and installed

2. Read the three places a person would land after seeing that error:

   - `oxlint.config.mjs` — the `--- Astro ---` override block's `KEEP .astro OUT OF THE TYPE-AWARE
     PASS` comment
   - `CONTRIBUTING.md` — the "Linting and formatting" pass table
   - `docs/adr/adr-0025-the-linter-runs-on-the-compiler-we-ship-2026-08-09.md` — the
     `tsconfig`-discovery consequence

   - [ ] The reason is stated where you would look for it, and the three agree with each other
   - [ ] None of them suggests "just widen `lint:types`" as a fix

3. Confirm the `scripts/tsconfig.json` shim is understood as load-bearing, not as clutter someone
   will tidy away:

   ```sh
   cat scripts/tsconfig.json
   ```

   - [ ] It is a one-line `extends` of `tsconfig.scripts.json` and carries a comment (or an ADR
     reference) explaining that oxlint discovers a tsconfig **only by that literal filename**

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.5 — The suppression list reads as justified, not as surrender · 🟡 Normal

**Goal** — a linter adopted by switching off everything it complained about is worth nothing. Read
the `suppressed` block and judge whether each group is a convention disagreement or a swept-under
defect.

**Steps**

1. Read the `suppressed` object in `oxlint.config.mjs` end to end, and the parallel block in
   `packages/cli/templates/base/oxlint.config.mjs`.

   - [ ] Every entry sits under a named group with a reason, and no group's reason is "it fired a
     lot"
     - declaration shape (`func-style`, `no-use-before-define`) — hoisted functions, helpers below
       callers
     - the regex family — `u` flag and named groups change semantics across ~70 patch-engine sites
     - typescript-eslint's strict-type-checked tier — the `JSON.parse` and ts-morph boundaries
     - thresholds and style (`complexity`, `no-nested-ternary`, `prefer-destructuring`)
   - [ ] Nothing in the block is one of ESLint's **Possible Problems** rules

2. Check the two rules the branch deliberately kept *out* of the block:

   ```sh
   grep -rn "oxlint-disable-next-line no-control-regex" packages/cli/src scripts
   ```

   - [ ] `no-control-regex` is suppressed at its two call sites with a reason on the line above,
     not globally — and `typescript/return-await` is retuned to `in-try-catch` rather than dropped

3. Read the "Adding a justified suppression" section of `CONTRIBUTING.md`.

   - [ ] It tells a contributor to fix the code first, and shows the `oxlint-disable-next-line`
     form with the reason **above** the directive, not between it and the code

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.6 — The sweep over `modules/*/files/**` is formatting, not behaviour · 🟡 Normal

**Goal** — commit `18a7d5e` reformatted the assets every generated project receives, and `4b36e0f`
made real fixes in `modules/api` and `modules/auth`. Nothing else in that range should have changed
what the code *does*.

**Steps**

1. Read the two commits that touched shipped module files:

   ```sh
   git show 18a7d5e --stat && git show 4b36e0f
   ```

   - [ ] `4b36e0f`'s changes are the ones you would expect a linter to force, and each is a genuine
     improvement rather than a shape change to satisfy a rule
   - [ ] Nothing in `4b36e0f` changes a public export name, a route path, or a Worker binding

2. Read the largest single file in the sweep — the email module's renderer, 188 changed lines:

   ```sh
   git diff main...HEAD -- modules/email/files/src/render.ts
   ```

   - [ ] It is reflow, quoting and ordering only — no changed regex, no changed escaping, no changed
     branch. This file does HTML escaping; a "formatting" change here that altered a pattern would
     be an injection bug.

3. Skim the descriptor changes, which are what the applier reads:

   ```sh
   git diff main...HEAD -- "modules/*/registry-item.json"
   ```

   - [ ] Only formatting and field ordering; no `files[].path`, `dependsOn` or `patches` entry moved,
     appeared or vanished

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — before moving to Scenario 2, confirm you left nothing behind.

```sh
git status --porcelain
```

---

## Scenario 2 — a fresh `saasaloy init` project, installed

This is what ships to users, and it is the half no automated gate in this repo covers end to end
except through `pnpm deps:verify`. Do it outside the repo so nothing inherits from it.

**Setup** — once, for every case in this scenario. The install is the slow part (a few minutes on a
cold store); everything after it is fast.

```sh
cd "$(mktemp -d)" && node "$SAASALOY" init my-app --no-install && cd my-app && pnpm install
```

- [ ] Setup complete

> If you would rather not pay for a second install, `.dev/playground` in the worktree is already
> scaffolded and installed with `api`, `email` and `waitlist` applied — good enough for TC-2.2 and
> TC-2.4, not for TC-2.1's "on arrival" claim. It is gitignored scratch; do not run `play:destroy`
> unless you want to rebuild it.

### TC-2.1 — The scaffold carries the whole toolchain and is green on arrival · 🔴 Critical

**Goal** — a user who runs `saasaloy init` and `pnpm install` has a working, passing linter without
doing anything else.

**Steps**

1. Look at what landed:

   ```sh
   ls -a && ls -a .husky
   ```

   - [ ] All seven config files are present at the root
     - `oxlint.config.mjs`, `prettier.config.js`, `stylelint.config.js`, `.prettierignore`
     - `commitlint.config.js`, `lint-staged.config.js`
     - `.gitignore` (from the template's `_gitignore`)
   - [ ] `.husky/` exists with `pre-commit` and `commit-msg` — the template's `_husky/` was renamed
     on copy — plus the generated `_/` directory of shims from `prepare: "husky"`
   - [ ] `.git` exists and `git rev-parse --show-toplevel` prints *this* directory

2. Check the scripts and the pinned devDependencies:

   ```sh
   node -e "const p=require('./package.json');console.log(Object.keys(p.scripts).join(' '));console.log(Object.keys(p.devDependencies).length+' devDeps')"
   ```

   - [ ] `prepare lint lint:types lint:code lint:css lint:fix format format:check` are all there,
     alongside the pre-existing `build clean dev typecheck`
   - [ ] 17 devDependencies, every version exact-pinned (no `^`, no `~`)
   - [ ] `{{PROJECT_NAME}}` is gone — `name` is `my-app`

3. Run the gate the template ships:

   ```sh
   pnpm lint
   ```

   - [ ] All four passes are **green** on a completely untouched scaffold. A template that ships a
     red linter is the single worst outcome of this change.

4. Confirm nothing user-hostile is being linted:

   ```sh
   cat .prettierignore
   ```

   - [ ] `saasaloy.json`, `saasaloy-lock.json`, `.saasaloy/` and `**/wrangler.jsonc` are excluded —
     these are written by the CLI, and Prettier disagreeing with the writer would leave `pnpm lint`
     red after every `saasaloy add`
   - [ ] `**/*.md` is excluded, so `AGENTS.md` and `CLAUDE.md` keep their hand-wrapped paragraphs

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — The generated project's gate has teeth, and `lint:fix` repairs it · 🔴 Critical

**Goal** — the same proof as TC-1.1, but for the config the user actually gets, which is a different
file with a different suppression list and a different type-aware scope (`packages/ui/src`).

**Steps**

1. Plant one violation for each pass:

   ```sh
   printf 'async function w(): Promise<void> {\n  await Promise.resolve();\n}\n\nexport function go(): void {\n  w();\n}\n' > packages/ui/src/__qa-types.ts && printf 'export function scratch() {\n  return new Array(3);\n}\n' > packages/ui/src/__qa-code.ts && printf '.qa { COLOR: #FFFFFF }\n' > __qa.css && printf '{"a":   1}\n' > __qa.json
   ```

2. Run the gate:

   ```sh
   pnpm lint
   ```

   - [ ] It fails at `lint:types` with `no-floating-promises` — the type-aware pass reaches
     `packages/ui/src` in a generated project, which is the whole reason `git init` moved into the
     CLI and `@repo/tsconfig` resolves after install

3. Run the remaining passes individually:

   ```sh
   pnpm run lint:code ; echo "code=$?" ; pnpm run lint:css ; echo "css=$?" ; pnpm run format:check ; echo "format=$?"
   ```

   - [ ] Each is non-zero and names its own planted file

4. Plant a `console.log` in a place a user would actually leak one, and confirm the shipped
   `no-console: "error"` catches it:

   ```sh
   printf 'export function leak(): void {\n  console.log("oops");\n}\n' > packages/ui/src/__qa-console.ts && pnpm run lint:code
   ```

   - [ ] `eslint(no-console)` fires. Ultracite's own preset ships this rule **off**; the template
     turns it back on because a stray `console.log` in a deployed Worker or a client bundle is a
     leak.

5. Fix and clean up:

   ```sh
   pnpm run lint:fix ; pnpm run format ; rm -f packages/ui/src/__qa-*.ts __qa.css __qa.json && pnpm lint
   ```

   - [ ] `lint:fix` repaired the CSS and `format` repaired the JSON, and once the planted files are
     gone `pnpm lint` is green again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — A bad commit message is rejected; a conventional one lands · 🔴 Critical

**Goal** — the generated project's hooks work on a real commit in a repository the CLI created. This
is the end-to-end claim behind `saasaloy init` running `git init`.

**Steps**

1. Confirm husky installed into the CLI-created repository:

   ```sh
   git config core.hooksPath && ls .husky/_ | head -3
   ```

   - [ ] Prints `.husky/_` and the shim directory exists. If this is empty, `prepare: "husky"` found
     no work tree — which is exactly the failure `saasaloy init`'s `git init` exists to prevent.

2. Stage the whole scaffold and try a bad message:

   ```sh
   git add -A && git commit -m "initial stuff"
   ```

   - [ ] lint-staged runs over the staged files first, and reports its tasks
   - [ ] commitlint **rejects** the message, and `git log` is still empty — no commit was created
   - [ ] The rejection names the rule (`type may not be empty`), so a user can act on it without
     reading the config

3. Retry conventionally:

   ```sh
   git commit -m "chore: initial scaffold"
   ```

   - [ ] The commit succeeds and is the repository's first commit
   - [ ] `git show --stat HEAD` lists the whole scaffold, and nothing gitignored (no `node_modules`,
     no `dist`, no `.turbo`)

4. Confirm the emergency exit:

   ```sh
   printf 'export  const   qa=1\n' > packages/ui/src/qa.ts && git add -A && git commit --no-verify -m "nope"
   ```

   - [ ] It succeeds. The bypass is documented in the template's `AGENTS.md`; it must actually work,
     or a user with a broken hook has no way out.

5. Undo the scratch commit:

   ```sh
   git reset --hard HEAD~1 && rm -f packages/ui/src/qa.ts
   ```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.4 — `saasaloy add` leaves the project's `pnpm lint` green · 🟡 Normal

**Goal** — module files are linted in *this* repo against *this* repo's config; they land in a user's
project and are linted against the **template's** config, which has a different suppression list.
The two must agree, or every `saasaloy add` hands the user a red gate.

**Steps**

1. Add the module with the widest surface — `waitlist` pulls in `api` and `database`, and ships a
   `.tsx` component, an `.astro` section, a route and a schema:

   ```sh
   SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add waitlist --yes
   ```

   - [ ] Four modules apply (`api`, `database`, `waitlist`, and the skills), all as `create`

2. Install the new workspaces and run the gate:

   ```sh
   pnpm install && pnpm lint
   ```

   - [ ] `pnpm lint` is **green** across all four passes with three modules applied
   - [ ] In particular `lint:code` accepts `packages/waitlist`'s `.astro` section and `.tsx`
     component, and `format:check` accepts the `wrangler.jsonc` the applier patched — the
     `.prettierignore` entry for it is what makes that true

3. Add the console-backed email provider, the one file where `console` output *is* the
   implementation:

   ```sh
   SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add email-console --yes && pnpm install && pnpm run lint:code
   ```

   - [ ] Green. The template's config exempts `packages/*/src/providers/console.ts` by path; if this
     is red, the exemption glob and where the applier actually writes the file have diverged.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.5 — `AGENTS.md` describes the project you actually got · 🟡 Normal

**Goal** — the template's `AGENTS.md` is read by every coding agent pointed at a generated project.
Before this branch it described an ESLint setup with a `@repo/eslint-config` package that never
existed here. Every command it now names must run.

**Steps**

1. Read the new "Linting, Formatting, and Commit Hooks" section of `AGENTS.md` in the scaffold.

   - [ ] Every command it names exists in `package.json` and runs — `lint`, `lint:types`,
     `lint:code`, `lint:css`, `lint:fix`, `format`, `format:check`, `typecheck`
   - [ ] The four-pass order it lists matches what `pnpm lint` actually did in TC-2.2

2. Search for the claims the branch was supposed to delete:

   ```sh
   grep -rn "eslint\|ESLint\|Prettier or ESLint" AGENTS.md CLAUDE.md
   ```

   - [ ] No `@repo/eslint-config`, and no instruction to edit an ESLint config. The only surviving
     mentions, if any, are historical prose that reads correctly.

3. Read the "⚠️ Ask First" and "❌ Never" lists.

   - [ ] They name the real files (`oxlint.config.mjs`, `prettier.config.js`,
     `stylelint.config.js`, `lint-staged.config.js`, `commitlint.config.js`, `.husky/`) and the
     guidance reads as something you would actually want an agent to follow

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.6 — `pnpm build` and `pnpm typecheck` survived the sweep · 🟢 Low

**Goal** — the template's `turbo.json` gained no `lint` task (linting is a root script by decision),
and the reformatted `.tsx`/`.astro`/CSS still builds.

**Steps**

1. Build and typecheck the scaffold:

   ```sh
   pnpm build && pnpm typecheck
   ```

   - [ ] Both green. `pnpm deps:verify` already covers this in CI terms; what you are confirming is
     that it holds for a scaffold that also had modules added in TC-2.4.

2. Look at the built stylesheet:

   ```sh
   ls -la apps/web/dist/_astro/*.css
   ```

   - [ ] It is in the tens of kilobytes, not hundreds. A stylesheet ~5x too large means Tailwind's
     scanner walked `node_modules` — the symptom of a missing `.git`, which `saasaloy init` now
     creates.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — delete the scratch directory when you are done with Scenario 2.

```sh
cd .. && rm -rf my-app
```

---

## Scenario 3 — a project scaffolded *before* this branch

The formatting sweep changed the bytes of every file in `modules/*/files/**`, and therefore the
hashes recorded in an existing project's `.saasaloy/manifest.json`. The question a human has to
settle is whether the resulting diff is churn a user can accept in one go.

**Setup** — build a project from `main`'s module files, then re-apply from this branch's. No install
is needed; `saasaloy add` never runs one.

```sh
cd "$(mktemp -d)" && mkdir oldmods && git -C <path-to-worktree> archive main modules | tar -x -C oldmods
```

```sh
node "$SAASALOY" init proj --no-install && cd proj && SAASALOY_REGISTRY_DIR=../oldmods/modules node "$SAASALOY" add api --yes
```

- [ ] Setup complete — `api` applied as 7 × `create`, from `main`'s (pre-sweep) files

### TC-3.1 — The re-apply reads as overwrite, and the diff is formatting only · 🔴 Critical

**Goal** — ADR 0023 promises a churnier diff that "classifies as a safe **overwrite**, not
**drift**, so nothing routes to AI-merge". Confirm that, and then judge the diff it produces.

**Steps**

1. Re-apply the same module from this branch's `modules/`, and read the **plan** before confirming:

   ```sh
   SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add api --diff --force
   ```

   - [ ] Every changed file is labelled `overwrite` (cyan), none `drift → merge` (yellow), and the
     summary line reads `… 0 needing merge`
   - [ ] Files the sweep did not touch are labelled `unchanged` and are not rewritten

2. Read the diff the `--diff` flag printed, file by file.

   - [ ] It is quoting, indentation, trailing commas and line wrapping — nothing that changes what
     the Worker does
     - `apps/api/src/index.ts` — the route wiring and exports are the same
     - `apps/api/wrangler.jsonc` — bindings, `compatibility_date` and names unchanged
     - `apps/api/vite.config.ts` — plugin list and options unchanged
   - [ ] You would be comfortable telling a user to accept this in one commit

3. Apply it and confirm the manifest caught up:

   ```sh
   SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add api --yes --force && SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add api --yes --force
   ```

   - [ ] The **second** run reports every file `unchanged` — the manifest recorded the new hashes,
     so the churn is a one-time event and not a diff that reappears on every apply

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — A hand-edited file still routes to drift → merge · 🟡 Normal

**Goal** — the sweep must not have blunted the guard. A file the user edited themselves still has to
be held back, not clobbered.

**Steps**

1. Hand-edit an applied file and re-apply:

   ```sh
   printf '\n// my own change\n' >> apps/api/src/index.ts && SAASALOY_REGISTRY_DIR=<path-to-worktree>/modules node "$SAASALOY" add api --yes --force
   ```

   - [ ] `apps/api/src/index.ts` is labelled `drift → merge` and lands in a **Needs merge** panel
   - [ ] The file on disk still contains your comment — it was left untouched, not overwritten
   - [ ] The message points at `--diff` as the way to hand it to an agent

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset**

```sh
cd ../.. && rm -rf "$OLDPWD"
```

---

## Scenario 4 — `saasaloy init` shapes the git-init plan left open

[`qa-init-git-init-2026-08-09.md`](qa-init-git-init-2026-08-09.md) is the plan for this behaviour and
records Scenarios 1, 3, 4, 5 and 7 as already run and passing — bare target, target inside an
existing repo, target that already has `.git`, `git` absent from `PATH`, and the gitignored
`.dev/playground`. Only these two are still open. **Do not re-run the other five.**

### TC-4.1 — `saasaloy init .` in an empty directory · 🟡 Normal

**Goal** — the current-directory argument form takes the same path as a named target. It is
Scenario 2 of the git-init plan, which was skipped as "Scenario 1 with a different argument".

**Steps**

1. Run it:

   ```sh
   cd "$(mktemp -d)" && mkdir my-app && cd my-app && node "$SAASALOY" init . --no-install
   ```

   - [ ] `Initialised a git repository (git init).` appears, after the "Scaffolded" line
   - [ ] `git rev-parse --show-toplevel` prints this directory
   - [ ] The project name resolved from the directory basename — `package.json`'s `name` is `my-app`
   - [ ] "Next steps" omits the `cd` line (correct for `.`) but still shows `pnpm install`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — Windows · 🟢 Low

**Goal** — `runGitInit` passes `shell: process.platform === "win32"` for consistency with
`runPnpmInstall`, and that branch has never been exercised. Needs a real Windows machine.

**Steps**

1. On Windows with git, Node 24+ and pnpm 11, in an empty directory outside any repository:

   ```sh
   node <path>\packages\cli\dist\index.js init my-app --no-install
   ```

   - [ ] `Initialised a git repository (git init).` prints and `my-app\.git` exists
   - [ ] No console window flashes, and no `'git' is not recognized` leaks as an unhandled rejection

2. Repeat the nested case from inside that new repository.

   - [ ] The guard skips, and the message renders without mangled escaping

3. Install and commit, to exercise husky's shims on Windows:

   ```sh
   pnpm install
   ```

   - [ ] `git config core.hooksPath` prints `.husky/_`, and a non-conventional `git commit` is
     rejected by commitlint

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

---

## Automated verification (by AI agent)

Run 2026-08-09 against `c5f684b`, using the already-built CLI at `packages/cli/dist/index.js` and
the already-installed `.dev/playground`. Every planted file was removed afterwards and
`git status --porcelain` was empty at the end.

**The gate itself was not re-run.** `pnpm lint`, `pnpm test --force` (10 files / 122 tests),
`pnpm typecheck --force`, `pnpm build --force` and `pnpm deps:verify` all passed during
implementation on this same tree; re-running them costs a lot and answers nothing new.

### This repo's gate has teeth

```sh
printf 'export function scratch() {\n  return new Array(3);\n}\n' > packages/cli/src/__qa-scratch.ts && ./node_modules/.bin/oxlint -c oxlint.config.mjs --deny-warnings packages/cli/src/__qa-scratch.ts
```

- ✅ `unicorn(no-new-array)` reported at `2:10`, **exit 1**. This is the exact assertion
  `oxlint.config.mjs` names as the check that `mergePresets` did not silently drop core's plugins.

```sh
printf 'export function leak(): void {\n  console.log("oops");\n}\n' > modules/api/files/src/__qa-scratch.ts && ./node_modules/.bin/oxlint -c oxlint.config.mjs --deny-warnings modules/api/files/src/__qa-scratch.ts
```

- ✅ `eslint(no-console)` reported, exit 1 — shipped module assets are linted, and `no-console` is on
  for them. The same file placed under `modules/email-console/files/` exits **0**, so the exemption
  override is scoped, not global.

### The type-aware split, in both directions

```sh
printf 'async function work(): Promise<void> {\n  await Promise.resolve();\n}\n\nexport function go(): void {\n  work();\n}\n' > scripts/__qa-scratch.ts && ./node_modules/.bin/oxlint -c oxlint.config.mjs --type-aware --deny-warnings scripts/__qa-scratch.ts
```

- ✅ `typescript(no-floating-promises)`, exit 1. The **same file** through the plain pass
  (`oxlint -c oxlint.config.mjs --deny-warnings scripts/__qa-scratch.ts`) exits **0** — pass 1 is
  buying real coverage, not duplicating pass 2.

```sh
./node_modules/.bin/oxlint -c oxlint.config.mjs --type-aware packages/cli/templates/base/packages/ui/src
```

- ✅ `typescript(tsconfig-error): Invalid tsconfig … File '@repo/tsconfig/base.json' not found.` —
  confirming why `lint:types` is scoped by path argument. No override can suppress this.

```sh
mv scripts/tsconfig.json /tmp/qa-scripts-tsconfig.json && ./node_modules/.bin/oxlint -c oxlint.config.mjs --type-aware --deny-warnings scripts ; mv /tmp/qa-scripts-tsconfig.json scripts/tsconfig.json
```

- ✅ With the one-line shim removed, `scripts/update-deps.ts` immediately reports
  `typescript(no-unsafe-argument): Unsafe argument of type error typed …` at four sites and more
  beyond — the phantom-findings failure ADR 0025 describes. Restored; `git status` clean.

### The preset-merge hazard is real

```sh
node -e "Promise.all([import('ultracite/oxlint/core'),import('ultracite/oxlint/astro'),import('ultracite/oxlint/react'),import('ultracite/oxlint/tanstack'),import('ultracite/oxlint/vitest')]).then(([c,a,r,t,v])=>{const s={...c.default,...a.default,...r.default,...t.default,...v.default};console.log('spread plugins',s.plugins,'rules',Object.keys(s.rules).length)})"
```

- ✅ Object spread yields `["react","react-perf","jsx-a11y"]` and **103** rules; `mergePresets`
  yields 11 plugins and **523 enabled** rules. The comment in `oxlint.config.mjs` warning against
  the spread is accurate and load-bearing.

### The generated project's gate has teeth

Run inside `.dev/playground`, which `pnpm deps:verify` already installed.

```sh
printf 'export function scratch() {\n  return new Array(3);\n}\n' > packages/ui/src/__qa-scratch.ts && ./node_modules/.bin/oxlint -c oxlint.config.mjs --deny-warnings packages/ui/src/__qa-scratch.ts
```

- ✅ `unicorn(no-new-array)`, exit 1.
- ✅ The floating-promise file through `--type-aware` over `packages/ui/src` → exit 1. The template's
  type-aware scope works in a scaffolded, installed project.
- ✅ `prettier --check` on `export  const   x=1` → `[warn]`, exit 1.
- ✅ `stylelint --max-warnings 0` on `.a { COLOR: #FFFFFF }` → `color-hex-length`, exit 2.
- All four scratch files removed; the playground is unchanged.

### A fresh scaffold carries the toolchain

```sh
node packages/cli/dist/index.js init proj --no-install
```

- ✅ Produced `.git`, `.husky/{pre-commit,commit-msg}`, `.prettierignore`, `oxlint.config.mjs`,
  `prettier.config.js`, `stylelint.config.js`, `commitlint.config.js`, `lint-staged.config.js`,
  `.gitignore`, and a `package.json` with `prepare lint lint:types lint:code lint:css lint:fix
  format format:check` plus 17 exact-pinned devDependencies. `name` resolved to `proj`.

### Overwrite, not drift — the whole of Scenario 3, already exercised

```sh
git archive main modules | tar -x -C /tmp/oldmods && SAASALOY_REGISTRY_DIR=/tmp/oldmods/modules node packages/cli/dist/index.js add api --yes
```

```sh
SAASALOY_REGISTRY_DIR=<worktree>/modules node packages/cli/dist/index.js add api --yes --force
```

- ✅ Re-applying this branch's `api` over a project built from `main`'s module files reported
  **3 `overwrite`** (`wrangler.jsonc`, `vite.config.ts`, `src/index.ts`), **4 `unchanged`**, and
  `7 file(s) to apply, **0 needing merge**`. ADR 0023's claim holds exactly.
- ✅ Appending a hand-edit to `apps/api/src/index.ts` and re-applying then reported
  `drift → merge` for that one file, `6 file(s) to apply, 1 needing merge`, and the file was left
  untouched on disk. The guard is intact.

### Hook installation in this worktree

```sh
git config --show-origin core.hooksPath
```

- ✅ `.husky/_`, written to `file:/home/dev/projects/saasaloy/.git/config`. `.husky/_/` exists with
  husky's shims, so a real `git commit` here will run them (TC-1.3). Note this is the **shared**
  git config, not a per-worktree one — see [Notes](#notes).
- ⬜ A real `git commit` through the hooks was **not** run: this branch is deliberately left with an
  uncommitted QA document, and the commit step belongs to the PR stage. TC-1.3 and TC-2.3 are the
  human's.

### Not run

- ⬜ Anything needing a second `pnpm install` (TC-2.1's "green on arrival", TC-2.4's post-`add`
  lint, TC-2.6's build) — the existing `.dev/playground` covers the same ground and re-installing a
  second scaffold was not worth the minutes.
- ⬜ Windows (TC-4.2) — no Windows machine available.

## Not covered / needs human judgment

- **Whether the suppression list is honest.** 36 rules are switched off by hand in this repo's
  `suppressed` block (114 are off in the composed config once Ultracite's own defaults are counted).
  The agent can confirm none of the 36 is a Possible Problems rule; it cannot judge whether "this is
  a convention disagreement" is true of each group. TC-1.5.
- **Whether the sweep changed behaviour.** 6,375 insertions across 121 files, most of it
  reformatting. Only a reader can tell a reflowed regex from a rewritten one. TC-1.6.
- **`--deny-warnings` could not be demonstrated as load-bearing.** All 523 enabled rules in the
  composed config resolve to `"error"`, and oxlint exits 1 on those with or without the flag; an
  unused `oxlint-disable-next-line` directive also produced no warning. The flag is correct defensive
  practice and matches Stylelint's `--max-warnings 0`, but ADR 0023's claim that "Ultracite sets most
  rules to warn" does not hold for `ultracite@7.10.1`'s oxlint presets. Nothing to test; recorded so
  nobody reads its absence as a gap.
- **CI.** #46's CI criterion is still open — no workflow runs `pnpm lint` yet, so the gate is
  currently enforced by the pre-commit hook and by whoever runs it. Out of scope for this branch.
- **Performance.** `pnpm lint` timing under a cold cache and on a large generated project was not
  measured. oxlint is fast enough that this has not been a question, but nobody has checked.
- **Accessibility, compatibility, concurrency, security.** Not applicable — this branch adds no UI,
  no endpoint and no runtime code path. The one security-adjacent surface is the email module's HTML
  escaping, which TC-1.6 step 2 covers as a diff read.

## Notes

- **`core.hooksPath` is written to the shared `.git/config`, not per-worktree.** `pnpm install` in
  this worktree set `core.hooksPath=.husky/_` at
  `/home/dev/projects/saasaloy/.git/config`, so it applies to the main checkout and every linked
  worktree, including ones on branches that predate `.husky/`. Git silently skips a hook path that
  does not exist, so those worktrees still commit normally — but the setting outlives this branch
  and is not removed by deleting the worktree. Unset it with `git config --unset core.hooksPath` if
  a stale one ever gets in the way.
- **`pnpm verify:preset` and `pnpm deps:check` are red on `main` too**, for the reasons given under
  [Environment](#environment). Neither is this branch's to fix.
