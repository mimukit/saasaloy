# Plan: track and update the base template

Grilled: 2026-09-06

## Context

A project scaffolded by `saasaloy init` gets the base template as a pure copy. `init` writes no manifest entry, no lock entry, and no version stamp for what it copied (ADR 0022, `packages/cli/src/commands/init.ts:36`). The consequence shows up the first time an owner comes back to the project:

```
$ saasaloy doctor .    → Checked 0 installed modules / No modules installed.
$ saasaloy outdated    → Nothing installed — `saasaloy add <module>` first.
$ saasaloy update      → Nothing to do / Nothing installed.
```

Nothing is broken. `packages/cli/src/lib/saasaloy-config.ts:48` (`migrateBase`) lifts the legacy `web` entry out of `installed[]` into the `base` field, so a project that added no modules has an empty `installed[]` and every command truthfully reports that. The gap is that the base itself — three workspaces, the lint and hook toolchain (ADR 0023), the design contract (ADR 0027), the shipped agent skills — is the largest body of code the tool generates and the only body it cannot update.

The base is bundled inside the CLI package at `packages/cli/templates/base` and rendered through `copyTemplate` (`packages/cli/src/lib/scaffold.ts`). So base drift is a **CLI-version** question, not a commit-SHA question. That is what makes it a different problem from module drift and why it cannot ride the existing lock rows unchanged.

Success means: on a project scaffolded by an older CLI, `saasaloy outdated` names the base and the version gap, `saasaloy update` applies the base changes the owner has not overwritten and routes the rest to a merge plan, and `saasaloy doctor` reports which base files drifted.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| How far tracking goes | Full tracking and merge. `init` records every rendered base file's hash; `update` classifies each one with the existing `UpdateFileAction` vocabulary and routes drift to the merge plan. A version-only report would tell an owner a number and leave them to diff by hand. |
| Where provenance lives | `saasaloy-lock.json` gains a `base` object beside `modules`. The lock is already "what resolved" against `saasaloy.json`'s "what was asked for" (ADR 0012), and a template version is resolved state. `saasaloy.json`'s `base` stays the plain name string, so `SaasaloyConfig` is untouched. |
| What the base's provenance is | `{ name, cliVersion, templateHash }`. `templateHash` is the signal `outdated` compares: a sha256 over the sorted `(path, hash)` pairs of the template as shipped, so two CLI builds with an identical template compare equal and a republished version is still detected. `cliVersion` is a label printed beside it. The CLI package is at `0.0.0` with no publish workflow, so a version compare would never turn the row red; the hash works today and after a release process exists. |
| Merge base for the three-way | None. The old template lives inside the old CLI package, which is not on disk and not on npm. `update` already has a `noMergeBase` path (`updater.ts:350`, `ModuleUpdateInput.noMergeBase`) that renders a two-way merge plan, and the recorded per-file hashes still separate a clean overwrite from real drift. A true three-way base is a non-goal (see below). |
| Hashes are of rendered bytes | `copyTemplate` substitutes `{{PROJECT_NAME}}` and `{{CLI_VERSION}}`. The manifest records the hash of what landed on disk, and `update` renders the new template with the same vars before comparing. Hashing template source would mark every substituted file as drifted forever. |
| Seed files are not managed | The base ships files an owner is meant to rewrite: `DESIGN.md`, `README.md`, and the landing copy. `AGENTS.md` is managed, not seed: an untouched copy overwrites cleanly and an edited copy goes through the standard drift path, so the shipped agent rules keep updating. A new `_saasaloy-base.json` inside the template declares seed files as an explicit path list, never globs, so a test can assert each one exists. `copyTemplate` skips the declaration by exact name before its `_` to `.` rename. Seed files are recorded in the manifest but excluded from base updates and from `doctor` drift; `doctor` lists them as "seed, not checked". |
| Owning module name | Base files are recorded in `.saasaloy/manifest.json` under the reserved module name `base`. `ManagedEntry` already carries `module` and `from`, so the manifest shape does not change. Every engine that iterates `config.installed` keeps ignoring it, because `base` is not in that list. |
| Migration for an unrecorded project | Adopt at the running CLI, and only `update` writes. `outdated` and `doctor` are read-only: on a project with no `base` lock entry they report the base as `untracked` and point at `saasaloy update`; `outdated --check` does not fail on it, so a CI checkout stays clean. `update` on an untracked project hashes the base files as they stand, writes the manifest entries and the lock record at the current CLI, reports "adopted N files at CLI X", and stops; the next run is a real update. `update --dry-run` prints the same report and writes nothing. A lock `base` record with no manifest `base` entries counts as untracked and re-adopts. Adoption skips at most one generation of base changes and never manufactures a wall of false conflicts on a customised project. |
| `doctor` scope | `doctor <project>` gains a Base section: the base name, its recorded CLI version, `untracked` when no record exists, which managed base files no longer match their recorded hash, and the seed files as "seed, not checked". |
| Base overwrite of a module-patched file | Overwrite, then re-apply every `manifest.patches` entry whose `file` is that base file, through the idempotent re-apply loop `executeUpdatePlan` already runs for a module's own patches (`updater.ts:772`). A patch that no longer matches demotes the file to `drift` and it enters the merge plan. `patchedBy` (`updater.ts:587`) names the patchers in the plan either way. |
| Downgrade | Refuse when the recorded `cliVersion` is a valid semver higher than the running one: name both versions and tell the owner to upgrade the CLI. No override flag; `--yes` keeps its one meaning. An `unknown-version` build skips the check, as `cli-requires.ts` does. With every build at `0.0.0` the check compares equal and the hash path runs. |
| The merge plan is the deliverable for drift | Base drift enters the same agent-consumable Markdown that `renderMergePlan` (`lib/merge-plan.ts`) writes for modules, to stdout or `--out <path>`. Each drifted base file carries a unified diff from the current file to the new template render and the intent line "the base template changed; keep local edits, take the upstream change". The section header states the `noMergeBase` reason. `--diff` prints the same diff to the terminal. AI agents do the reconciling, so this document, not a terminal summary, is the output that matters. |
| `templateHash` computation | Runtime, on demand, cached per process. The template is about 50 files and the walk is milliseconds, and a runtime hash cannot drift from the files. `init` computes it once at scaffold time; the read commands compute it only when they look at the base. |
| Decision record | A new ADR: the base carries provenance and updates through the module path. It links to ADR 0022 and leaves it intact. |

