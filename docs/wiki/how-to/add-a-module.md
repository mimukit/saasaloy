# Add a module

`saasaloy add` puts a module in the lock's `requested` list, renders the project with it, and writes the difference: the module's files, the files of whatever it depends on, its patches into files other modules own, and the generated table files its rows go into (such as `apps/api/src/routes.generated.ts`). It records each file it wrote in `.saasaloy/manifest.json`. Run it from anywhere inside a Saasaloy project; the
CLI walks up to the directory holding `saasaloy.json`.

## See what's available

```bash
saasaloy list
```

Names only, read from the default registry `mimukit/saasaloy`. Pass an `owner/repo` to list a third-party registry instead. Run inside a project, each name is marked installed or not. `--installed` narrows the output to what the project already has; `--available` narrows it to what the registry offers and the project has not installed.

## Install one

```bash
saasaloy add waitlist
```

Before writing anything, `add` prints what it intends to do:

- **Dependencies** — the prerequisites it resolved. `waitlist` declares `dependsOn: ["api", "database", "validators"]`, so all four install, prerequisites first.
- **Plan** — every path the run changes, with its result: a new file, an updated file, a three-way merge (clean or with conflicts), or a file left alone. A file another module owns appears here when a patch of the new module changes it, such as `package.json`, and a generated table file appears when the module adds a row to it, such as `apps/api/src/routes.generated.ts`.
- **Env vars to set** — variables the module needs, with the descriptor's own
  description. `waitlist` asks for `PUBLIC_API_URL`.

When the plan writes into `packages/ui/`, `add` also reminds you to run the
`/saasaloy-design update` skill afterwards, because a write there, such as a new block,
can invalidate the web app's `apps/web/DESIGN.md`. The reminder also fires for the `shell`
module, which writes its own theme file there; that one does not touch the web app's
contract.

Then it asks `Proceed?`. Answer no and nothing is written.

Run `add` with no module name and you get a multi-select over the registry instead.

## Install several at once

```bash
saasaloy add admin teams --yes
```

Several names resolve into one graph, so you get one plan and one `Proceed?`. Every check that would refuse one module runs on the whole set before anything is written: a conflict between the first and the last name exits 2 with nothing on disk. A shell loop over `saasaloy add` gives you neither, because each run checks only its own graph and a refusal at the third module leaves the first two installed.

Prerequisites install first, then the names in the order you typed them. A module you named that is already installed is skipped with a note, and the rest install. One `--with` answers a driver choice for every module in the set, such as `--with api-keys-user` beside `api-keys`. All the names must come from one registry.

## The skill that comes with it

Most modules install a `saasaloy-<name>` agent skill alongside their files — real files in
`.agents/skills/`, symlinked from `.claude/skills/` so Claude Code picks them up as slash
commands. Provider modules such as `email-plunk`, `kv-memory` and `storage-cloudflare` ship no skill of their own; the capability they plug into carries the runbook. The skill is the module's runbook: `saasaloy-api` covers adding a route,
`saasaloy-database` covers tables and migrations, `saasaloy-auth` covers sessions and
roles. After an install, that skill is the manual for working inside what just landed, for
you and for any agent in the project.

## Drivers and mutually exclusive modules

Some capabilities cannot run without a driver, so their descriptor declares `requiresOneOf`. `api-keys` declares `requiresOneOf: ["api-keys-organization", "api-keys-user"]`. When nothing in the run and nothing installed satisfies that list, `add` prompts you to pick one, resolves it, and folds it into the same plan. It re-checks after each pick, up to eight rounds, because one driver can settle two requirements and a picked module can raise a requirement of its own.

A list with one option is no choice, so `add` asks nothing. `database` declares `requiresOneOf: ["database-postgres"]`, and `saasaloy add database` adds the driver to the same plan, also with `--yes` or no terminal, and prints one line:

```text
database needs database-postgres; adding it.
```

`--with <module>` answers the choice on the command line, so the run needs no prompt: `saasaloy add api-keys --with api-keys-user --yes`. It is repeatable. A `--with` module that answers no unmet requirement exits 2 before anything is written, so it cannot install a module on the side.

There is no prompt in a non-interactive run or under `--yes`. Without `--with`, a list of two or more refuses and names the options, exit 2:

```text
Cannot add api-keys — unmet requirement:
  api-keys needs one of: api-keys-organization, api-keys-user, and none is installed. Re-run as `saasaloy add api-keys --with api-keys-organization`, or pick another from that list.
```

Two modules that must never sit side by side declare `conflictsWith`. `api-keys-user` and `api-keys-organization` name each other. `add` checks that after the driver prompt, before it plans a single file, and `--force` does not bypass it:

```text
Cannot add api-keys-organization — module conflict:
  api-keys-user is already installed and declares a conflict with api-keys-organization. Run `saasaloy remove api-keys-user` first.
```

