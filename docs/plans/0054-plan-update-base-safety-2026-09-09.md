# `saasaloy update` overwrites owned base files — verified causes and fix prompt

Source report: `unishopr-reborn`, CLI `0.1.2`, base `web`. One `update` run rewrote 19 tracked files and removed about 1,229 lines of project work. This document keeps the report's evidence, corrects the parts that the CLI source contradicts, and ends with the prompt to hand an agent.

## 1. Verified causes, read from the source

### Cause 1 — adoption records disk bytes as the template baseline, and the classifier then overwrites

`adoptBase` in `packages/cli/src/lib/base.ts:296` records every base file at the hash it has on disk, "edits and all". `classifyTrackedFile` in `packages/cli/src/lib/updater.ts:905` returns `overwrite` when the disk hash equals the manifest hash, and `drift` otherwise. Put together, the two rules destroy edits:

1. First `update` on an unrecorded project adopts and returns early (`packages/cli/src/commands/update.ts:522`). Every hand-edited file is now recorded as pristine template output.
2. Second `update` hashes those files, finds them equal to the manifest, classifies `overwrite`, and writes the new template over them.

The adoption note tells the user "your edits are the baseline, not drift". That is only true if the update merges from that baseline. It does not — with no stored template bytes, `overwrite` is a full replace. This is the single mechanism behind `globals.css`, `navbar.tsx`, `footer.tsx`, `hero.tsx`, `faq.tsx`, `badge.tsx`, `button.tsx` and `.gitignore`.

The report calls this "no three-way merge". The merge machinery does exist (`lib/merge-plan.ts`, the `drift` path). The defect is narrower and easier to fix: adoption fabricates a baseline it has no right to claim.

### Cause 2 — every update re-renders the template with `basename(root)`

`renderTemplate` (`packages/cli/src/lib/base.ts:257`) calls `templateVars(basename(root))`. `{{PROJECT_NAME}}` is therefore re-substituted from the current directory name on every run, for both `adoptBase` and `baseUpdateInput`. The project ran from a git worktree, so `package.json` `name`, `wrangler.jsonc` `name` and `siteName` in `packages/ui/src/index.ts` all became `issue-26-update-saasaloy-to-a-newer-version`. The `wrangler.jsonc` rename would have created a second Worker on the next deploy.

Nothing on disk records the project name for `update` to read. `saasaloy.json` carries `base`, not `name`.

### Cause 3 — the ownership rule in `AGENTS.md` has no mechanism behind it

`_saasaloy-base.json` declares five seed files: `DESIGN.md`, `README.md`, `saasaloy.json`, `apps/web/src/pages/index.astro`, `packages/ui/src/content/landing.ts`. Those are the only files `update` never touches. The template's own `AGENTS.md` says blocks, components and `globals.css` are source the owner edits, and that base files have no update path. The declaration does not say so, so `update` treats all of them as its own.

`apps/web/public/favicon.svg` and `apps/web/src/layouts/Layout.astro` are in the same position: template-shipped, project-owned in practice, reset by the run.

### Correction to the report

The report's Defect 2 uses `DESIGN.md` as proof that the manifest hides drift. `DESIGN.md` is a seed file, so `update` never writes it and the predicted overwrite cannot happen. The underlying claim still holds for every non-seed file, and Cause 1 states it with the right evidence.

## 2. The fix, in priority order

1. **Stop adoption from claiming a baseline.** Record an adopted file with no hash, or with an explicit `adopted: true` flag, and route it through `drift` rather than `overwrite`. Unknown provenance means "may be edited". This one rule would have prevented the whole incident.
2. **Read the project name, never the directory.** Store `name` in `saasaloy.json` at `init`. On update, take the identity values from the project: `package.json` `name`, `wrangler.jsonc` `name`, `siteName`, `astro.config.mjs` `site`, the document `lang`. Re-inject them into rendered template content instead of the placeholder.
3. **Extend `_saasaloy-base.json` with an `ownedFiles` glob list** covering `packages/ui/src/styles/globals.css`, `packages/ui/src/blocks/**`, `packages/ui/src/components/**`, `packages/ui/src/content/**`, `apps/web/public/favicon.*`, and `apps/web/src/layouts/Layout.astro`. An owned file may be created when absent; an existing one goes to the merge plan, never to overwrite.
4. **Make the run reversible.** Copy every file the plan will touch to `.saasaloy/backup-<timestamp>/`, and add `saasaloy update --abort`.
5. **Refuse a dirty working tree without `--force`.**
6. **Exit non-zero when the merge plan is non-empty**, so CI sees it.

