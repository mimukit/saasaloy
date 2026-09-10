# `saasaloy update` overwrote work you own

`saasaloy update` at 0.1.x could replace files the project owns with the template's copies. If your favicon came back, your blocks lost their edits, or `packages/ui/src/styles/globals.css` turned back into the shipped theme, this is what happened and this is how to get the work back.

## Symptoms

One `saasaloy update` run rewrites files nobody expected it to touch:

- `packages/ui/src/styles/globals.css` back to the shipped palette, and class names like `duration-fast` or `bg-success` now resolving to nothing.
- Blocks and components under `packages/ui/src/` back to their template versions, with imports for files that still exist on disk deleted.
- `apps/web/public/favicon.svg` reset, and the icon links gone from `apps/web/src/layouts/Layout.astro`.
- `package.json` `name`, `apps/web/wrangler.jsonc` `name` and `siteName` in `packages/ui/src/index.ts` renamed to the directory you ran the command in. A git worktree named after a branch is the usual way to see this.

## Why

Two causes, both fixed in the CLI ([ADR 0034](../../adr/0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md)).

A project with no base record was **adopted**: every base file was recorded at the hash it had on disk, edits and all. The next run read that hash as proof the file was untouched template output and overwrote it.

The update also re-rendered the template with `basename(process.cwd())` as `{{PROJECT_NAME}}`, so the directory name replaced the project's name everywhere the scaffold had substituted it.

## Get the work back

If the CLI is new enough to have written a backup, use it:

```sh
saasaloy update --abort
```

Otherwise use git. Nothing here needs the CLI:

```sh
# see everything the run rewrote
git diff

# take back the files you own
git checkout HEAD -- \
  packages/ui/src/styles/globals.css \
  packages/ui/src/blocks \
  packages/ui/src/components \
  packages/ui/src/index.ts \
  apps/web/src/layouts/Layout.astro \
  apps/web/public/favicon.svg
```

Then re-apply by hand the template changes you do want. Dependency bumps, new pages and new adapter wiring are usually worth keeping; identity values never are. Check `package.json` `name` and `apps/web/wrangler.jsonc` `name` before you deploy again — a renamed Worker deploys a second Worker rather than updating the one you have.

If the run happened before backups shipped and the work was never committed, git cannot help. There is no other copy.

## Stop it happening again

Upgrade the CLI. From the version carrying ADR 0034:

- an adopted file is never overwritten, only offered as a merge;
- the files the template hands over stay yours;
- the project name comes from `saasaloy.json`, never from the directory;
- every run writes `.saasaloy/backups/<timestamp>/` first, and `saasaloy update --abort` restores it;
- a dirty git working tree is refused without `--force`.

Commit or stash before any update anyway. It costs one command and it is the only recovery that never depends on the tool behaving.
