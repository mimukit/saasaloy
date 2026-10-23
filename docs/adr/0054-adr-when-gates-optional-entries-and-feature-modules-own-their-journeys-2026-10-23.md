# 0054: `when` gates optional entries, and a feature module owns its journey specs

[ADR 0053](0053-adr-one-testing-mode-in-saasaloy-json-and-a-marked-agents-md-block-2026-10-23.md) put one testing mode in `saasaloy.json`. A mode is only useful if it decides which files a project receives: a project with testing `off` should hold no module test, and one that turns testing on should receive every test its modules ship. A journey spec has the same shape with a different trigger. It belongs in a project only when the `e2e` capability is there to run it. This record settles how a descriptor says "ship this entry only when", what a module that turns testing on declares, and which module ships a feature's journey spec. Issue [#242](https://github.com/mimukit/saasaloy/issues/242) builds it, from `docs/plans/0080-plan-opt-in-testing-2026-10-23.md`.

## Status

accepted. It closes the question [ADR 0051](0051-adr-the-e2e-capability-gates-flows-on-installed-modules-2026-10-23.md) left open, which module ships the flow for a feature module, and amends nothing else in it.

## The decision

- **A descriptor entry takes `when`.** A `files[]`, `scaffolds[].files[]` or `patches` entry may carry `"when": { "testing": true }`, `"when": { "installed": ["<module>"] }`, or both. The keys combine with AND. `testing` holds when the mode is `tests-after` or `tdd`. `installed` holds when every named module is in the resolved install set, which is this run's graph plus what the project already holds. The schema takes `testing: true` and no other value, an `installed` list of at least one name, and no other key.
- **`when` decides the first write only.** An entry whose `when` is false is skipped, and the manifest records nothing for it, so `update` never reports an unwritten file as missing. Once a gated file is in `manifest.managed`, or a gated patch in `manifest.patches`, it stays managed in every mode. Without this rule `testing off` then `update` would delete every clean test file, because the updater removes a managed file the module no longer lists.
- **`when` is asked before `onlyWith`.** `onlyWith` picks which variant of a required target ships, and no match is a refusal. `when` decides whether an optional entry ships, and no match is a skip. A target whose entries `when` drops is skipped, not refused.
- **The manifest records the condition.** `ManagedEntry` and `ManifestPatch` carry the `when` they were written under. A patch keeps `when` inside its recorded op too, so the structural match that dedupes and untracks a patch is unchanged.
- **One backfill step writes what turned true.** It plans every installed module with `buildPlan` and a selector that keeps only gated entries whose `when` is now true and whose target is untracked. It plans no skill link, dependency or env var, because those landed with the module. The collision, ownership and conflict rules apply unchanged, so an untracked file the owner wrote at a target goes to the merge list, never under an overwrite. It reads each module at the SHA in `saasaloy-lock.json`, or from the working copy when `SAASALOY_REGISTRY_DIR` is set, and skips with a warning a module installed from a working copy with no override. It never moves the lock. `saasaloy testing <on-mode>`, `saasaloy add` and `saasaloy update` call it, and a re-run, or `testing <same-mode>`, finishes a partial one ([ADR 0031](0031-adr-re-run-is-recovery-for-a-partial-add-2026-09-03.md)).
- **`remove X` takes what only shipped because X was there.** It also removes every other module's entry whose recorded `when.installed` names X: a clean file is deleted, a drifted file is kept with a warning, a patch with an inverse is reversed, and a patch with none is warned about. The plan names each one with its owner. `add X` backfills them again.
- **A module may turn testing on.** A descriptor with `"enablesTesting": true` turns an `off` project to `tests-after` when `add` applies it. `add` plans with the new mode, so the module's own gated files and every other module's land in the same run. It saves the mode and rewrites the `AGENTS.md` block only after the apply succeeds, prints one line that says so, and backfills. `--dry-run` and `--diff` save nothing. It leaves `tdd` alone, because the owner already chose. `remove` never changes the mode.
- **A file may say why it ships untested.** A `files[]` entry takes `"untested": "<reason>"`. The test guards that later phases of the plan add print the reason rather than fail.
- **`doctor modules` checks every `when`.** Each `installed` name has to be a folder under `modules/`, or the entry can never ship. A `testing` value other than `true` is reported in a sentence rather than as the schema's bare "must be equal to constant".

## Journey spec ownership

- **A feature module ships its own Playwright spec.** It lives at `modules/<module>/files/e2e/<module>-<journey>.spec.ts`, targets `@e2e/specs/`, and carries `when: { installed: ["e2e"] }`. Adding the feature after `e2e` writes it at once; adding `e2e` after the feature backfills it; removing `e2e` removes it.
- **A journey that crosses three or more modules lives in `modules/e2e`.** "Sign up, create an org, subscribe" belongs to no one feature. It may use page objects the feature modules ship.
- **The tag rule in ADR 0051 still holds.** A spec the feature module ships carries its module tags like any other, so the configuration still decides what runs from `saasaloy.json`.

## `e2e` and the mode

`add e2e` turns testing on, and the `e2e` descriptor is the module that will declare `"enablesTesting": true`. This issue ships the field and the behaviour. It does not set the field on `modules/e2e`, because the plan's phase for `e2e` journeys (issue [#245](https://github.com/mimukit/saasaloy/issues/245)) owns that change, together with moving the `waitlist` and `admin-*` specs into their own modules.

## Considered Options

- **Gate on the mode alone.** Rejected: a journey spec depends on a module being present, not on a mode, and a second mechanism for it would duplicate the selection, the manifest record and the backfill.
- **`when` decides every run, not the first write.** Rejected: `testing off` would delete every clean test file at the next `update`, and a project that already holds `auth.test.ts` would lose it.
- **Fold `when` into `onlyWith`.** Rejected: `onlyWith` answers "which variant of a file that must exist", and no match is a refusal. An optional entry with no match is not an error, so the two keys keep their own failure modes.
- **Every journey spec in `modules/e2e`.** Rejected: that module would grow with every feature module and own files it does not maintain.
- **A separate planner for backfill.** Rejected: `buildPlan` with a selector keeps one set of collision and ownership rules.
- **Refuse a backfill when a module was installed from a working copy.** Rejected: that module has no SHA to read, `update` already skips it the same way, and refusing would block every other module's backfill.

## Consequences

- The six module test files that shipped unconditionally (`auth`, `database` twice, `database-d1`, `database-postgres`, `file-uploads`) now carry `when: { testing: true }`. A new project with testing `off` no longer receives them. A project that already holds them keeps them, managed, in every mode.
- The descriptor schema changed, so the CLI version moves to 0.7.0 and the five modules that use `when` declare `requires.saasaloy >=0.7.0`. Every published CLI refuses those modules until 0.7.0 is released.
- `add` reads every other installed module once more for its backfill. A remote module is fetched at its locked SHA, so an `add` on a large project makes more requests than before.
- `update` runs the backfill once per run, after its dirty-tree and terminal checks, with no second confirmation. A preview lists what it would write.

## References

- `docs/plans/0080-plan-opt-in-testing-2026-10-23.md`, rows "A written gated entry stays managed", "Conditional files", "`when` beside `onlyWith`", "The manifest records the condition", "Removing a module a condition names", "Backfill", "Mode change during `add`", "Guard opt-out", "Journey spec ownership" and "`e2e` and the mode".
- [ADR 0026](0026-adr-database-driver-split-2026-08-28.md) and issue #99, where `onlyWith` came from.