Provider modules are the other shape. A capability such as `email`, `kv`, `queue`, `storage`, `sms`, `logger` or `payment` takes any number of providers side by side, and a `<CAP>_PROVIDER` environment variable picks the one that runs. The value is always required and there is no default, so `add` lists the variable under **Env vars to set** and `saasaloy env` prompts for it.

## Look before you leap

```bash
saasaloy add waitlist --dry-run    # print the plan, write nothing
saasaloy add waitlist --diff       # print the plan plus a per-file diff, write nothing
```

Both stop before the confirmation prompt, so neither can touch disk. `--diff` prints a diff for each path the run would change, patched files included.

`saasaloy add waitlist --dry-run --json` prints the plan as one JSON document on stdout, `schemaVersion` 3: each file carries its result kind and its class.

To skip the prompt in a script, use `--yes` (or `-y`).

## Finish the install

Modules bring npm dependencies with them. `add` merges those into your root
`package.json`, but it does not install them:

```bash
pnpm install
```

Do the same when the plan reported new aliases — those are new workspaces, and pnpm has to
link them before anything can import them.

Modules also bring environment variables. `add` adds each one, with its description, to `packages/env/.env.example`, then points at the two commands that fill them in. `saasaloy env` writes the values into the gitignored `packages/env/.env`, and `pnpm env:setup` copies them into each service's own `.env`:

```bash
saasaloy env            # prompt for every unset variable and write it to packages/env/.env
saasaloy env --check    # report what is still missing, prompt for nothing, exit 2
pnpm env:setup          # write each service's .env from packages/env/.env
```

A provider module's vendor keys are conditional keys. `pnpm env:setup` accepts them blank while the capability's `<CAP>_PROVIDER` key selects another provider, so a project develops on `EMAIL_PROVIDER=console` with `PLUNK_API_KEY` blank. The `# @required-when` line above each key in `packages/env/.env.example` names its condition.

`env` only fills blanks at the prompt. A value you already typed is never rewritten, except by `--set KEY=VALUE` or `--from-file <path>`, which answer the prompts on the command line. It refuses to write a file git does not ignore. Production secrets are printed as the commands to run, not run for you.

## Re-running

`add` is idempotent. If the module and its dependencies are already installed you get `Nothing to do` and exit 0. To write a named module's tracked files that you deleted again:

```bash
saasaloy add waitlist --force
```

`--force` also lets the run merge or delete a file with uncommitted changes, and overwrite an edited `generated` file.

The default registry moves as one release. `add` reads every default module at the tag of the CLI that runs, so `saasaloy add waitlist@main` refuses with exit 2, and so does an `add` whose lock records another release than the running CLI. Run `saasaloy update` first. A third-party coordinate such as `owner/repo@v2/module` keeps its own ref. `SAASALOY_REGISTRY_DIR` reads a local registry straight off disk, with no pin.

## Files the CLI will not overwrite

`add` renders the whole set, so it can touch a file that is already in the project:

- **A tracked file you edited** that the new render changes, such as `package.json`, merges three ways. Your lines stay. Where both sides changed the same lines, the file gets conflict markers, the run exits 3, and `add`, `remove` and `update` refuse until no marker line remains.
- **A file at a new path that Saasaloy never wrote** gets two-way markers, unless the path is a `once` file. A `once` path that already holds a file is yours, and the run leaves it.
- **A file with uncommitted changes** that the run must merge or delete refuses the run with exit 2. Commit first, or pass `--force`. A write of a new file needs no clean tree.

The same restraint applies to skill links: a `.claude/skills/<name>` path occupied by
something that isn't Saasaloy's symlink is reported and left in place.

## Installing from another registry

```bash
saasaloy add someone/their-repo/their-module
saasaloy add someone/their-repo@v1.2.0/their-module
saasaloy add someone/their-repo                    # picker over that repo
```

The full grammar, including the two forms that aren't supported, is in
[the reference](../reference.md#module-coordinates).

## When add fails partway

The run copies each file it will change before it writes, and it writes `.saasaloy/journal.json` before the first write. If the run stops halfway, every later `add`, `remove` and `update` refuses with exit 2 until you restore the files:

```bash
saasaloy add --abort
```

`--abort` restores the files of the last run, the manifest and the lock included, and removes the journal.

A project an older CLI (0.9.0 or earlier) wrote holds a version 1 manifest. `add` refuses it with exit 2. Run `saasaloy update` first, which converts it.

## Related

- [Remove a module](remove-a-module.md)
- [Architecture](../architecture.md) for what the engine does with renders, hashes and aliases
- [Reference](../reference.md#saasaloy-add) for the full flag list

_Verified against `main`@`e2830008` on 2026-11-22._
