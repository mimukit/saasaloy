# QA Plan: `saasaloy init` initialises a git repository

_Generated 2026-08-09 · covers `issue-71-adopt-a-linter-across-the-repo-and-templates` vs `main` (issue #71, Phase 5)_

## Summary

- `saasaloy init` now runs `git init --quiet` in the scaffolded project, **after** the template
  copy and **before** the install prompt. Three helpers in `packages/cli/src/commands/init.ts` do
  the work: `gitSucceeds(dir, args)` (run a git subcommand, report only whether it exited 0),
  `wouldNestInsideRepo(dir)` (the guard), and `runGitInit(cwd)` (the action). None of them throws.
- The guard asks **two** questions, not one: `git rev-parse --is-inside-work-tree`, and then
  `git check-ignore --quiet .`. `git init` is skipped only when the target is inside a work tree
  **and not ignored by it**. That second question is what lets `saasaloy init .dev/playground`
  create a repository inside this repo (where `/.dev/` is gitignored) while
  `saasaloy init ./apps/my-app` inside a real project correctly does nothing.
- `pnpm play:init` no longer runs its own `git init` — the playground gets its repository from the
  CLI, the same way a user's project does. `CONTRIBUTING.md`'s "Why `play:init` runs `git init`"
  section is now "Why the playground is a git repository".
- "Working" means: a fresh `saasaloy init` produces a project whose `pnpm install` installs husky's
  hooks; an init inside an existing repo never nests one; and a machine without `git` still gets a
  complete scaffold, with a warning that names the consequence.

**What the agent already ran.** All five scenarios below were exercised on this branch against the
built CLI and are recorded as passing in [Automated verification](#automated-verification-by-ai-agent).
What is left for a human is the parts that need a second machine or a second pair of eyes: the
Windows path, the husky-hooks-actually-fire check on a real commit, and confirming the warning copy
reads sensibly in a real terminal.

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

Do this once, before Scenario 1.

- Branch under test: `issue-71-adopt-a-linter-across-the-repo-and-templates`.
- Node 24+ and pnpm 11, per the repo's toolchain.
- `git --version` should print something. Scenario 5 deliberately takes it away again.
- Build the CLI once: `pnpm --filter saasaloy build`. Every command below invokes
  `node <repo>/packages/cli/dist/index.js`; export it for convenience:

  ```sh
  export SAASALOY="$PWD/packages/cli/dist/index.js"
  ```

- Work in a scratch directory **outside any git repository** for Scenarios 1 and 5 —
  `mktemp -d` is fine. Being inside a repo changes the expected result, which is the whole point
  of Scenario 3.

---

## Scenario 1 — a bare `saasaloy init my-app` outside any repository

The default path a first-time user takes.

**Setup**

```sh
cd "$(mktemp -d)"
```

**Steps**

1. Run `node "$SAASALOY" init my-app --no-install`.
2. Read the output between "Scaffolded my-app" and "Next steps".
3. Run `ls -d my-app/.git`.
4. Run `git -C my-app rev-parse --show-toplevel`.
5. Run `git -C my-app status --porcelain | head`.

**Expected**

- [ ] Step 2 prints `Initialised a git repository (git init).` — and prints it **after** the
      "Scaffolded" line, not before.
- [ ] Step 3 finds `my-app/.git`.
- [ ] Step 4 prints the absolute path of `my-app` itself — not a parent directory.
- [ ] Step 5 lists the scaffolded files as untracked. Nothing is committed; `init` creates the
      repository, it does not make a commit.
- [ ] The command exits 0 and the "Next steps" note still renders.

---

## Scenario 2 — `saasaloy init .` in an empty directory

Same as Scenario 1 but with the current-directory form, which resolves the project name from the
directory's basename.

**Setup**

```sh
cd "$(mktemp -d)" && mkdir my-app && cd my-app
```

**Steps**

1. Run `node "$SAASALOY" init . --no-install`.
2. Run `git rev-parse --show-toplevel`.

**Expected**

- [ ] `Initialised a git repository (git init).` appears.
- [ ] Step 2 prints the current directory.
- [ ] "Next steps" omits the `cd` line (it does for `.`) but still shows `pnpm install`.

---

## Scenario 3 — `saasaloy init ./apps/x` **inside** an existing repository

The case the guard exists for. A nested repository here would break the outer project's status,
diffs and CI in ways that are annoying to unpick.

**Setup** — reuse the `my-app` from Scenario 1, which is now a repository:

```sh
cd /path/to/my-app
```

**Steps**

1. Run `node "$SAASALOY" init ./apps/inner --no-install`.
2. Read the message where Scenario 1 printed "Initialised a git repository".
3. Run `ls -a apps/inner` and look for `.git`.
4. Run `git -C apps/inner rev-parse --show-toplevel`.

**Expected**

- [ ] Step 2 prints `inner is already inside a git repository — skipping git init.`
- [ ] Step 3 shows the scaffold (`package.json`, `apps/`, `packages/`, `.husky/`, `.gitignore`)
      and **no** `.git` directory.
- [ ] Step 4 prints the path of the **outer** project, not `apps/inner`.
- [ ] The scaffold itself is complete and the command exits 0 — the skip is not an error.

---

## Scenario 4 — the target already has a `.git`

Re-running `init --force` over a project that is already a repository must not disturb it.

**Steps**

1. `cd` into the `my-app` from Scenario 1.
2. Note the current HEAD state: `git rev-parse --is-inside-work-tree` prints `true`.
3. Run `node "$SAASALOY" init . --force --no-install`.
4. Run `git status --porcelain | head` and `ls -d .git`.

**Expected**

- [ ] Step 3 prints `my-app is already inside a git repository — skipping git init.`
- [ ] `.git` still exists and is the same repository — no reinitialisation message, no second
      `.git` anywhere.
- [ ] The scaffold was re-copied (that is what `--force` means) and the command exits 0.

---

## Scenario 5 — `git` is not on `PATH`

The degraded path. It must warn and continue, never throw — matching how a missing `pnpm` is
already handled.

**Setup** — build a `PATH` with node but no git:

```sh
cd "$(mktemp -d)"
mkdir empty-bin
NODEBIN="$(dirname "$(command -v node)")"
```

**Steps**

1. Run `env PATH="$PWD/empty-bin:$NODEBIN" node "$SAASALOY" init nogit-app --no-install`.
2. Read the warning block.
3. Run `ls nogit-app/package.json` and `ls -d nogit-app/.git`.
4. Check the exit code with `echo $?` immediately after step 1.

**Expected**

- [ ] Step 2 prints a warning that names the consequence, not just the failure — it should say to
      run `git init` yourself **before `pnpm install`, so the commit hooks install**.
- [ ] A second dim line shows git's own message (`spawn git ENOENT`).
- [ ] Step 3: `package.json` exists; `.git` does **not**.
- [ ] Step 4: exit code is **0**. A missing `git` degrades the project, it does not fail the
      scaffold.
- [ ] "Next steps" and the `🎉 Created nogit-app successfully.` outro still print.

---

## Scenario 6 — the hooks actually install, and actually fire

The reason `git init` moved into the CLI at all. This one needs a real `pnpm install`, so it is the
slowest case; run it last.

**Steps**

1. In a scratch directory outside any repo: `node "$SAASALOY" init hooked-app --no-install`.
2. `cd hooked-app && pnpm install` (a few minutes on a cold store).
3. Run `git config core.hooksPath`.
4. Run `ls .husky` and `ls .husky/_ | head`.
5. Stage something and try a **bad** commit message:

   ```sh
   git add -A
   git commit -m "just some words"
   ```

6. Retry with a conventional message: `git commit -m "chore: initial scaffold"`.

**Expected**

- [ ] Step 3 prints `.husky/_`.
- [ ] Step 4 shows the committed `pre-commit` and `commit-msg` files, and a generated `_/`
      directory of shims. The two committed files do **not** need an executable bit — husky's
      shims run them through `sh`.
- [ ] Step 5 is **rejected** by commitlint with `type may not be empty` / `subject may not be
      empty`, and no commit is created (`git log` is still empty).
- [ ] Before that rejection, lint-staged runs over the staged files and reports its passes.
- [ ] Step 6 succeeds and creates the first commit.
- [ ] Repeat step 5 with `git commit --no-verify -m "just some words"` — it succeeds. The bypass
      is documented and must work.

---

## Scenario 7 — the playground still gets its repository

`pnpm play:init` dropped its own `git init`. This confirms the CLI's guard makes the right call for
a directory that is inside this repo but gitignored.

**Steps**

1. From the repo root: `pnpm run play:reset`.
2. Read the output for the git line.
3. Run `git -C .dev/playground rev-parse --show-toplevel`.
4. Run `git -C .dev/playground status --porcelain | head -3`.
5. From the repo root, run `git status --porcelain | grep '\.dev' || echo "playground invisible"`.

**Expected**

- [ ] Step 2 prints `Initialised a git repository (git init).` — **not** the "already inside"
      message. `/.dev/` is gitignored by this repo, so an inner repository there is correct.
- [ ] Step 3 prints `<repo>/.dev/playground`, not the repo root.
- [ ] Step 4 lists the playground's own files as untracked in the playground's repository.
- [ ] Step 5 prints `playground invisible` — the outer repo still ignores `.dev/` entirely.
- [ ] `pnpm run deps:verify` completes green (this is the standing gate that depends on the
      playground's repository for Turborepo cache invalidation).

---

## Scenario 8 — Windows

Cannot be run on the dev box; needs a real Windows machine or VM. `spawn` on Windows resolves
`git.exe` fine without a shell, but the code passes `shell: process.platform === "win32"` for
consistency with `runPnpmInstall`, and that path has never been exercised here.

**Steps**

1. On Windows, with git and pnpm installed, run `node <path>\dist\index.js init my-app --no-install`
   in an empty directory outside any repository.
2. Repeat Scenario 3's nested case.

**Expected**

- [ ] Scenario 1's expectations hold, including the `Initialised a git repository` line.
- [ ] Scenario 3's guard still skips, and the message renders without mangled escaping.
- [ ] No shell window flashes and no `'git' is not recognized` error leaks through as an unhandled
      rejection.

---

## Automated verification (by AI agent)

Run on 2026-08-09 against this branch, with the CLI built from source.

- ✅ **Scenario 1** — `node dist/index.js init my-app --no-install` in a fresh non-repo directory
  printed `Initialised a git repository (git init).` and produced `my-app/.git`.
- ✅ **Scenario 3** — from inside that new repository, `init ./apps/inner --no-install` printed
  `inner is already inside a git repository — skipping git init.` and created **no** nested `.git`.
  The scaffold itself completed.
- ✅ **Scenario 4** — `init . --force --no-install` in a directory that already had `.git` took the
  same skip path.
- ✅ **Scenario 5** — with `PATH` reduced to a directory containing only node, the run printed
  `Couldn't run git init — run it yourself before pnpm install so the commit hooks install.`
  followed by `spawn git ENOENT`, produced `package.json` and no `.git`, and still printed the
  success outro.
- ✅ **Scenario 7** — `pnpm run play:init` printed `Initialised a git repository (git init).`;
  `git -C .dev/playground rev-parse --show-toplevel` resolved to the playground itself. The guard's
  second question (`git check-ignore --quiet .`) is what makes this work, and reverting to an
  `is-inside-work-tree`-only guard was confirmed to break it.
- ✅ **Scenario 6, partially** — `pnpm -C .dev/playground install` installed husky:
  `git -C .dev/playground config core.hooksPath` returns `.husky/_`, and `.husky/pre-commit` and
  `.husky/commit-msg` are present (mode 0644, which is fine — husky's shims `sh -e` them).
  commitlint was exercised directly: `feat(cli): add a thing` exits 0, `bogus message` exits 1 with
  `type may not be empty`. **A real `git commit` through the hook was not run** — this branch is
  left uncommitted on purpose, so steps 5 and 6 are still a human's to do.
- ✅ **`pnpm deps:verify`** completes green end to end with the playground's repository created by
  the CLI rather than by `play:init`.
- ⬜ **Scenario 2** — not run; it is Scenario 1 with a different argument form.
- ⬜ **Scenario 8 (Windows)** — cannot be run here.

## Notes

- `pnpm verify:preset` is **red on this branch and on `main`** for an unrelated reason: Lightning
  CSS re-serialises the preset's `oklch(0.6231 0.1880 259.8145)` as `oklch(62.31% .188 259.815)`,
  and `verify-preset.ts`'s `normalize()` does not flatten that. It was confirmed to fail identically
  with this branch's changes stashed. Not this issue's to fix, but do not read it as a regression.