## Approach

Reuse over new code, in three places. The classification engine is `buildUpdatePlan`/`executeUpdatePlan` in `packages/cli/src/lib/updater.ts` and its `UpdateFileAction` set — base files get the same ten verdicts, not a parallel vocabulary. The hash-and-track record is `.saasaloy/manifest.json` and `ManagedEntry` from `packages/cli/src/lib/manifest.ts`, unchanged in shape. The report renderer is `renderComparisons` in `packages/cli/src/commands/outdated.ts` and `renderMergePlan` in `packages/cli/src/lib/merge-plan.ts`; the base is a row and a section, not a second report.

### Phase 1: record the base at init

- Add `_saasaloy-base.json` to `packages/cli/templates/base`, declaring `seedFiles` as an explicit path list: `DESIGN.md`, `README.md`, and the landing copy. `copyTemplate` skips it by exact name, before the `_` to `.` rename. A test asserts every listed path exists in the template.
- Extend `copyTemplate` (`lib/scaffold.ts`) to return each written file's project-relative path and the sha256 of its rendered bytes. It already returns the written paths.
- Add `lib/base.ts`: `templateHash(dir)`, `readBaseDeclaration(dir)`, `emptyBaseRecord()`, and the manifest-writing helper.
- `runInit` writes `.saasaloy/manifest.json` with one `managed` entry per base file (`module: "base"`, `from` set to the template-relative source path) and `saasaloy-lock.json` with the `base` record.
- Widen `packages/cli/schemas/saasaloy-lock.schema.json` and `Lockfile` in `lib/lock.ts` with the optional `base` object. Optional keeps every existing lock valid.
- File a new ADR: the base carries provenance and updates through the module path. Link ADR 0022 and leave it unchanged.

### Phase 2: adopt an unrecorded project

- `lib/base.ts` gains `adoptBase(root, cliVersion)`: hash the base files present on disk against today's template file list, write the manifest entries and the lock `base` record, and return what it adopted.
- Only `update` calls it. On an untracked project `update` adopts, prints "adopted N base files at CLI X; run `saasaloy update` again to apply changes", and exits 0 without applying. `update --dry-run` prints the same and writes nothing.
- `outdated` and `doctor` never write. With no record they report the base as `untracked` and point at `saasaloy update`. `outdated --check` does not exit 2 for `untracked`.
- A lock `base` record with no manifest `base` entries is `untracked` and re-adopts.
- A base file the template no longer ships is not recorded. A template file missing from disk is recorded as absent, so the next update restores it.

