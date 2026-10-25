---
name: saasaloy-build
description: Run the whole MVP build of a Saasaloy project in stages, from a complete product brief to a seeded, tested local app, with one commit per stage on the build/mvp branch and a resumable docs/build-log.md. Use when the owner says "build the MVP", "build this product", "build it unattended", when an agent was given a product brief and asked for a SaaS MVP, when docs/product-brief.md has autonomy: afk and no build has run, and when docs/build-log.md shows a build that stopped and must continue.
---

# saasaloy-build — from a complete brief to a local MVP, in stages

This skill runs the other skills in order. It writes no feature code of its own. Each stage hands its work to the skill that owns it, then ends with the same gate and one commit, so a stopped build leaves a branch and a log that a new session can continue from.

The build stops at a running, seeded, tested local app. A deploy, a vendor account and a push stay a person's steps.

## The inputs

A person supplies two things before the build starts. The build never writes either one.

- **`docs/product-brief.md`**, written through the attended `saasaloy-setup` interview. It must be complete. `saasaloy-setup`, "Unattended run", defines complete: all ten answers present and filled, none tagged `weak:`.
- **The env values**, in `packages/env/.env`, or in a dotenv file the person put beside the brief (`./env` or `./.env.local`).

`autonomy: afk` in the brief's frontmatter means nobody is at the keyboard. Then ask nothing: no question, no confirmation, no preview that waits for an answer. Without it, ask before each stage, and follow every skill's attended path.

## Step 0 — read the log first

Open `docs/build-log.md`. When it exists, a build already ran here:

1. Run `git branch --show-current`. Switch to `build/mvp` when you are on another branch.
2. Find the last `## <stage>` section that names a commit. Check that the commit is on the branch: `git merge-base --is-ancestor <sha> HEAD`.
3. Continue at the first stage in [The stages](#the-stages) after that one. Do not redo a stage that has a commit.
4. When the log has a `## Blocked` list, read it. Clear an item only when its cause is gone, such as a brief section a person has since filled. Otherwise stop again and leave the list.

When the log does not exist, start at [Intake](#stage-intake).

## The stages

Run them in this order. Each one ends with [The stage gate](#the-stage-gate).

| Stage | Log section | What it does | The skills it runs |
|-------|-------------|--------------|--------------------|
| Intake | `## Intake` | moves the brief, checks it, loads the env, opens the branch | `saasaloy-setup`, `saasaloy-env` |
| Brand | `## Brand` | name, locale, landing copy, theme | `saasaloy-setup`, `saasaloy-landing-copy`, `saasaloy-design` |
| Validate | `## Validate` | the modules whose `stage` is `validate` | each module's skill |
| MVP | `## MVP` | the modules whose `stage` is `mvp` | each module's skill |
| Feature | `## Feature` | one product entity end to end | `saasaloy-feature` |
| Handover | `## Left for a human` | the steps only a person can take | none |

### Stage: Intake

1. **Move the brief.** When `./product-brief.md` exists at the project root, or one directory up when `saasaloy init` made a subfolder, move it to `docs/product-brief.md`. Keep `docs/product-brief.md` when both exist, and log that you kept it.
2. **Check that the brief is complete**, by `saasaloy-setup`'s rule. With an incomplete brief, list each missing, empty or weak section under `## Blocked` as `saasaloy-setup` says, and stop. Install no module.
3. **Load the env values.** When `packages/env/.env` is missing a value and the person left a dotenv file beside the brief, run `saasaloy env --from-file <that file>`. Never use `--set`, which leaves a secret in shell history, and never invent a value. Run `pnpm env:setup`.
4. **Set the testing mode.** The MVP needs a route test. When the `<!-- saasaloy:testing -->` block in `AGENTS.md` says `off`, run `saasaloy testing tests-after` and log it.
5. **Open the branch.** Run `git switch build/mvp`, or `git switch -c build/mvp` when it does not exist.
6. **Start the log.** Create `docs/build-log.md` with a `# Build log` title and an `## Intake` section that lists what this stage did.

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
4. **Add the rest in one call per stage**, with every `requiresOneOf` answered: `saasaloy add <modules...> --with database-d1 --yes`. `add` resolves `dependsOn` itself.

For the MVP stage this gives `shell`, `auth`, `app`, `admin`, `email` and `email-console`, on top of the Validate stage's `database`, `database-d1`, `api`, `logger`, `logger-console` and `validators`.

After `add`, read each new module's skill and follow its Wire-up section when it has one. `add` prints which skills need it. Then run `pnpm install`, `pnpm env:setup` when the module declared new env keys, and the database setup the driver skill names (`pnpm db:setup`, then `pnpm db:seed`).

### Stage: Feature

Run `saasaloy-feature` for the one entity the brief centres on. Pick it from the brief's Problem and Differentiator answers: the thing the user makes, tracks or reads. Log the pick and the reason.

### Stage: Handover

Write `## Left for a human` as the last section, one list item per step. It always holds these:

- Review the commits on `build/mvp` and merge them.
- Push the branch. The build never pushes.
- Deploy with `pnpm deploy:production`, which the `saasaloy-deploy` skill covers.
- Each module dropped for its `needs`, and the account it needs.
- Each value that `saasaloy env --check` still reports as missing.

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

Then write the commit's short hash into the stage's section of `docs/build-log.md`, as the first hex string in that section: `Commit: 1a2b3c4`. Write no other hex string in a stage's section, because the log's reader takes the first one as the stage's commit. This edit rides along with the next stage's commit, and the Handover commit carries the last one.

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

- One `## <stage>` section per stage, in the order above, each with its commit and a list of what it did.
- `## Blocked` lists what stopped the build. A later session clears an item when it fixes it.
- `## Left for a human` lists each step only a person can take.

## What stays forbidden

Under `autonomy: afk`, `AGENTS.md` "Unattended work" allows schema changes, migrations, exact-pinned dependencies and new workspaces without asking. These stay forbidden: a deploy, anything that spends money or creates a vendor account, editing a secret, deleting data outside the local dev database, and `git push`. Log the step under `## Left for a human` and carry on.

## Failure modes

- **`saasaloy add` exits 2 and names a flag.** The CLI has no terminal to ask on. Pass the flag it names: `--yes`, or `--with <module>` for a `requiresOneOf` choice.
- **`saasaloy add` refuses a module that conflicts with an installed one.** Rule 2 above picked two drivers or providers for one capability. Keep the local one.
- **`pnpm check` fails in a file you did not touch.** Read the error first. A scaffolded file fails only when a module's wire-up step was skipped, so run the module's Wire-up section before you change the file.
- **The dev server cannot bind its port.** Another process holds it. Stop the process you started; never stop a process you did not start, and never move a port, because the CORS lists name the fixed ports.
- **The log names a commit that is not on the branch.** History moved under the build. Stop, and write it under `## Blocked`.

## Next

Run `saasaloy-deploy` when the owner has merged `build/mvp` and wants the app live.
