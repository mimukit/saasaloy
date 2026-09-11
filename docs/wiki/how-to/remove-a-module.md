# Remove a module

`saasaloy remove` deletes the files a module applied, using the record in
`.saasaloy/manifest.json`. It never contacts the registry: the plan is built entirely from
`.saasaloy/manifest.json`, `saasaloy.json` and `saasaloy-lock.json`, so it works offline
and works even for a module whose registry entry has since changed.

**`remove` is not the inverse of `add`.** Read [What stays behind](#what-stays-behind)
before you rely on it to get back to a clean state.

## Take one out

```bash
saasaloy remove waitlist
```

With no module name you get a picker over the modules listed in `saasaloy.json`. Naming a
module that isn't installed prints `<name> isn't installed — nothing to remove.` and exits 2 without touching anything. With nothing installed at all, the run prints `Nothing installed.` and exits 0.

The plan tags every file it tracks:

- **`delete`** — on-disk content still matches the recorded hash, safe to remove.
- **`drift → confirm`** — the file was hand-edited since it was applied.
- **`missing → untrack`** — already gone, so there is nothing to delete.

Preview without writing:

```bash
saasaloy remove waitlist --dry-run
saasaloy remove waitlist --diff
```

`--diff` shows a deletion diff per file, and for a reversible patch the reversal it would
apply to the patched file. Each patch is labelled by what will happen to it: `revert`
when there is an edit to undo, `drift → left` when the line is yours now and the reason
why, `already gone` when nothing is left to undo, and `untrack` for a patch kind `remove`
cannot reverse.

## Warnings the module declares

A module descriptor may carry a `removeWarnings` array, and `add` copies it into `.saasaloy/manifest.json` at install time. `remove` prints each entry after the plan, so the warning is there even when the registry is not. `billing` declares two, one of which reads:

```text
The deployed billing_subscription and billing_event tables survive this removal, and so does the user.billing_customer_id column the schema file loses. Run db:generate and review the resulting drop migration before you apply it.
```

`entitlements` declares one, about routes still wrapped in `requireFeature()` or `requireWithinLimit()`. A warning never blocks the removal. Read it and act on it yourself.

## Hand-edited files

For each drifted file, `remove` asks whether to delete it anyway, defaulting to no. A file
you decline is left on disk and dropped from the manifest, which makes it yours: a later
`add` of the same module classifies it as a `conflict` and leaves it alone.

Under `--yes` no prompts run at all, so **every drifted file survives, untracked**. The plan says so up front: with `--yes` each drifted file is tagged `drift → kept (untracked)` instead of `drift → confirm`. That
is the designed outcome, not a failure, and the command exits 0. Whatever survives is listed again at the end under **Drift survivors**. If you want drifted files
gone in a scripted run, delete them yourself afterwards.

## Modules other modules depend on

Installing `waitlist` pulled in `api` and `database`, so those two now have a dependent.
Removing one of them directly is refused:

```text
database is still depended on by waitlist — refusing (use --force to remove it anyway).
```

Dependents are read from each installed module's `dependsOn` in `saasaloy-lock.json`.
`--force` overrides the refusal and removes the module regardless, leaving its dependents
installed and broken. An installed module with no lock entry is warned about by name,
because it might depend on the target and there is no way to tell.

## What stays behind

`remove` cleans up its own files, its skill symlinks, the now-empty directories it
created, the `saasaloy.json` aliases whose target directory is gone, and every config
patch the module applied to a source or config file: a `chained-route` link, a
`wrangler-binding` entry, a `plugin-array` or `const-array` element, a `drizzle-column`
column. Reversing one takes the edit out and the named import
with it, but only when no other code still references the identifier, so a hand-written
`app.use(waitlist.middleware)` is never left unbound. A binding array in
`apps/api/wrangler.jsonc` goes too once the last entry in it is gone, because the base
`api` module ships no binding arrays and every one of them was added by a patch. A
`providers` array in a capability's `src/index.ts` stays, empty, because the capability
ships it and the next provider install needs it there.

Nothing is reverse-patched blindly. A route you repointed at your own handler, a binding
whose value you edited, a plugin call you gave arguments: each is left where it is and
reported with the reason, because it no longer matches what the manifest recorded. The
record is still dropped, so the module stops being tracked either way. Four things
`remove` does not touch:

- **The two `package.json` patch kinds stay.** `remove` prints one warning per patched
  file and drops the entry from the manifest. Dropping the entry is untracking, not
  undoing. Removing `waitlist`, for instance, leaves `hono` and `@repo/api` in
  `apps/web/package.json` exactly where they were. Revert those by hand. See
  [Known limitations](../reference.md#known-limitations).
- **npm dependencies stay in your root `package.json`.** `add` merges them in; `remove`
  has no dependency handling at all.
- **Environment variables you set for the module** are left alone, wherever you put them.
- **The wire-up for a UI block you imported by hand stays.** `add` writes a block into the ui package but never edits a page, so nothing recorded which page you put it on. When `remove` deletes such a file it prints a **Wire-up left behind** note listing it, and the import and the tag are yours to take out. Leave them and the build fails.

## Related

- [Add a module](add-a-module.md)
- [Reference](../reference.md#saasaloy-remove) for the full flag list

_Verified against `main`@`42cbf03` on 2026-09-11._