### Phase 3: the base row in `outdated`

- Add a `compareBase` function beside `compareInstalled` in `lib/updater.ts`, comparing the lock's `templateHash` against the running CLI's, computed at runtime and cached per process. Statuses reuse `UpdateStatus` plus a new `untracked`: `current`, `outdated` (hash differs), `local` (a `SAASALOY_REGISTRY_DIR`-style template override), `untracked` (no record).
- `runOutdated` renders the base as the first row of the existing table, with `REF`/`CURRENT`/`LATEST` carrying the recorded and running `cliVersion` as labels beside the hash verdict. `short()` already passes a non-SHA value through unchanged.
- `countDrift` counts an outdated base, so `--check` gates on it. `untracked` is not drift.
- Replace the empty-state string: with a recorded base, "Nothing installed" is only ever about modules.

### Phase 4: apply the base in `update`

- Refuse first when the recorded `cliVersion` and the running one are both valid semver and the recorded one is higher: print both versions and "upgrade the CLI", exit non-zero, write nothing. No override flag. Print one line when the versions differ in either direction so the owner sees which way they moved.
- Render the bundled template to a temp dir with the project's own vars, producing `theirs`.
- Build a `ModuleUpdateInput`-shaped entry for the base with `base: undefined` and `noMergeBase: "the template ships with the CLI; the previous version isn't on disk"`, then let the existing classifier run: hash match → `overwrite`, hash mismatch → `drift` → merge plan, new file → `create`, dropped file → the `delete*` family.
- After an `overwrite` of a file that `manifest.patches` names, re-apply every patch entry for that file through the existing idempotent re-apply loop. A patch that no longer matches demotes the file to `drift`. `patchedBy` names the patchers in the plan.
- The merge plan is the deliverable. Each drifted base file renders through `renderModule` with a unified diff from the current file to the new render and the intent line "the base template changed; keep local edits, take the upstream change". The base section header carries the `noMergeBase` reason. `--out <path>` and `--diff` work as for modules. Tests assert the document renders for base drift and that an agent-readable intent line is present.
- Skip every declared seed file.
- Root `package.json` pin bumps the new template introduces reuse `planDeps`/`DepBump` rather than a new path.
- On a clean run, rewrite the base manifest entries and the lock `base` record. On a merge run, leave both untouched, exactly as module updates do.
- `saasaloy update base` targets the base alone; the bare run does base and modules together.

### Phase 5: `doctor`, docs, and tests

- `lib/doctor.ts` gains a base check: record present or `untracked`, recorded version, per-file drift against recorded hashes for managed files, and seed files listed as "seed, not checked". It writes nothing.
- Unit tests per phase against a temp project, offline: adopt-then-stop, dry-run adopts nothing, untracked in `outdated` and `doctor` without a write, current, outdated-clean, outdated-with-drift, patched-file re-apply, seed-file-excluded, downgrade refusal, `--check` exit 2 and exit 0 on `untracked`.
- One end-to-end pass in `.dev`: scaffold with the current CLI, hand-edit one base file, bump the template, run `outdated` then `update`.
- Update `wiki`/`CONTRIBUTING` command docs and the `outdated`/`update` command help text.

## Open questions

None. Every question the first draft listed is settled in the table above.

## Non-goals

- Updating module files. That path exists and works; this plan only adds the base beside it.
- Fetching the base from the git registry. The base ships in the CLI package and stays there.
- A true three-way merge base. The CLI is not on npm, so there is no old package to fetch. If one is ever wanted, the path is a copy of the rendered template under `.saasaloy/` written at `init`, not a network fetch.
- A version-ordered "outdated" verdict. The hash says "different", not "older". The downgrade guard uses `cliVersion` only when both sides carry a real semver.
- Auto-resolving base merge conflicts. Drift produces a merge plan document for a human or an agent, the same as a module.
- Retrofitting provenance onto a project by fingerprinting it against every historical template version. Adoption records the present, not the past.
- Changing how `saasaloy.json` expresses intent. `base` stays a name; the lock holds the resolved state.
