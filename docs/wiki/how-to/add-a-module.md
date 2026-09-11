# Add a module

`saasaloy add` copies a module's files into your project, pulls in whatever that module
depends on, and records what it wrote. Run it from anywhere inside a Saasaloy project; the
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
- **Plan** — every file, tagged `create`, `overwrite`, `unchanged`, `drift → merge` or
  `conflict → merge`.
- **Env vars to set** — variables the module needs, with the descriptor's own
  description. `waitlist` asks for `PUBLIC_API_URL`.
- **Aliases registered** and **Skill links**, when the module scaffolds a new workspace or
  ships an agent skill.
- **Config patches** — edits to files another module already owns.

When the plan writes into `packages/ui/`, `add` also reminds you to run the
`/saasaloy-design update` skill afterwards, because those writes can invalidate the
project's `DESIGN.md`.

Then it asks `Proceed?`. Answer no and nothing is written.

Run `add` with no module name and you get a picker over the registry instead.

## The skill that comes with it

Most modules install a `saasaloy-<name>` agent skill alongside their files — real files in
`.agents/skills/`, symlinked from `.claude/skills/` so Claude Code picks them up as slash
commands. Provider modules such as `email-plunk`, `kv-memory` and `storage-cloudflare` ship no skill of their own; the capability they plug into carries the runbook. The skill is the module's runbook: `saasaloy-api` covers adding a route,
`saasaloy-database` covers tables and migrations, `saasaloy-auth` covers sessions and
roles. After an install, that skill is the manual for working inside what just landed, for
you and for any agent in the project.

## Drivers and mutually exclusive modules

Some capabilities cannot run without a driver, so their descriptor declares `requiresOneOf`. `database` declares `requiresOneOf: ["database-d1", "database-postgres"]`. When nothing in the run and nothing installed satisfies that list, `add` prompts you to pick one, resolves it, and folds it into the same plan. It re-checks after each pick, up to eight rounds, because one driver can settle two requirements and a picked module can raise a requirement of its own.

There is no prompt in a non-interactive run or under `--yes`. Both refuse and name the options, exit 2:

```text
Cannot add database — unmet requirement:
  database needs one of: database-d1, database-postgres, and none is installed. Run `saasaloy add database-d1` first, or pick another from that list.
```

Two modules that must never sit side by side declare `conflictsWith`. `database-d1` and `database-postgres` name each other. `add` checks that after the driver prompt, before it plans a single file, and `--force` does not bypass it:

```text
Cannot add database-postgres — module conflict:
  database-d1 is already installed and declares a conflict with database-postgres. Run `saasaloy remove database-d1` first.
```

Provider modules are the other shape. A capability such as `email`, `kv`, `queue`, `storage`, `sms` or `logger` takes any number of providers side by side, and a `<CAP>_PROVIDER` environment variable picks the one that runs. The value is always required and there is no default, so `add` lists the variable under **Env vars to set** and `saasaloy env` prompts for it.

## Look before you leap

```bash
saasaloy add waitlist --dry-run    # print the plan, write nothing
saasaloy add waitlist --diff       # print the plan plus a per-file diff, write nothing
```

Both stop before the confirmation prompt, so neither can touch disk. `--diff` prints a diff for each config patch it would apply as well, and caps each
file at 60 lines.

To skip the prompt in a script, use `--yes` (or `-y`).

## Finish the install

Modules bring npm dependencies with them. `add` merges those into your root
`package.json`, but it does not install them:

```bash
pnpm install
```

Do the same when the plan reported new aliases — those are new workspaces, and pnpm has to
link them before anything can import them.

Modules also bring environment variables. `add` writes a `.dev.vars.example` in the api workspace with the description of each one, then points at the command that fills them in:

```bash
saasaloy env            # prompt for every unset variable and write it where it is read
saasaloy env --check    # report what is still missing, prompt for nothing, exit non-zero
```

`env` only fills blanks. A value you already typed is never rewritten, and it refuses to write a file git does not ignore. Production secrets are printed as the commands to run, not run for you.

## Re-running and re-applying

`add` is idempotent. If the module and its dependencies are already installed you get
`Nothing to do` and exit 0. To reapply the module you named, overwriting its managed
files:

```bash
saasaloy add waitlist --force
```

`--force` applies to the module you asked for. Dependencies that are already installed
stay as they are. It does not cross module file ownership: a module reapplies its own
files and the files of any module the two reach through `dependsOn`, at any depth and in either direction, and `add` exits 2 when it
reaches a file some unrelated module owns. To hand a file to a different module, remove the
owner first — `saasaloy remove database-d1` then `saasaloy add database-postgres` swaps
one database driver for the other, and the refusal prints the exact `remove` to run.

`--force` reapplies whatever the coordinate resolves to, which is not
necessarily `main`'s tip — with the module already in the lockfile, that is the SHA the
lock recorded.

A repeat `add` of a module already in `saasaloy-lock.json` reuses the commit SHA the lock
recorded, so it reproduces the same bytes rather than picking up whatever landed on `main`
since. That holds only while you are adding from the same `owner/repo` the lock entry
names. Naming an explicit ref (`owner/repo@v2/module`) overrides it, and so does setting
`SAASALOY_REGISTRY_DIR` — a local registry is read straight off disk, with no pin.

## Files the CLI refuses to touch

Two plan actions mean "left alone":

- **`drift → merge`** — the file is tracked in `.saasaloy/manifest.json`, but its content
  hash no longer matches, so you edited it after it was applied.
- **`conflict → merge`** — a file already sits at that path and Saasaloy never wrote it.

Both are held back and listed under **Needs merge** at the end of the run. The module's
newer version is not written over your edits. Re-run with `--diff` to see what the
registry would have put there and merge it yourself.

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

`add` writes files, merges dependencies, applies patches and links skills in one pass.
There is no rollback: if it throws mid-apply, it still persists the manifest and config so
the bookkeeping matches what actually landed, and re-running `add` is the recovery. The run names it for you: `Partial apply — the manifest, config and lock describe what landed. Re-run saasaloy add <module> to complete it.` A module whose file changed on disk between the plan and the write is left uninstalled and reported the same way, and the run still exits 0. The
rough edges in that model are tracked in
[Known limitations](../reference.md#known-limitations).

## Related

- [Remove a module](remove-a-module.md)
- [Architecture](../architecture.md) for what the applier does with hashes and aliases
- [Reference](../reference.md#saasaloy-add) for the full flag list

_Verified against `main`@`42cbf03` on 2026-09-11._
