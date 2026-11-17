---
name: saasaloy-build
description: Run the whole MVP build of a Saasaloy project in stages, from a complete product brief to a seeded, tested local app, with one commit per stage on the build/mvp branch and a resumable docs/build-log.md. Use when the owner says "build the MVP", "build this product", "build it unattended", when an agent was given a product brief and asked for a SaaS MVP, when docs/product-brief.md has autonomy: afk and no build has run, and when docs/build-log.md shows a build that stopped and must continue.
---

# saasaloy-build — from a complete brief to a local MVP, in stages

This skill runs the other skills in order. It writes no feature code of its own. Each stage hands its work to the skill that owns it, then ends with the same gate and one commit, so a stopped build leaves a branch and a log that a new session can continue from.

The build stops at a running, seeded, tested local app. A deploy, a vendor account and a push stay a person's steps.

## The inputs

A person supplies the brief before the build starts. The build never writes it.

- **`docs/product-brief.md`**, written through the attended `saasaloy-setup` interview. It must be complete. `saasaloy-setup`, "Unattended run", defines complete: all ten answers present and filled, none tagged `weak:`.
- **The env values are optional.** A missing `packages/env/.env` reads as an empty file, so `pnpm env:setup` writes the local default of each key in `packages/env/.env.example`. A person who has values puts them in `packages/env/.env`, or in a dotenv file beside the brief (`./env` or `./.env.local`).