Conflict markers in the file are a fourth-priority nicety. The merge plan document already carries `base → theirs` and `base → mine` diffs, which is the artifact an agent needs. Markers can come later.

## 3. Recovery for a project already hit

```sh
git diff
git checkout HEAD -- packages/ui/src/styles/globals.css packages/ui/src/blocks packages/ui/src/components apps/web/src/layouts/Layout.astro apps/web/public/favicon.svg
# then re-apply the wanted template changes by hand
```

Keep from the run: the dependency bumps, the `@astrojs/cloudflare` adapter wiring, the `wrangler.jsonc` `dist/client` move, `404.astro`, `500.astro`, `error-state.tsx`, `content/errors.ts`, the `jsx: "react-jsx"` line, and the `saasaloy.json` `installed` to `base` migration. Restore by hand: `package.json` `name`, `wrangler.jsonc` `name`, `siteName`, and the `.gitignore` `docs/status/` entry.

## 4. Prompt for an agent on this repo

> `saasaloy update` destroys downstream work. On `unishopr-reborn` (base `web`, CLI `0.1.2`) one run rewrote 19 tracked files and deleted about 1,229 lines of committed project code, with no warning and no way to reverse it. Read `docs/plans/0054-plan-update-base-safety-2026-09-09.md` for the evidence. Fix these in order.
>
> **1. Adoption must not fabricate a baseline.** `adoptBase` (`packages/cli/src/lib/base.ts:296`) records each base file at its on-disk hash. `classifyTrackedFile` (`packages/cli/src/lib/updater.ts:905`) then reads that hash as proof the file is untouched template output and returns `overwrite`. Every hand-edited base file is replaced on the next run. Mark adopted entries in the manifest — add a field to `ManagedEntry`, extend `schemas/manifest.schema.json` — and make the classifier route an adopted entry to `drift`, so it reaches the merge plan rather than the writer. An entry only earns `overwrite` once the CLI itself wrote the bytes it records.
>
> **2. Never re-derive the project name from the directory.** `renderTemplate` (`packages/cli/src/lib/base.ts:257`) calls `templateVars(basename(root))` on every update, so a git worktree, a renamed folder or a CI checkout path rewrites `package.json` `name`, `wrangler.jsonc` `name` and `siteName` in `packages/ui/src/index.ts`. Persist `name` in `saasaloy.json` at `init`, fall back to `package.json` `name` for a project scaffolded before that field existed, and never use `basename`. Identity values stay project-owned after `init`: `package.json` `name`, `wrangler.jsonc` `name`, `siteName`, `astro.config.mjs` `site`, the document `lang`, and `apps/web/public/favicon.*`.
>
> **3. Give the ownership rule a mechanism.** The template's `AGENTS.md` says blocks, components and `globals.css` are source the project owns and that base files have no update path. `_saasaloy-base.json` declares only five seed files, so `update` overwrites the rest. Add an `ownedFiles` glob list to that declaration covering `packages/ui/src/styles/globals.css`, `packages/ui/src/blocks/**`, `packages/ui/src/components/**`, `packages/ui/src/content/**`, `apps/web/public/favicon.*` and `apps/web/src/layouts/Layout.astro`. An owned file that is absent may be created. An owned file that exists goes to the merge plan, never to overwrite. Decide and document how a project-added file inside a managed directory is treated: `packages/ui/src/blocks/` held 88 files while the manifest tracked 61 across the whole project.
>
> **4. Make the run reversible and cautious.** Copy every file the plan will touch to `.saasaloy/backup-<timestamp>/` before writing, and add `saasaloy update --abort` to restore the newest backup. Refuse to run on a dirty git working tree unless `--force` is passed. Exit non-zero when the merge plan is non-empty so CI catches it.
>
> Add regression tests for each: an adopted project with an edited `globals.css` and an edited block survives an update with its edits intact and both files in the merge plan; an update run from a directory whose name differs from the project name changes no identity value; `--abort` restores the pre-update tree byte for byte.
>
> Publish a recovery note for projects already hit — `git checkout HEAD -- <owned paths>`, then re-apply the wanted template changes by hand — and state in the release notes that `0.1.x` `saasaloy update` overwrites owned base files.
