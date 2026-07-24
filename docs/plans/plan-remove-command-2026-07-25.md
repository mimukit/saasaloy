# Plan — `saasaloy remove` (undo applied files via manifest)

*Drafted 2026-07-25. Issue #27 (all phases); follow-up reverse-patching: #36. Context: plan-remote-module-registry-2026-07-23.md §9.*

Grilled: 2026-07-25

## Context

`saasaloy add` records every file it drops in `.saasaloy/manifest.json` (path → `{module, hash}`),
precisely so an undo can exist — but no undo exists. Once a module is applied, backing it out means
hand-deleting files and hand-editing three state files. `saasaloy remove <module>` closes the loop:
delete exactly the files the manifest attributes to the module, protect anything the user
hand-edited since, and reconcile `saasaloy.json`, `saasaloy-lock.json`, and the manifest.

The key structural fact (verified in the code): **at remove time the module descriptor is not
available locally** — remote modules extract to a temp dir that `add` cleans up. Everything `remove`
does must therefore derive from the three local state files. This works because they were designed
for it: the manifest attributes every managed file and skill link to its owning module, and the lock
records each module's `dependsOn` "so the resolved graph is self-describing"
(`packages/cli/src/lib/lock.ts`).

Success = in a `.dev` playground: `saasaloy add auth` then `saasaloy remove auth` deletes the
module's files and skill links and nothing else, drops it from `installed[]` and the lock, warns on
a hand-edited file instead of deleting it, and refuses when an installed module still `dependsOn` it.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Offline by construction | **No network, no descriptor refetch.** The remove plan derives entirely from `manifest.json` (files + links + patches), `saasaloy.json` (`installed[]`, aliases), and `saasaloy-lock.json` (`dependsOn`). |
| Architecture | **Mirror the applier split.** New `lib/remover.ts` with pure `buildRemovePlan` → `executeRemovePlan` (same shape as `buildPlan`/`executePlan` in `applier.ts`), unit-tested like `applier.test.ts`. New `commands/remove.ts` mirroring `add.ts`'s clack UX (intro/summarize/confirm/outro, strict unknown-flag rejection); registered in `index.ts`. |
| File classification | For each `manifest.managed` entry owned by the module, re-hash the on-disk file: **`delete`** (hash matches manifest → safe), **`drift`** (exists, hash differs → hand-edited, held for confirmation), **`missing`** (already gone → nothing to delete, just untrack). Files the manifest doesn't attribute to the module are untouched by construction. |
| Drift handling | Interactive run: per-file `confirm` before deleting a drifted file. Declined — or any drifted file under `--yes` (non-interactive never destroys hand-edited content) — means the file **stays on disk but is untracked**: its manifest entry is dropped, so it becomes user-owned (classifies as `conflict` on a future re-add, same as any untracked file). |
| Drift survivors & exit code *(grilled)* | Drift survivors are the designed outcome, not a failure: **exit 0**, with the surviving files listed in the outro summary. No `--strict` flag. |
| Dependents check | Build a reverse-dependency map over `config.installed` from `lock.modules[*].dependsOn`. If any installed module depends on the target, **refuse with the dependents named**; `--force` overrides. If an installed module has no lock entry, log a warning that dependent detection is incomplete for it. No cascade removal. |
| Skill links | Attribute each `manifest.links` entry to **whichever module owns files under its target** (the manifest re-attributes overwritten files to the last writer, so this is always current; the `saasaloy-<module>` folder convention makes collisions unlikely anyway — verified across `modules/`). Remove the `.claude/skills/<name>` symlink only when `classifyLink` says `correct`; a `conflict` link is left untouched with a warning (symmetric with `add`). Drop the `links` entry either way. |
| Empty-dir pruning | After deletion, prune ancestor directories that became empty, walking up until the first non-empty dir, never past the project root. A removed capability's scaffolded workspace (`apps/api/`) disappears cleanly instead of leaving a husk. Only dirs emptied by this run's deletes are candidates. |
| Dangling aliases *(grilled)* | After pruning, **drop any `saasaloy.json` alias whose prefix directory no longer exists**, with a logged note per alias. A dangling alias would let a future `add` silently recreate a half-workspace; dropping it makes the future `resolveTarget` fail loudly (`Unknown alias`) instead. |
| Patch tracking *(grilled)* | **Fold add-side patch recording into #27.** The manifest gains `patches: { module, file, patch }[]` (schema bump in `manifest.schema.json` + `manifest.ts` defaults; dedupe identical entries on re-apply). `executePlan` records each applied patch. `remove` **does not reverse patches** — it drops the module's patch entries and **warns, naming each patched file** so the user can hand-revert. Actual reversal is a follow-up issue; update the `applier.ts` comment that points reverse-patching at #27 accordingly. |
| State reconciliation | Drop the module from `config.installed`, delete `lock.modules[name]`, and drop its manifest `managed`/`links`/`patches` entries. Persist all three files in a `try/finally` around `executeRemovePlan` (same rationale as `add`: the ledger must reflect whatever actually happened even on a mid-run failure). |
| Flags & UX | `saasaloy remove [<module>] [--dry-run] [--diff] [--yes|-y] [--force]`, consistent with `add`. Bare `remove` → clack `select` over `config.installed`. `--diff` renders each to-be-deleted file as an all-red `lineDiff` (reusing `renderDiff`'s cap). `--dry-run`/`--diff` preview and write nothing. |

## Approach

### Phase 1 — Manifest patch tracking (add side)

- `manifest.ts`: add `patches: ManifestPatch[]` (`{ module, file, patch }`) with load/save defaults;
  bump `schemas/manifest.schema.json` to match.
- `applier.ts` `executePlan`: record each patch that applied (`patched[]`) into
  `manifest.patches`, deduping identical entries so `--force` re-apply stays idempotent. Update the
  `PlannedPatch` comment to point reversal at the follow-up issue instead of #27.
- Extend `applier.test.ts` for the recording + dedupe behavior.

### Phase 2 — Remover library (`packages/cli/src/lib/remover.ts`)

- `buildRemovePlan({root, name, config, manifest, lock})`:
  - Collect the module's `manifest.managed` entries; classify each as `delete`/`drift`/`missing`
    by re-hashing disk content (`hashContent`, `pathExists` from `fs-utils.ts`).
  - Compute dependents from `lock.modules[*].dependsOn` ∩ `config.installed`; flag installed
    modules missing from the lock.
  - Collect the module-owned `manifest.links` entries (by file attribution) and classify each
    symlink via `classifyLink`; collect the module's `manifest.patches` entries (report-only).
  - Emit the candidate dir set for empty-dir pruning.
- `executeRemovePlan(plan, root, config, manifest, lock)`:
  - Delete `delete`-class files and confirmed drifted files; drop manifest entries (including
    declined drift → untrack only); remove `correct` symlinks and their `links` entries; drop the
    module's `patches` entries; prune empty dirs; drop aliases whose prefix dir vanished; update
    `config.installed` and `lock.modules`.
- Unit tests (`remover.test.ts`, mirroring `applier.test.ts` fixtures): clean removal, drift
  detection, missing file, dependent refusal + missing-lock-entry warning, symlink conflict left
  untouched, prune + alias-drop behavior, patch-entry drop + warning, untouched unmanaged files.

### Phase 3 — Command surface

- `commands/remove.ts`: arg parsing (strict unknown-flag rejection, same pattern as `add.ts`),
  module picker for bare `remove`, plan summary note (delete/drift/missing counts per file, like
  `summarizePlan`), dependents refusal message naming the blockers, unreversed-patch warning naming
  each patched file, `--diff` rendering, per-file drift confirms, `try/finally` persistence, outro
  with removed-file count and drift survivors (exit 0).
- Register `remove` in `index.ts` `COMMANDS` with a describe line.

### Phase 4 — QA + docs

- Manual QA in `.dev` (per AGENTS.md convention): `add auth` → `remove auth` clean round-trip;
  hand-edit a managed file → `remove` warns and preserves on decline and under `--yes`; `remove`
  a capability another installed module depends on → refused, `--force` proceeds; capability
  removal prunes the workspace and drops its alias; patched-file warning appears; `--dry-run`
  and `--diff` leave disk untouched.
- Verify each issue acceptance criterion; update README/help output where the command list appears.
- Follow-up issue filed: reverse config patches on `remove` using the now-tracked
  `manifest.patches` (#36).

## Open questions

None — all resolved in the 2026-07-25 grill (see *(grilled)* rows above).

## Non-goals

- Reversing config patches (`wrangler-binding`, `plugin-array`) — tracked in the manifest as of
  this issue, reversed in a follow-up.
- Uninstalling npm `dependencies`/`devDependencies` from the root `package.json` — not derivable
  offline (deps aren't in the lock), and other code may use them.
- Cascade removal of dependents, or removing multiple modules in one invocation.
- Unsetting env vars (they were only ever reported, never written).
- Any network access or registry fetch during `remove`.