The build runs `pnpm env:setup` itself. It writes `packages/env/.env` only through `saasaloy env`, as [Fill a key with no default](#fill-a-key-with-no-default) says, and never edits the file by hand.

`autonomy: afk` in the brief's frontmatter means nobody is at the keyboard. Then ask nothing: no question, no confirmation, no preview that waits for an answer. Without it, ask before each stage, and follow every skill's attended path.

## Step 0 — read the log first

Open `docs/build-log.md`. When it exists, a build already ran here:

1. Run `git branch --show-current`. Switch to `build/mvp` when you are on another branch.
2. Read the stages that have a commit from git, not from the log alone: `git log --format='%h %s' main..HEAD`. Each `feat(build): <stage>` subject is a finished stage.
3. When a finished stage's section in the log has no `Commit:` line, write it now from that list. A stop between a stage's commit and its log edit loses only the edit, because the commit subject still names the stage.
4. Check that each `Commit:` hash in the log is on the branch: `git merge-base --is-ancestor <sha> HEAD`.
5. Run `git status --porcelain`. When it prints lines, apply [A dirty tree on resume](#a-dirty-tree-on-resume).
6. Continue at the first stage in [The stages](#the-stages) after the last finished one. Do not redo a stage that has a commit.
7. When the log has a `## Blocked` list, read it. Clear an item only when its cause is gone, such as a brief section a person has since filled. Otherwise stop again and leave the list.

When the log does not exist, start at [Intake](#stage-intake).

### A dirty tree on resume

A session that stopped inside a stage leaves its changes uncommitted.

- A change to `docs/build-log.md` alone is the last finished stage's `Commit:` line. Keep it. It rides along with the next stage's commit.
- Any other change is the unfinished work of the next stage. Keep it, and run that stage again from its first step over it. `saasaloy add` skips a module that is already installed, and every other step is safe to run again over its own output. Then run [The stage gate](#the-stage-gate) and commit.
- Never discard the changes with `git checkout`, `git restore`, `git reset --hard`, `git clean` or `git stash`. When the stage still cannot pass the gate, write it under `## Blocked`, and stop.

## The stages

Run them in this order. Each one ends with [The stage gate](#the-stage-gate).

| Stage | Log section | What it does | The skills it runs |
|-------|-------------|--------------|--------------------|
| Intake | `## Intake` | makes the first commit, moves the brief, checks it, loads the env, opens the branch | `saasaloy-setup`, `saasaloy-env` |
| Brand | `## Brand` | name, locale, landing copy, theme | `saasaloy-setup`, `saasaloy-landing-copy`, `saasaloy-design` |
| Validate | `## Validate` | the modules whose `stage` is `validate` | each module's skill |
| MVP | `## MVP` | the modules whose `stage` is `mvp` | each module's skill |
| Feature | `## Feature` | one product entity end to end | `saasaloy-feature` |
| Handover | `## Left for a human` | the steps only a person can take | none |

### Stage: Intake

1. **Keep the env file out of git.** When the person left a dotenv file inside the project (`./env`), add its path to `.gitignore`. The stage commits run `git add -A`, and that file can hold a secret.
2. **Make the first commit when `init` skipped it.** `saasaloy init` commits the scaffold on `main`, except under `--no-git` or with no git identity. When `git rev-parse --verify --quiet HEAD` prints nothing, `main` has no commit. Run `git init --initial-branch=main` first when the project has no `.git`. Then run `git add -A` and `git commit -m "chore(repo): initial commit"` on `main`. When git reports no identity (user.name and user.email), write it under `## Blocked`, and stop: the identity is a person's choice.
3. **Move the brief.** When `./product-brief.md` exists at the project root, or one directory up when `saasaloy init` made a subfolder, move it to `docs/product-brief.md`. Keep `docs/product-brief.md` when both exist, and log that you kept it.
4. **Check that the brief is complete**, by `saasaloy-setup`'s rule. With an incomplete brief, list each missing, empty or weak section under `## Blocked` as `saasaloy-setup` says, and stop. Install no module.
5. **Load the env values.** When the person left a dotenv file beside the brief, run `saasaloy env --from-file <that file>`. It takes each key a module declares or `packages/env/.env.example` lists, such as `PUBLIC_SITE_URL`, and refuses the whole file on any other key. Never pass a secret with `--set`, which leaves it in shell history, and never invent a value. Then run `pnpm env:setup`. With no file, `pnpm env:setup` alone writes the local defaults.
6. **Set the testing mode.** The MVP needs a route test. When the `<!-- saasaloy:testing -->` block in `AGENTS.md` says `off`, run `saasaloy testing tests-after` and log it.
7. **Open the branch.** Run `git switch build/mvp`, or `git switch -c build/mvp` when it does not exist.
8. **Start the log.** Create `docs/build-log.md` with a `# Build log` title and an `## Intake` section that lists what this stage did.

### Stage: Brand

Run `saasaloy-setup`, then `saasaloy-landing-copy`, then `saasaloy-design`. Under `autonomy: afk` each one takes its unattended path: setup sets `app.name` and `app.locale`, landing copy writes `landing.ts` from the brief with no draft approval, and design picks a preset that fits the brief's tone. Each one logs its own lines in this stage's section.

### Stage: Validate and Stage: MVP

Pick the modules from data, never from memory:

```sh
saasaloy list --json
```

Read `modules[]`. For the Validate stage keep each module whose `stage` is `validate`, and for the MVP stage each one whose `stage` is `mvp`. Then apply these rules in order:

1. **Drop a module with a non-empty `needs`.** `cloudflare-paid`, `stripe`, `domain` and `vendor-account` each need a person with an account. Log each dropped module and its `needs` under `## Left for a human`.
2. **Pick one provider or driver per capability, the local one.** `database-d1` for `database`, `logger-console` for `logger`, `email-console` for `email`. A module in another module's `conflictsWith` list is never added beside it.
3. **Drop the optional extras the brief does not ask for:** `waitlist` (the MVP has a real sign-up), `e2e` (it needs a browser download), `email-react` and `command`. Add one when the brief names what it does, and log why.
4. **Add the rest in one call per stage**: `saasaloy add <modules...> --yes`. Name the picked driver or provider in the list itself (`database-d1`, `email-console`), and `add` resolves `dependsOn` and the `requiresOneOf` choice from it. Pass `--with <module>` only when `add` exits 2 and names an unmet choice: `add` also exits 2 on a `--with` that answers no open choice.

For the MVP stage this gives `shell`, `auth`, `app`, `admin`, `email` and `email-console`, on top of the Validate stage's `database`, `database-d1`, `api`, `logger`, `logger-console` and `validators`.

After each `add`, run these steps in this order, from the project root:

1. **Install.** Run `pnpm install --no-frozen-lockfile`. `add` runs no install, and with `CI=1` a plain `pnpm install` refuses the lockfile that `add` changed.
2. **Wire up.** Read each new module's skill and follow its Wire-up section when it has one. `add` prints which skills need it.
3. **Generate the migrations.** When `packages/db/src/schema/` holds a table file, run `pnpm --filter @repo/db db:generate`. The Validate stage adds no table, so skip this step there: `db:generate` fails with "No schema files found" on an empty schema folder. The MVP stage's `auth` adds the first tables.
4. **Set up the database.** Run `pnpm db:setup`. With no migration it exits 0 and says so. On Postgres it also writes `DATABASE_URL` into `apps/api/.env`, which is why it runs before the env step.
5. **Write the env files.** Run `pnpm env:setup`, after every `add`, because `add` rewrites the key list. When it fails and names a key with no default, follow [Fill a key with no default](#fill-a-key-with-no-default), then run it again.
6. **Seed.** Run `pnpm db:seed`.

A project with no `packages/db` skips steps 3, 4 and 6. Then run [The stage gate](#the-stage-gate).

#### Fill a key with no default

`pnpm env:setup` names each key that has no value and no default in `packages/env/.env.example`. Fill a key here only when its value is not a secret and follows from the build's own picks:

- A `<CAP>_PROVIDER` key takes the name of the local provider the build installed, such as `EMAIL_PROVIDER=console` for `email-console`.
- A sender address for a local provider takes an address on `example.test`, such as `EMAIL_FROM=hello@example.test`.

Write each one with `saasaloy env --set <KEY>=<value>`, log it, and list it under `## Left for a human`, so a person replaces it before a deploy. Any other key, a secret above all, goes under `## Blocked` with the key's name, and the build stops.

### Stage: Feature

Run `saasaloy-feature` for the one entity the brief centres on. Pick it from the brief's Problem and Differentiator answers: the thing the user makes, tracks or reads. Log the pick and the reason.

### Stage: Handover

Write `## Left for a human` as the last section, one list item per step. It always holds these:

- Review the commits on `build/mvp` and merge them.
- Push the branch. The build never pushes.
- Deploy with `pnpm deploy:production`, which the `saasaloy-deploy` skill covers.
- Each module dropped for its `needs`, and the account it needs.
- Each value that `saasaloy env --check` still reports as missing.
- Each local value the build wrote with `saasaloy env --set`, to replace before a deploy.

This stage edits only the log. Commit it as the last commit: `docs(build): record the build log`.

## The stage gate

Every stage ends the same way, from the project root:

```sh
pnpm lint:fix
pnpm format
pnpm check
```

`pnpm check` must exit 0. When it fails, fix the cause and run it again. Do not commit a red stage, do not skip a hook, and do not weaken a test to pass. When you cannot fix it, write the stage, the command and the failing lines under `## Blocked`, and stop.

Then commit the stage:

```sh
git add -A
git commit -m "feat(build): <stage in lowercase>"
```

Commit through the Husky and commitlint hooks, never with `--no-verify`. Never push.

Then write the commit's short hash into the stage's section of `docs/build-log.md`, as the first hex string in that section: `Commit: 1a2b3c4`. Write no other hex string in a stage's section, because the log's reader takes the first one as the stage's commit. This edit rides along with the next stage's commit, and the Handover commit carries the last one. When a session stops before this edit, [Step 0](#step-0--read-the-log-first) writes the line again from the commit's subject.

## The log

`docs/build-log.md` is the build's output and its resume point. Its shape:

```md
# Build log

## Intake

Commit: 1a2b3c4

- Moved ./product-brief.md to docs/product-brief.md.
- The brief is complete.
- Loaded the env values from ./env; ran pnpm env:setup.

## Brand

...

## Blocked

- MVP: pnpm check fails in apps/app: ...

## Left for a human

- Push build/mvp. The build never pushes.
```

- One `## <stage>` section per stage, in the order above, each with its commit and a list of what it did. The commit subject `feat(build): <stage>` is the record that survives a stop; the `Commit:` line is a copy of it.
- `## Blocked` lists what stopped the build. A later session clears an item when it fixes it.
- `## Left for a human` lists each step only a person can take.

## What stays forbidden

Under `autonomy: afk`, `AGENTS.md` "Unattended work" allows schema changes, migrations, exact-pinned dependencies and new workspaces without asking. These stay forbidden: a deploy, anything that spends money or creates a vendor account, editing a secret, deleting data outside the local dev database, and `git push`. Log the step under `## Left for a human` and carry on.

## Failure modes

- **`saasaloy add` exits 2 and names a flag.** The CLI has no terminal to ask on. Pass the flag it names: `--yes`, or `--with <module>` for an unmet `requiresOneOf` choice.
- **`saasaloy add` exits 2 with "answers no unmet requirement".** A `--with` named a module that is already in the list or already installed. Drop the `--with`.
- **`saasaloy add` refuses a module that conflicts with an installed one.** Rule 2 above picked two drivers or providers for one capability. Keep the local one.
- **`pnpm check` fails in a file you did not touch.** Read the error first. A scaffolded file fails only when a module's wire-up step was skipped, so run the module's Wire-up section before you change the file.
- **The dev server cannot bind its port.** Another process holds it. Stop the process you started; never stop a process you did not start, and never move a port, because the CORS lists name the fixed ports.
- **The log names a commit that is not on the branch.** History moved under the build. Stop, and write it under `## Blocked`.
- **`pnpm env:setup` fails and names a key.** That key has no value and no default. Follow [Fill a key with no default](#fill-a-key-with-no-default).
- **`pnpm --filter @repo/db db:generate` fails with "No schema files found".** No module added a table yet. Skip the step until one does.
- **`pnpm install` fails on a frozen lockfile.** `CI` is set. Run `pnpm install --no-frozen-lockfile`.

## Next

Run `saasaloy-deploy` when the owner has merged `build/mvp` and wants the app live.
