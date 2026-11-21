---
name: saasaloy-build
description: Run the whole MVP build of a Saasaloy project in stages, from a complete product brief and product spec to a seeded, tested local app, with one commit per stage and one per spec entity on the build/mvp branch and a resumable docs/build-log.md. Use when saasaloy-setup finishes its read-back, when the owner says "build the MVP", "build this product", "build it unattended", when an agent was given a product brief and asked for a SaaS MVP, when docs/product-brief.md has autonomy: afk and no build has run, and when docs/build-log.md shows a build that stopped and must continue.
---

# saasaloy-build — from a complete brief to a local MVP, in stages

This skill runs the other skills in order. It writes no feature code of its own. Each stage hands its work to the skill that owns it, then ends with the same gate and one commit, so a stopped build leaves a branch and a log that a new session can continue from. The Feature stage commits once for each entity of the spec.

The build stops at a running, seeded, tested local app. A deploy, a vendor account and a push stay a person's steps.

## The inputs

The `saasaloy-setup` interview writes the brief and the spec with the owner, and then starts this skill in the same session. The build never writes either file.

- **`docs/product-brief.md`**. It must be complete. `saasaloy-setup`, "Unattended run", defines complete: all ten answers present and filled, none tagged `weak:`. An answer tagged `weak-accepted:` counts as filled. Its frontmatter holds the run settings: `autonomy` and `deploy` (`preview` or `none`; a brief with no `deploy` field reads as `none`).
- **`docs/product-spec.md`**: the modules the owner picked, the database driver, one table for each entity in the owner's order, the wishes that are not in this build, and the steps left for the owner. Its `##` headings and the rows of each entity table are fixed by `.agents/skills/saasaloy-setup/product-spec-template.md`. A brief written before the spec existed has none: then the build adds the MVP set on `database-postgres` and builds one entity, as [Without a spec](#without-a-spec) says.
- **The env values are optional.** A missing `packages/env/.env` reads as an empty file, so `pnpm env:setup` writes the local default of each key in `packages/env/.env.example`. A person who has values puts them in `packages/env/.env`, or in a dotenv file beside the brief (`./env` or `./.env.local`).

