# Plan: make `saasaloy update` survive skipped releases and local deletions

Issue: [#312](https://github.com/mimukit/saasaloy/issues/312). Source: [`0096-plan-primeshopr-findings-issues-2026-11-04.md`](0096-plan-primeshopr-findings-issues-2026-11-04.md), section "Issue 7". Coordinates with [#298](https://github.com/mimukit/saasaloy/issues/298) and [#301](https://github.com/mimukit/saasaloy/issues/301).

## Context

PrimeShopr took its base from CLI 0.5.0 through 0.6.1 to 0.8.0 (PrimeShopr issue #106, PR #107). The 0.8.0 update became an 8-phase plan with 76 writes and 81 hand merges. The evidence is in `/home/dev/projects/primeshopr`: `docs/research/0003-research-saasaloy-0-8-0-update-2026-10-27.md`, `docs/plans/0024-plan-saasaloy-0-8-0-update-2026-10-27.md`, and commits `b410361` and `1e42717`.

Four faults in the CLI caused most of that work:

1. **Missing aliases.** `update --dry-run` stopped with exit 2: `Unknown alias "@config" in target "@config/sections/auth.ts"`. The base template declares `@env` and `@config` in its `saasaloy.json`, but `_saasaloy-base.json` lists `saasaloy.json` as a seed file, so `update` never writes it. A project made before those aliases existed never gets them. The owner added both by hand.
2. **Deleted files come back.** The 0.6.1 update dropped five demo blocks (`audience`, `logo-cloud`, `pain-points`, `pricing-table`, `showcase`). Their `managed` entries stay in `.saasaloy/manifest.json`, so `classifyUpdate` in `packages/cli/src/lib/updater.ts` returns `restore` on every run, and `missingBaseTargets` in `lib/base.ts` keeps the base row `outdated`. `--resolved` refuses a `restore`, and `remove` takes modules only, so no command lets the owner keep a file deleted.
3. **Two-way base merges.** `baseUpdateInput` passes `noMergeBase: BASE_NO_MERGE_BASE` ("the previous version isn't on disk"), so every drifted base file renders as theirs against mine. PrimeShopr's base was recorded at 0.5.0, and all 43 base merges were two-way. For `payments.tsx` the agent rebuilt a base by hand.
4. **A shared prerequisite planned twice.** Each `ModuleUpdatePlan` carries its own `prereqPlan` (`planOneModule`, `updater.ts:940`). Two updated modules that both start to depend on `shell` each plan the `.claude/skills/saasaloy-shell` link, and the second link refuses with exit 2. The owner ran `saasaloy add shell` first.

Two more findings sit beside these, and the grill moved both to their own issues. Every PrimeShopr lock entry records `"ref": "main"`, so an update moves to whatever `main` holds, not to the release the CLI was built for. And managed-file fixes the owner wants to send upstream (`apps/admin/src/components/commands.ts`, `client-admin-guard.ts`) have no path out of the project.

Goal: an owner who skips releases runs one `saasaloy update` and gets a merge plan that holds only real merges.

Target: an update from a 0.5.0 base project to the current release runs with no alias error, keeps a deleted block deleted, and renders every drifted base file three-way. The release smoke checks all three (Phase 6).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where a missing alias comes from | The bundled template's `saasaloy.json` `aliases`, plus every scaffold alias the run's module revisions and prerequisites declare. `planOneModule` already builds `aliasView` from module scaffolds; the base aliases join that view for every module in the run, including `update <module>` runs that leave the base out. |
| What `update` does with an alias | Add a key the project does not have. Never change the value of a key the project has; a different value prints one warning line and the project value stays. Written to `saasaloy.json` only when the run applies, and shown in the dry run. |
| Shared prerequisites in one run | `buildUpdatePlan` merges the new prerequisites of every module into one install plan, run once before the first module, so a skill link, a file, and a lock entry are planned once. `executeUpdatePlan` runs the merged plan in place of each `mod.prereqPlan`. |
| A link the same run already planned | Not a conflict. `planLinks` treats a link this run creates, or a correct link already on disk, as `exists`. |
| Test approach | Unit tests with vitest beside the source (`updater.test.ts`, `base.test.ts`, `update.test.ts`), as the CLI already does. The end-to-end check extends `scripts/release-smoke.ts`, which already smokes an upgrade from the previous CLI. |
| Tombstone format (grill Q1) | `managed[target].deleted: true` in `.saasaloy/manifest.json`. The entry keeps `module`, `from` and the last hash. Not the lock: the lock holds no file entries, and ADR 0012 keeps it the record of what resolved. Example: `"packages/ui/src/blocks/showcase.tsx": { "module": "base", "from": "packages/ui/src/blocks/showcase.tsx", "hash": "…", "deleted": true }`. |
| Base snapshot source (grill Q2) | The git tag `v<version>` in `mimukit/saasaloy`, path `packages/cli/templates/base`, fetched through giget with the module fetch's auth, timeout and offline hint. A new ADR records it and amends ADR 0032's "never a network fetch". An on-disk cache under `.saasaloy/` may come later. |
| Snapshot version (grill Q16) | `--from <version>` when given; otherwise `adoptedAt` on a first update after adoption; otherwise `lock.base.templateVersion`; otherwise `lock.base.cliVersion`. Two-way is only the fallback. |
| Snapshot hash check (added in the build, 2026-11-04) | Unless `--from` names the version, the snapshot must hash to `lock.base.templateHash`, or the run takes the two-way path. An applied run that leaves a base merge waiting moves `cliVersion` (#298) and writes the optional `templateVersion` (the release the hash came from) in `saasaloy-lock.json`, so the re-run stays three-way. A clean base update drops the field. |
| Snapshot fetch failure (grill Q9, default) | Use the two-way path, put the reason on the base section header, and keep the exit code. An unknown or `0.0.0` version takes the same path. |
| Snapshot render (grill Q12, default) | Render the old template with the running CLI's `renderTemplate` and the project's vars, so both sides of the diff render alike. A test covers the v0.5.0 template. |
| Snapshot source under `SAASALOY_REGISTRY_DIR` (grill Q13, default) | Still `mimukit/saasaloy`, because the base is not under `modules/`. Tests set a new `SAASALOY_BASE_SNAPSHOT_DIR`, a folder of `<version>/` template copies. |
| A tracked file missing from disk (grill Q3) | The first time, the new `deleted` verdict sends it to the merge plan as "deleted locally" and the run exits 3. `update --resolved <path>` writes the tombstone. This replaces decision 6 of the update plan ("tracked but missing, put it back"). |
| Undo a tombstone (grill Q7, Q14) | `update --restore <path>` writes the current file and drops the tombstone. A path with no tombstone refuses with exit 2 and writes nothing. The `--abort` help changes to "put back the files the last update replaced". |
| `doctor` and a tombstone (grill Q15, default) | An info line "deleted, kept deleted", with no change to the exit code. |
| Alias with a different value (grill Q8, default) | Keep the project value and print one warning line. |
| Where the merged prerequisite plan lives (grill Q10, default) | One top-level `UpdatePlan.prereqPlan`, run once before the first module. |
| Split with #298 and #301 (grill Q4) | #312 adds the staged recipe to the `saasaloy-update` skill #298 wrote and leaves note selection alone. #312 merges new prerequisites only; #301 keeps moving an already-installed `dependsOn` and builds after #312, from the merged `prereqPlan`. |
| Module refs pinned to the release tag, and the release order (grill Q5, Q11) | Out of #312. A new issue with its own ADR, because it reverses CONTRIBUTING.md's "a module change reaches users the moment it merges". The release order (release-it 21 runs `npm` before `git`) is decided there. |
| Upstream diff command (grill Q6) | Out of #312. A new issue for `saasaloy diff <path>`. |
| Outward actions (grill Q17) | Approved: file the tag-pin issue and the `saasaloy diff` issue as `needs-planning`, comment on #301, and write the settled decisions into the #312 body. No commit or push unless the owner asks. |
| Docs that move | A new ADR records the base snapshot source and the tombstone, and amends ADR 0032 ("never a network fetch") and decision 6 of the update plan ("tracked but missing, put it back"). The `saasaloy-update` skill in `packages/cli/templates/base/_agents/skills/saasaloy-update/` takes the staged-update recipe and the deletion commands. |

## Approach

Fix the four CLI faults in the update engine and reuse what it already has: the three-way classifier (`classifyUpdate`), the `ModuleUpdateInput.base` slot, giget through `RemoteRegistrySource`, and `--resolved` as the verb an agent uses to settle a merge item.

Rejected alternatives, one line each:

- **Snapshot the rendered base under `.saasaloy/` at `init` and `update`** (ADR 0032's named path). It helps only projects made after it ships; the acceptance case is a 0.5.0 project. It can still come later as an offline cache.
- **Fingerprint the project against every historical template.** ADR 0032 already rejected this; the lock names the version, so no guess is needed.
- **Make `saasaloy.json` a managed base file.** The CLI rewrites it on every `add`, so it drifts on day one and every update sends it to the merge plan.

### Phase 1: Add missing aliases on update (built 2026-11-04)

- `baseUpdateInput` reads `aliases` from the rendered template's `saasaloy.json` and puts them on the base descriptor's scaffold, so the base input declares them like a module scaffold does.
- A helper `templateAliases(templateDir)` in `lib/base.ts` serves runs that do not update the base.
- `buildUpdatePlan` passes the base aliases into every `planOneModule` alias view.
- The plan carries `aliasAdds` (key, value) and `aliasKept` (key, project value, template value). The dry run prints both. `executeUpdatePlan` writes `aliasAdds` to `saasaloy.json` before it writes the first file, with `saveConfig`.
- Tests: a project with no `@config` updates a module whose file targets `@config/...` with no `Unknown alias` error; an existing `@ui` with a different value stays and warns once.

Done when: `updater.test.ts` has a case where an `auth`-style target `@config/sections/auth.ts` resolves on a project whose `saasaloy.json` lacks `@config`, and the applied run's `saasaloy.json` holds `"@config": "packages/config/src"`.

### Phase 2: Plan a shared prerequisite once (built 2026-11-04)

- `buildUpdatePlan` collects `prereqs.order` from every input, drops duplicates and anything already installed, and builds one `Plan` with `buildPlan`.
- `UpdatePlan` gets `prereqPlan` at the top level; `ModuleUpdatePlan.prereqNames` stays for the summary lines. `executeUpdatePlan` runs the top-level plan once, first.
- `planLinks` returns `exists` for a link this run already plans.
- Tests: two modules that both add `shell` as a new `dependsOn` give one `saasaloy-shell` link, one lock entry, and exit 0.

Done when: an `update.test.ts` case with two modules that add the same prerequisite applies with exit 0 and the manifest's `links` lists `.agents/skills/saasaloy-shell` once.

### Phase 3: Three-way base merges from the recorded release (built 2026-11-04)

- A new `fetchBaseSnapshot(version)` in `lib/base.ts` downloads `packages/cli/templates/base` at the tag `v<version>` through giget into a temp dir, with the same auth, timeout, `SAASALOY_GITHUB_API` fixture hook, and offline hint as `RemoteRegistrySource.readModule`.
- `baseUpdateInput` renders the snapshot with the project's vars (`renderTemplate`) and passes it as `input.base`, so `classifyUpdate` runs three-way and `base === theirs` skips a file the template did not change.
- The snapshot version is `--from <version>` when given, else `adoptedAt` on the first update after adoption (`isFirstUpdateAfterAdoption`), else `lock.base.cliVersion`.
- No snapshot means the current two-way path, with a reason on the section header: an unknown or `0.0.0` version, or a fetch failure. `SAASALOY_BASE_SNAPSHOT_DIR` points tests at local `<version>/` copies.
- A new ADR records the snapshot source and the tombstone, and amends ADR 0032.
- The merge plan renders base sections with the base-to-theirs and base-to-mine diffs that module sections already have (`lib/merge-plan.ts`).
- Seed files and `ownedFiles` keep their rules. An owned file that the template did not change between the snapshot and now is a `skip`, not a merge.

Done when: a `base.test.ts` fixture with a template at two versions classifies an untouched-upstream drifted file as `skip` and a changed-upstream drifted file as `drift` with `base` set, and the rendered merge plan for the second shows a three-way diff with no "no merge base" header.

### Phase 4: Keep a deleted file deleted (built 2026-11-04)

- A tracked file missing from disk no longer gets `restore` when its module ships it unchanged or changed. The classifier returns a new verdict `deleted`. The first time, it goes to the merge plan as "deleted locally" with the upstream diff, and the run exits 3.
- `update --resolved <path>` on a `deleted` item writes `deleted: true` on the `managed` entry and writes no file. `update --restore <path>` writes the current file and drops the flag; a path with no tombstone refuses with exit 2. The `--abort` help changes to "put back the files the last update replaced".
- `schemas/manifest.schema.json` allows the optional `deleted` boolean on a `managed` entry.
- A tombstoned file never returns to the merge plan. When upstream changes it, the summary prints one line, `kept deleted  <path>  (upstream changed it)`. When upstream drops it, the tombstone goes. `remove <module>` drops that module's tombstones.
- `missingBaseTargets` skips tombstoned targets, so `compareBase` and `outdated` read the base as current.
- `adoptBase` stops recording absent template files at their rendered hash. An absent file then classifies as `create`, which is the same result the `restore` gave.
- `doctor` lists tombstoned files as "deleted, kept deleted".

Done when: an `update.test.ts` case deletes a base block, runs `update --resolved <path>`, then runs `update` against a template that changed the block, and the file is still absent, the run exits 0, and `outdated --check` exits 0.

### Phase 5: The staged-update recipe (built 2026-11-04)

- The `saasaloy-update` skill gets a section for a skipped-release update: run `update --dry-run`, read the alias and prerequisite lines, update the breaking module alone with `update <module>` when its notes say so, then the rest, then `pnpm check`.
- The skill names `--resolved` for a deleted file and `--restore` to undo it.
- Each update note stays the place for a per-release step; the recipe links to the update notes section and repeats none of them.

Done when: `scripts/skills.test.ts` passes and the skill names `update --restore` and `update --resolved` for the deleted-file case.

### Phase 6: Acceptance smoke from a 0.5.0 base (built 2026-11-04)

- `scripts/release-smoke.ts` gets a case that scaffolds a project with CLI 0.5.0 from npm, deletes one demo block, and runs the packed CLI's `update`.
- The case asserts no `Unknown alias` in the output, a merge plan with the deleted block as "deleted locally", `--resolved` on it, and a second `update` that keeps it absent.
- It asserts no base section in the merge plan carries the "no merge base" header.

Done when: `pnpm release:smoke` passes with the 0.5.0 case, and its log shows the three assertions.

## Migration and rollback

The tombstone is a new optional field, `deleted`, on a `managed` entry in the committed `.saasaloy/manifest.json`. An older manifest reads as "no tombstones" and needs no migration. An older CLI that meets the field fails schema validation, because `schemas/manifest.schema.json` sets `additionalProperties: false` on an entry; the downgrade refusal in ADR 0032 already stops an older CLI on a newer base record, and the field ships in the same release. To roll back a project, run `update --restore <path>` or delete the field; the next update then plans those files as `deleted` again.

The base record in `saasaloy-lock.json` takes an optional `templateVersion` on the same terms: an older lock reads as "`cliVersion` is the template's release", and an older CLI refuses a lock that carries it, because the base schema sets `additionalProperties: false`.

Alias writes change `saasaloy.json`, which is committed. A rollback is `git checkout saasaloy.json`.

## Open questions

None. The grill on 2026-11-04 settled questions 1 to 7 and kept the defaults for the rest; see Design decisions. One check stays for the build: the snapshot fetch adds one GitHub tarball request per base update, and `authToken()` already reads `GITHUB_TOKEN` for CI.

## Non-goals

- Moving an installed `dependsOn` module with `update <module>` (#301).
- Update note selection or rendering (#298).
- A new command that removes one managed file outside `update`.
- Rebuilding a merge base for a module whose old SHA is gone (a force-pushed branch keeps the two-way path).
- Pinning module refs to the release tag, and the npm and tag order in the release job (a new issue).
- A `saasaloy diff <path>` command to send a managed-file change upstream (a new issue).
