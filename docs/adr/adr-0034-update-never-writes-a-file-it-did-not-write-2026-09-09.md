# 0034 — `update` never writes a file it did not write

`saasaloy update` may overwrite a managed file only when the CLI itself wrote the bytes the manifest records, and only when the template does not hand that file to the project. Everything else routes to the merge plan. Settled after `saasaloy update` destroyed about 1,229 lines of committed work in a downstream project (`docs/plans/plan-update-base-safety-2026-09-09.md`).

## Status

accepted. Extends [ADR 0032](adr-0032-the-base-carries-provenance-and-updates-through-the-module-path-2026-09-06.md), whose adoption step this ADR makes safe. Nothing in ADR 0032 is withdrawn.

## What went wrong

ADR 0032 gave an unrecorded project a base record by hashing the files it found on disk. The note printed at the time said "your edits are the baseline, not drift". The classifier then read that same hash as proof the file was untouched template output and returned `overwrite`. Both statements are reasonable on their own, and together they replace every hand-edited base file with the template's copy on the very next run.

The failure was not the missing three-way merge. The merge machinery already existed and worked. The failure was a hash that meant two different things to the code that wrote it and the code that read it.

## The rule

A recorded hash is evidence of provenance only when the CLI produced the bytes. Two flags carry that distinction.

- **`adopted`** on a manifest entry says the hash came off disk. An adopted file is treated as edited until the CLI writes it, whatever the hash says. Adoption skips at most one generation of template changes; overwriting a project's work is unbounded.
- **`ownedFiles`** in `_saasaloy-base.json` says the template ships a file once and the project owns it afterwards. The base template's own `AGENTS.md` has always said this of the blocks, the components and `globals.css`. It is now a list the code reads. An owned file that is absent is still created or restored; an existing one is never written.

Both flags fail toward the merge plan. That is the asymmetry the whole decision rests on: an unnecessary merge costs a person some minutes, and an unnecessary overwrite costs them work that was never anywhere else.

## What follows from it

`update` no longer derives `{{PROJECT_NAME}}` from the working directory. `init` records `name` in `saasaloy.json`, and the update reads it there, because a git worktree or a CI checkout path is not a rename.

Every run copies what it will touch into `.saasaloy/backups/<timestamp>/` before writing, and `saasaloy update --abort` restores it. A run refuses a dirty git working tree without `--force`, so `git diff` still describes what the update did.

A run that leaves files for a merge exits 3, not 0. Zero now means there is nothing left to do.

## Cost

An adopted project sees its whole first update as a merge plan rather than a set of clean writes, and the plan repeats until each file matches the new template or the project resolves it. That is the price of not knowing who wrote those bytes, and it is paid once per project.
