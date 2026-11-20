# 0067: A rendered file is generated, merged or written once

The old engines had three spellings of "the owner rewrites this file": `seedFiles` and `ownedFiles` in the base's `_saasaloy-base.json`, and a module entry's `"seed": true` ([ADR 0060](0060-adr-a-module-file-may-be-a-seed-written-once-2026-11-04.md)). Each one had its own rule for update, restore and remove, and an owned file went to the merge plan on every upstream change. Research 0013 found that 16 files the owner is expected to rewrite gave 118 of the 248 conflicts in the PrimeShopr replay. The new engine ([ADR 0066](0066-adr-one-render-and-a-three-way-merge-replace-the-add-update-and-remove-engines-2026-11-20.md)) needs one answer for each path, so the render gives each file a class. Settled by the owner on 2026-11-20 and in the grill and re-grill of plan [0116](../plans/0116-plan-render-and-merge-engine-2026-11-20.md), questions Q7, Q11 and Q12 and re-grill Q1 to Q4.

**Each rendered file has exactly one class, and one function in `packages/cli/src/engine/classes.ts` decides it.** `generated`: the CLI writes the file in full on every run. An owner edit refuses the run with exit 2 and names the file, and `--force` overwrites it. `merged`: a three-way merge of the old render, the new render and the disk, by line for text and by key for `package.json`, `wrangler.jsonc`, `tsconfig.json`, `turbo.json` and `saasaloy.json`. `once`: written when the path is new, then left alone. **`seedFiles` and `ownedFiles` in `_saasaloy-base.json` and a module entry's `seed: true` all map to `once`.** Every other file is `merged`. Nothing is `generated` until the registration tables move into generated files (plan 0116, Phase 7).

Three exceptions are `merged` although the declaration names them. `saasaloy.json` merges by key, so the module aliases and the `installed` list stay true and an owner's own alias survives. `packages/env/.env.example` merges three ways, so the owner's values stay, a new module's keys arrive, and a removed module's unedited keys go. Phase 6 removes both from `seedFiles` and `ownedFiles`. The four owned files that hold a registration table, `packages/env/src/services.ts`, `packages/env/src/sources.ts`, `packages/tooling/src/targets.ts` and `packages/ui/src/blocks/navbar.tsx`, are `merged` by an interim rule in `classes.ts`, so `add` can register a module in them. Phase 7 moves each table to a generated file, drops the rule, and makes the rest of each file `once`. The branch merges after Phase 7, so the interim class never ships.

## Status

accepted. Amends [ADR 0060](0060-adr-a-module-file-may-be-a-seed-written-once-2026-11-04.md): a module seed is a `once` file, and the base's `seedFiles` and `ownedFiles` take the same class. Amends the `ownedFiles` half of [ADR 0034](0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md): an owned file that exists no longer goes to a merge on each upstream change.

## Considered Options

- **Keep owned files on the merge path.** Rejected. They are the files the owner rewrites, so nearly every upstream change to them is a conflict, and research 0013 counts 118 conflicts from 16 such files.
- **Keep a separate rule for a module seed, which the old engine wrote again when it was missing.** Rejected. A missing `once` file follows the rule of every tracked file the owner deleted: it stays deleted, and `update --restore <path>` writes it again ([ADR 0068](0068-adr-a-merge-base-is-found-by-hash-in-a-user-cache-2026-11-20.md)).
- **Make `saasaloy.json` and `.env.example` `once`.** Rejected in the re-grill. `add` must register a module's aliases and keys in them, and a `once` file takes no write after the first.
- **Make the four table files `once` at once.** Rejected in the re-grill. `add` could not register a module in them before Phase 7, so the `scaffold:check` and `release:smoke` gates of Phases 4 and 6 would fail.

## Consequences

- **The manifest records the class.** Each version 2 entry carries `class`, and the `seed` flag of a version 1 entry is gone.
- **A `once` file that upstream changed gets one report line, one time for each upstream change.** The record keeps the release that wrote the file, so its base stays findable. `update --merge <path>` merges that one file three ways, and `outdated` lists each such file on every run.
- **A `once` path that already holds a file with no record is the owner's.** The run leaves it and starts to track it. A file on both sides with no base is exempt from two-way markers for the same reason.
- **`remove` deletes a `once` file only while its hash equals the record.** An edited one stays, untracked, with one report line, as ADR 0060 said for a module seed.
- **Upstream changes to a `once` file never reach a project by themselves.** A module that changes what such a file must export says so in an [update note](0058-adr-update-notes-ship-beside-their-code-and-ride-the-merge-plan-2026-10-30.md), as before.

## References

Issue [#365](https://github.com/mimukit/saasaloy/issues/365). Plan: [`0116-plan-render-and-merge-engine-2026-11-20.md`](../plans/0116-plan-render-and-merge-engine-2026-11-20.md), "File classes" and the re-grill rows. Research: [`0013-research-three-way-merge-replay-2026-11-20.md`](../research/0013-research-three-way-merge-replay-2026-11-20.md). Prior: [ADR 0034](0034-adr-update-never-writes-a-file-it-did-not-write-2026-09-09.md), [ADR 0060](0060-adr-a-module-file-may-be-a-seed-written-once-2026-11-04.md), [ADR 0066](0066-adr-one-render-and-a-three-way-merge-replace-the-add-update-and-remove-engines-2026-11-20.md). Code: `packages/cli/src/engine/classes.ts`, `packages/cli/templates/base/_saasaloy-base.json`.
