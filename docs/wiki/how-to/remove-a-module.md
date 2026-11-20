# Remove a module

`saasaloy remove` renders the project again without the module and applies the difference. Every edit the module made goes with it, its patches into other files and its rows in generated tables included, because a render without the module never wrote them. Nothing needs to be reversed.

The render reads the payload of the lock's release from the user cache (`~/.cache/saasaloy/payload/`), and fetches it from the registry when the cache does not hold it. With a cold cache and no network, a run that must merge a file refuses with exit 2.

## Take one out

```bash
saasaloy remove waitlist
```

With no module name you get a picker over the modules you asked for (the lock's `requested` list). Naming a module that isn't installed prints `<name> isn't installed.` and exits 2 without touching anything. With nothing installed, the run prints `No module is installed.` and exits 0.

Preview without writing:

```bash
saasaloy remove waitlist --dry-run
saasaloy remove waitlist --diff
```

`--dry-run` lists each path the run would delete, write or merge, and the report lines it would print. `--diff` adds a diff for each path.

`remove` refuses with exit 2 when:

- the lock's release differs from the running CLI. Run `saasaloy update` first.
- the project still has a version 1 manifest from a CLI before 0.10.0. Run `saasaloy update` first: only `update` converts.
- a file the last run left with conflict markers still holds a marker line.
- an earlier run did not finish (`.saasaloy/journal.json` exists). Run `saasaloy remove --abort`.
- the run must delete or merge a file that has uncommitted changes. Commit first, or pass `--force`.

## Warnings the module declares

A module descriptor may carry a `removeWarnings` array. `remove` prints each entry before the plan. `subscription` declares two, one of which reads:

```text
The deployed subscriptions and subscription_events tables survive this removal, and so does the users.subscription_customer_id column the schema file loses. Run db:generate and review the resulting drop migration before you apply it.
```

`subscription` declares one about routes still wrapped in `requireFeature()` or `requireWithinLimit()`. A warning never blocks the removal. Read it and act on it yourself.

## Files you changed

The engine never deletes a file whose bytes differ from what it wrote ([ADR 0034](../../adr/0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md)). For each file the module wrote:

- **Unchanged:** deleted.
- **Changed by you:** kept on disk, dropped from the manifest, and listed with one report line under "Kept, no longer tracked". It is yours now. Delete it by hand when nothing imports it.
- **A file the module patched, such as `apps/api/src/index.ts` or `package.json`:** it stays, because another module or the base still renders it. The run merges the render without the module with your copy three ways, so the module's lines go and your own lines stay. Where both changed the same lines, the file gets conflict markers and the run exits 3.

No prompt asks about a changed file, so `--yes` gives the same result as an interactive run.

## Modules other modules depend on

Installing `waitlist` pulled in `api` and `database`, so those two now have a dependent. Removing one of them directly is refused with exit 2:

```text
database is still depended on by waitlist. Remove it first.
```

A module that was installed only as a prerequisite cannot be removed on its own either. Remove the module that asked for it. `--force` does not override this refusal, because a module cannot render without its prerequisite.

## Undo a removal

```bash
saasaloy remove --abort
```

`--abort` restores every file the last run changed, from the copy the run made before it wrote. Git cannot undo a `--force` run over uncommitted work, so commit before you use `--force`.

## What stays behind

- **Files you changed**, as above.
- **Environment values you set** in `packages/env/.env` stay. The key list `packages/env/.env.example` merges three ways, so the module's keys go unless you edited them.
- **The wire-up for a UI block you imported by hand.** `add` writes a block into the ui package but never edits a page, so nothing recorded which page you put it on. Take the import and the tag out yourself, or the build fails.
- **Data.** A deployed table survives. Run `db:generate` and review the drop migration before you apply it.

## Related

- [Add a module](add-a-module.md)
- [Reference](../reference.md#saasaloy-remove) for the full flag list

_Verified against `main`@`928b4f03` on 2026-11-19._
