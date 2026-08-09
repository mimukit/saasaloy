# Add a module

`saasaloy add` copies a module's files into your project, pulls in whatever that module
depends on, and records what it wrote. Run it from anywhere inside a Saasaloy project; the
CLI walks up to the directory holding `saasaloy.json`.

## See what's available

```bash
saasaloy list
```

Names only, read from the default registry `mimukit/saasaloy`. Pass an `owner/repo` to
list a third-party registry instead. `list` takes no flags.

## Install one

```bash
saasaloy add waitlist
```

Before writing anything, `add` prints what it intends to do:

- **Dependencies** — the prerequisites it resolved. `waitlist` declares
  `dependsOn: ["api", "database"]`, so all three install, prerequisites first.
- **Plan** — every file, tagged `create`, `overwrite`, `unchanged`, `drift → merge` or
  `conflict → merge`.
- **Env vars to set** — variables the module needs, with the descriptor's own
  description. `waitlist` asks for `PUBLIC_API_URL`.
- **Aliases registered** and **Skill links**, when the module scaffolds a new workspace or
  ships an agent skill.
- **Config patches** — edits to files another module already owns.

Then it asks `Proceed?`. Answer no and nothing is written.

Run `add` with no module name and you get a picker over the registry instead.

## Look before you leap

```bash
saasaloy add waitlist --dry-run    # print the plan, write nothing
saasaloy add waitlist --diff       # print the plan plus a per-file diff, write nothing
```

Both stop before the confirmation prompt, so neither can touch disk. `--diff` caps each
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

## Re-running and re-applying

`add` is idempotent. If the module and its dependencies are already installed you get
`Nothing to do` and exit 0. To reapply the module you named, overwriting its managed files
with the registry's current content:

```bash
saasaloy add waitlist --force
```

`--force` applies to the module you asked for. Dependencies that are already installed
stay as they are.

A repeat `add` of a module already in `saasaloy-lock.json` reuses the commit SHA the lock
recorded, so it reproduces the same bytes rather than picking up whatever landed on `main`
since. Naming an explicit ref (`owner/repo@v2/module`) overrides that.

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
the bookkeeping matches what actually landed, and re-running `add` is the recovery. The
rough edges in that model are tracked in
[Known limitations](../reference.md#known-limitations).

## Related

- [Remove a module](remove-a-module.md)
- [Architecture](../architecture.md) for what the applier does with hashes and aliases
- [Reference](../reference.md#saasaloy-add) for the full flag list

_Verified against `main`@`48d32d7` on 2026-08-09._