The build runs `pnpm env:setup` itself. It writes `packages/env/.env` only through `saasaloy env`, as [Fill a key with no default](#fill-a-key-with-no-default) says, and never edits the file by hand.

`autonomy: afk` in the brief's frontmatter means nobody is at the keyboard. Then ask nothing: no question, no confirmation, no preview that waits for an answer. Without it, ask before each stage, and follow every skill's attended path.

## Step 0 — read the log first

**With no brief and no person, stop.** When neither `docs/product-brief.md` nor `./product-brief.md` exists, and nobody in this session can answer a question (the prompt says so, or the run is headless), write nothing and say why: "No product brief exists and nobody is here to answer the saasaloy-setup interview." Then stop. With a person present, run `saasaloy-setup` first. A headless run whose prompt says the owner is here and answers questions has a person present. Never answer the interview yourself.

Open `docs/build-log.md`. When it exists, a build already ran here:

1. Run `git branch --show-current`. Switch to `build/mvp` when you are on another branch.
2. Read the stages that have a commit from git, not from the log alone: `git log --format='%h %s' main..HEAD`. Each `feat(build): <stage>` subject is a finished stage. Each `feat(build): feature <table>` subject is a finished entity of the Feature stage, such as `feat(build): feature books`. A log from before the spec has one `feat(build): feature` subject with no table, and it counts as the one entity of [Without a spec](#without-a-spec).
3. When a finished stage's section in the log has no `Commit:` line, write it now from that list. A stop between a stage's commit and its log edit loses only the edit, because the commit subject still names the stage.
4. Check that each `Commit:` hash in the log is on the branch: `git merge-base --is-ancestor <sha> HEAD`.
5. Run `git status --porcelain`. When it prints lines, apply [A dirty tree on resume](#a-dirty-tree-on-resume).
6. Continue at the first stage in [The stages](#the-stages) after the last finished one. Do not redo a stage that has a commit. In the Feature stage, continue at the first entity of the spec's `## Entities`, in its order, with no `feat(build): feature <table>` commit. Do not redo an entity that has one.
7. When the log has a `## Blocked` list, read it. Clear an item only when its cause is gone, such as a brief section a person has since filled. Otherwise stop again and leave the list.

When the log does not exist, start at [Intake](#stage-intake).

### A dirty tree on resume

A session that stopped inside a stage leaves its changes uncommitted.

- A change to `docs/build-log.md` alone is the last finished stage's `Commit:` line. Keep it. It rides along with the next stage's commit.
- Any other change is the unfinished work of the next stage, or of the next entity in the Feature stage. Keep it, and run that stage or entity again from its first step over it. `saasaloy add` skips a module that is already installed, and every other step is safe to run again over its own output. Then run [The stage gate](#the-stage-gate) and commit.
- Never discard the changes with `git checkout`, `git restore`, `git reset --hard`, `git clean` or `git stash`. When the stage still cannot pass the gate, write it under `## Blocked`, and stop.

## The stages

Run them in this order. Each one ends with [The stage gate](#the-stage-gate).

| Stage | Log section | What it does | The skills it runs |
|-------|-------------|--------------|--------------------|
| Intake | `## Intake` | makes the first commit, moves the brief, checks the brief and the spec, loads the env, opens the branch | `saasaloy-setup`, `saasaloy-env` |
| Brand | `## Brand` | name, locale, landing copy, theme | `saasaloy-setup`, `saasaloy-landing-copy`, `saasaloy-design` |
| Validate | `## Validate` | the modules whose `stage` is `validate`, and the spec's picks of that stage | each module's skill |
| MVP | `## MVP` | the modules whose `stage` is `mvp`, and the spec's other picks | each module's skill |
| Feature | `## Feature: <table>`, one for each entity | each entity of the spec end to end, in the spec's order, one commit each | `saasaloy-feature` |
| Handover | `## Left for a human` | the steps only a person can take | none |

### Stage: Intake

1. **Keep the env file out of git.** When the person left a dotenv file inside the project (`./env`), add its path to `.gitignore`. The stage commits run `git add -A`, and that file can hold a secret.
2. **Make the first commit when `init` skipped it.** `saasaloy init` commits the scaffold on `main`, except under `--no-git` or with no git identity. When `git rev-parse --verify --quiet HEAD` prints nothing, `main` has no commit. Run `git init --initial-branch=main` first when the project has no `.git`. Then run `git add -A` and `git commit -m "chore(repo): initial commit"` on `main`. When git reports no identity (user.name and user.email), write it under `## Blocked`, and stop: the identity is a person's choice.
3. **Move the brief and the spec.** When `./product-brief.md` exists at the project root, or one directory up when `saasaloy init` made a subfolder, move it to `docs/product-brief.md`. Do the same for `./product-spec.md`. Keep the file in `docs/` when both exist, and log that you kept it.
4. **Check that the brief is complete**, by `saasaloy-setup`'s rule. With an incomplete brief, list each missing, empty or weak section under `## Blocked` as `saasaloy-setup` says, and stop. Install no module.
5. **Check the spec.** When `docs/product-spec.md` exists, it must hold each `##` heading of `.agents/skills/saasaloy-setup/product-spec-template.md`: `## Modules`, `## Database driver`, `## Entities`, `## Not in this build` and `## Left for the owner`. Each entity under `## Entities` must have a table with the rows `Table`, `Fields`, `Who may see it`, `Actions` and `Screens`. List each missing heading or row under `## Blocked` (`- Product spec: books has no Actions row`), and stop. Install no module. When the spec does not exist, note `- No product spec; the build follows "Without a spec".` for the log, and carry on.
6. **Note each wish that is not in this build.** Take one log line for each item of the spec's `## Not in this build`: `- Not in this build: <the wish>.`
7. **Load the env values.** When the person left a dotenv file beside the brief, run `saasaloy env --from-file <that file>`. It takes each key a module declares or `packages/env/.env.example` lists, such as `PUBLIC_SITE_URL`, and refuses the whole file on any other key. Never pass a secret with `--set`, which leaves it in shell history, and never invent a value. Then run `pnpm env:setup`. With no file, `pnpm env:setup` alone writes the local defaults.
8. **Set the testing mode.** The MVP needs a route test. When the `<!-- saasaloy:testing -->` block in `AGENTS.md` says `off`, run `saasaloy testing tests-after` and log it.
9. **Open the branch.** Run `git switch build/mvp`, or `git switch -c build/mvp` when it does not exist.
10. **Start the log.** Create `docs/build-log.md` with a `# Build log` title and an `## Intake` section that lists what this stage did, with the lines of steps 5 and 6.

### Stage: Brand

Run `saasaloy-setup`, then `saasaloy-landing-copy`, then `saasaloy-design`. Under `autonomy: afk` each one takes its unattended path: setup sets `app.name` and `app.locale`, landing copy writes `landing.ts` from the brief with no draft approval, and design picks a preset that fits the brief's tone. Each one logs its own lines in this stage's section. Without `autonomy: afk`, the interview already ran, so run only `saasaloy-setup`'s Step 3 (the name and the locale) and then the other two skills' attended paths.

### Stage: Validate and Stage: MVP

Pick the modules from data, never from memory:

```sh
saasaloy list --json
```

Read `modules[]`. For the Validate stage keep each module whose `stage` is `validate`, and for the MVP stage each one whose `stage` is `mvp`. Then apply these rules in order:

1. **Drop a module with a non-empty `needs`.** `cloudflare-paid`, `stripe`, `domain` and `vendor-account` each need a person with an account. Log each dropped module and its `needs` under `## Left for a human`.
2. **Pick one driver for `database`: the spec's.** Take it from the code span under the spec's `## Database driver`: `database-postgres`, the only driver. With no spec, pick `database-postgres`. A module in another module's `conflictsWith` list is never added beside it.
3. **Pick one provider per other capability, the local one.** `logger-console` for `logger`, `email-console` for `email`: the provider whose name ends in `-console`, or in `-memory` when no `-console` provider exists.
4. **Drop the optional extras the spec does not pick:** `waitlist` (the MVP has a real sign-up), `e2e` (it needs a browser download), `email-react`, `command`, `notification`, `auth-phone` (it pulls in `sms`, `ratelimit` and `kv`), `ci` and `infra-ci-deploy` (they set up a person's GitHub and Cloudflare deploy). Add one only when the spec's `## Modules` names it.
5. **Add the agent set to the MVP stage: `agent`, `api-keys` and `api-keys-user`.** Every built product is usable by AI agents: `agent` serves an OpenAPI document, an MCP server and an `llms.txt` from the route statements, and an agent signs in with a user's key. `api-keys` and `api-keys-user` stay `scale` modules in `saasaloy list --json`; name them in the MVP stage's call anyway, as you name `database-postgres`. When the spec's `## Modules` picks `api-keys-organization`, or any entity's `Who may see it` is `the organization`, name `api-keys-organization` in place of `api-keys-user`: the two conflict, and a user's key acts for no organization, so every route of an organization entity would refuse it and the entity would be closed to agents. Read `saasaloy-agent` after the add. Then add the scope word of each installed shipped read to the key vocabulary, because it ships empty and a key holds only words the vocabulary lists: `notifications: ["read"]` with `notification` and `files: ["read"]` with `file-uploads` in `API_KEY_SCOPES` (`packages/auth/src/api-key-scopes.ts`), or `project: ["read"]` in `statements` (`packages/auth/src/access.ts`) under `api-keys-organization`. `saasaloy-agent` lists each shipped read and its word.
6. **Add the spec's picks.** Each module the spec's `## Modules` table names joins the stage of its `Stage` column: `validate` joins the Validate stage, and any other stage (`mvp`, `teams`, `money`, `scale`) joins the MVP stage. A pick with a non-empty `needs` is never added: add its capability's local provider instead (rule 3), and put the vendor step under `## Left for a human`. `saasaloy-setup` already wrote it that way, so this only guards a hand-edited spec.
7. **Add the rest in one call per stage**: `saasaloy add <modules...> --yes`. Name the picked driver or provider in the list itself (`database-postgres`, `email-console`, `queue-memory`), and `add` resolves `dependsOn` and the `requiresOneOf` choice from it. Pass `--with <module>` only when `add` exits 2 and names an unmet choice: `add` also exits 2 on a `--with` that answers no open choice.

For the MVP stage this gives `shell`, `auth`, `app`, `admin`, `email`, `email-console`, `agent`, `api-keys` and `api-keys-user`, on top of the Validate stage's `database`, `database-postgres`, `api`, `logger`, `logger-console` and `validators`.

That sentence names the set with no picks. The spec's picks come on top, each in its stage.

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

Build every entity of the spec's `## Entities`, in its order, with no limit on their number. For each entity:

1. Add a `## Feature: <table>` section to the log, with the table name from the entity's `Table` row, such as `## Feature: books`.
2. Run `saasaloy-feature` for that entity. It takes the columns, the actions, the access rule and the screens from the entity's table in the spec.
3. Run [The stage gate](#the-stage-gate), and commit the entity on its own: `feat(build): feature <table>`, such as `feat(build): feature books`.

One entity is one commit. Do not put two entities in one commit, and do not start the next entity before the commit. A later entity with a `link to <table>` field reads the table of an earlier one, which is why the order holds.

#### Without a spec

A brief with no `docs/product-spec.md` gets one entity. Run `saasaloy-feature` for the entity the brief centres on: pick it from the brief's Problem and Differentiator answers, the thing the user makes, tracks or reads. Log the pick and the reason in a `## Feature: <table>` section, and commit it as `feat(build): feature <table>`.

### Stage: Handover

Write `## Left for a human` as the last section, one list item per step. It always holds these:

- Review the commits on `build/mvp` and merge them.
- Push the branch. The build never pushes.
- Deploy with `pnpm deploy:production`, which the `saasaloy-deploy` skill covers.
- Each module dropped for its `needs`, and the account it needs.
- Each item of the spec's `## Left for the owner`, such as a vendor provider to add in place of a local one.
- Each value that `saasaloy env --check` still reports as missing.
- Each local value the build wrote with `saasaloy env --set`, to replace before a deploy.
- With `deploy: preview` in the brief's frontmatter: the preview deploy. This build has no Preview stage, so it records the owner's choice and deploys nothing. With `deploy: none`, or no `deploy` field, write nothing about a preview.

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

The Feature stage commits once for each entity instead, as `feat(build): feature <table>`.

Commit through the Husky and commitlint hooks, never with `--no-verify`. Never push.

Then write the commit's short hash into the stage's section of `docs/build-log.md`, as the first hex string in that section: `Commit: 1a2b3c4`. An entity's commit goes into its `## Feature: <table>` section. Write no other hex string in a stage's section, because the log's reader takes the first one as the stage's commit. This edit rides along with the next stage's commit, and the Handover commit carries the last one. When a session stops before this edit, [Step 0](#step-0--read-the-log-first) writes the line again from the commit's subject.

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

## Feature: books

Commit: 5d6e7f8

- Built books from the spec: 5 fields, the owner's rows only, actions list, create, update, finish.

## Feature: reading_sessions

Commit: 9a0b1c2

- Built reading_sessions from the spec.

## Blocked

- MVP: pnpm check fails in apps/app: ...

## Left for a human

- Push build/mvp. The build never pushes.
```

- One `## <stage>` section per stage, in the order above, each with its commit and a list of what it did. The Feature stage has one `## Feature: <table>` section for each entity, in the spec's order. The commit subject (`feat(build): <stage>`, or `feat(build): feature <table>`) is the record that survives a stop; the `Commit:` line is a copy of it.
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
- **The spec names a module that `saasaloy list --json` does not hold.** The registry changed since the interview. Write it under `## Blocked` with the module's name, and stop.
- **A spec entity cannot pass the gate.** Write the entity, the command and the failing lines under `## Blocked`, and stop. The entities before it keep their commits, and a new session continues at this one.

## Next

Run `saasaloy-deploy` when the owner has merged `build/mvp` and wants the app live.
