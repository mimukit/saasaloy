# Research: a replay of the PrimeShopr 0.8.0 update through a three-way merge

Created on 2026-11-20. Source revision is `673e1230` on `main`. PrimeShopr is at `161af2e0`. This document gives an opinion. It changes no source file.

Review: pending

## Question

The owner chose to replace the three CLI engines with one render function and a three-way merge. The owner wants AI agents to do most of the update and merge work. How much of a real update does a three-way merge do alone, and what must the new engine do for the rest?

## The decisions behind the question

The owner made these decisions in the session that reviewed [research 0003](0003-research-everything-is-a-plugin-2026-10-02.md) against `main`. No ADR records them yet.

| Date | Decision | Source of the option |
| --- | --- | --- |
| 2026-11-19 | Registration tables become files that the CLI writes in full. | [Research 0010](0010-research-restart-retrospective-2026-11-17.md), change 1 |
| 2026-11-19 | One SQL dialect, Postgres only. No project runs D1, so no migration path is necessary. | Research 0010, change 3 |
| 2026-11-20 | A new engine replaces the old one: "we'll restart to create the new engine and replace the old engine". | Research 0010, change 1 |

"Restart" has the narrow meaning here. The CLI engine is written again. The content of a generated project stays, and so do the repo, the npm name and the module code.

## Method and limits

PrimeShopr took `saasaloy update` from 0.6.1 to 0.8.0 on 2026-10-27. Its own record counts 76 writes and 81 hand merges in an 8-phase plan (`docs/research/0003-research-saasaloy-0-8-0-update-2026-10-27.md` in that repo).

The replay builds three sides for each of the 450 files that the manifest tracks before or after the update. It reads every byte with `git show` and writes to neither repo.

- `base` is the file that Saasaloy wrote before the update. The manifest records a module, a source path (`from`) and a sha256 hash for each file. The replay renders that source at the lock revision and at each release tag from 0.3.0 to 0.7.0, and takes the render whose hash equals the recorded hash.
- `theirs` is the same source at the tag `v0.8.0`.
- `mine` is the project file at `d9cc35fc`, the parent of the commit that applied the update.
- The hand result is the file at `1e427172`, the commit that recorded the last merge.

The replay then applies the rule of the new engine. It leaves a file that upstream did not change. It writes `theirs` when `mine` equals `base`. For the others it runs `git merge-file --diff3` (git 2.43.0).

Limits:

- This is one project and one update. The update skipped three releases, and the admin UI moved into the `shell` module in that range. Treat it as a hard case, not as an average.
- No typecheck ran on a merged file. A clean text merge can still fail to compile.
- The replay takes `theirs` from the `from` path in the manifest after the update. It does not run the 0.8.0 CLI.
- The "plan lines" figure is the two unified diffs (`base → theirs`, `base → mine`) that the merge plan prints today for a three-way file (ADR 0059). In October, PrimeShopr got two-way diffs for its 43 base files, so its real cost was higher than this figure.
- The count of lines that the merge applied alone is the line difference between `mine` and the merge result with every conflict resolved to `mine`.

## Results

### The model matches the record

The replay gives 80 hand merges for the old engine. PrimeShopr recorded 81. Per module, the base gives 43 in both counts.

| Old engine action | Files |
| --- | --- |
| Skip, upstream did not change | 161 |
| Write | 151 (111 of them new in 0.8.0) |
| Delete | 58 |
| Hand merge | 80 |

### What a three-way merge does with the 80 hand merges

| Result | Files | Agent work |
| --- | --- | --- |
| Clean merge | 10 | None |
| The project file already equals upstream | 7 | None |
| Conflict markers | 45 | Resolve 248 conflicts |
| The file exists on both sides and has no base | 15 | Full file |
| Upstream deleted a file that the owner changed | 2 | A decision |
| No base found (`saasaloy.json`, a seed file) | 1 | Full file |

The merge removes the agent from 17 of 80 files (21%).

### Inside the 55 files that the merge processed

| Measure | Value |
| --- | --- |
| Lines that upstream changed | 6,484 |
| Lines that the merge applied alone | 1,753 (27%) |
| Conflicts | 248 in 45 files |
| Lines an agent reads in the merge plan of today | 17,112 |
| Lines an agent reads in marker regions | 9,739 (43% less) |
| Conflicted files where the owner changed more lines than upstream | 28 of 45 |
| Conflicted files where the merge applied no upstream line | 14 of 45 |

### The file class decides the result

The classes come from `_saasaloy-base.json` at `v0.8.0` (`seedFiles`, `ownedFiles`), from the manifest patch list (table files), and from the file extension (JSON).

| Class | Files | Clean | Conflicts | Upstream lines | Applied alone | Plan lines | Marker lines |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Code | 25 | 4 | 90 | 3,889 | 40% | 8,674 | 4,096 |
| Owned UI blocks, styles and layout | 13 | 0 | 76 | 1,488 | 8% | 4,942 | 3,688 |
| JSON | 10 | 4 | 19 | 114 | 15% | 704 | 236 |
| Seed files | 3 | 0 | 42 | 813 | 3% | 2,061 | 1,383 |
| Table files | 3 | 2 | 2 | 66 | 56% | 337 | 29 |
| Auth schema with a base of the wrong dialect | 1 | 0 | 19 | 114 | 0% | 394 | 307 |
| All | 55 | 10 | 248 | 6,484 | 27% | 17,112 | 9,739 |

Owned and seed files give 118 of the 248 conflicts in 16 files. The owner rewrote them. `packages/ui/src/blocks/navbar.tsx` has 581 owner lines against 292 upstream lines, and `packages/ui/src/content/landing.ts` has 654 against 713.

### JSON by key

A text merge gives 19 conflicts in 6 JSON files. A merge by key gives 13 conflicts in 4 files. `apps/api/package.json` and `packages/db/package.json` become clean. Nine of the 13 are scripts in the root `package.json`, where both sides changed the same key.

### The dialect

PrimeShopr moved from D1 to Postgres on 2026-10-19. Its manifest still recorded `auth.sqlite.ts` as the source of `packages/db/src/schema/auth.ts`. Against that base the merge gives 19 conflicts. Against `auth.pg.ts` at the same revision it gives 2.

### Clean merges against the hand result

| Result | Files |
| --- | --- |
| Equal to the hand result, byte for byte | 7 |
| Differs only by an entry that a patch added in the same run | 2 (`apps/api/src/index.ts`, `packages/storage/package.json`) |
| The hand merge left out four upstream lines that the machine kept | 1 (`.prettierignore`) |

No clean merge gave a worse file than the hand merge.

### The base of a file

The replay found an exact base for 316 of the 317 files that the manifest tracked before the update. The lock says "base at CLI 0.5.0", but the hashes say something more exact. Of the 95 base template files, 58 hold the 0.5.0 render and 36 hold the 0.6.1 render, because the 0.6.1 update wrote the files nobody had edited. One version number cannot describe the base of a project. The recorded hash of each file can.

### Files that the project owned first

Fifteen files that 0.8.0 ships as new already existed in the project with other content. Examples are `packages/db/scripts/prod.ts`, `packages/env/src/services.ts` and `apps/api/vitest.config.ts`. None of the 15 is a copy of a blob in the Saasaloy history, so no base exists for them. Seven more new files were already equal to upstream.

## Findings

1. **A three-way merge is not the main lever for agent work.** It clears 21% of the hand merges and applies 27% of the upstream lines. It cuts the reading load by 43% and it gives the agent a format it already knows. A plan must not promise more than that.
2. **The file class is the main lever.** A file that the owner is expected to rewrite gives conflicts on almost every upstream change (8% and 3% applied alone). The new engine needs a declared class for each file: generated (the CLI writes it in full), merged, or written one time. The `seedFiles` and `ownedFiles` lists of today are the start of that rule, and `ownedFiles` are in the wrong class for a merge.
3. **The base must be exact, and it is recoverable.** The manifest hash identified the base of 316 files across four revisions. A conversion of an existing project can use the same method. A single version in the lock is not enough.
4. **Generated tables remove a small, sure part.** Two of three table files merged clean, and `apps/admin/src/components/nav.ts` kept 2 conflicts. Two of the three clean merges that differ from the hand result differ only by a patch entry. A generated table removes both cases.
5. **A merge by key is worth its cost for `package.json`.** It removes a third of the JSON conflicts. The remainder are real: both sides changed one script.
6. **Postgres only removes one conflict class.** A dialect variant as the recorded source turned 2 conflicts into 19.
7. **The engine needs three rules that a text merge cannot give:** a file that exists on both sides with no base (15), a file that upstream deleted and the owner changed (2), and a file that the owner deleted (2).
8. **The interval matters.** This update skipped three releases and one module move. The update notes of ADR 0058 exist for a move like that one, and they stay.

## State of research 0003 after these decisions

Research 0003 ranked twelve ideas at `508dc4f6`. Measured on `main` today, 393 commits later:

| Measure | Research 0003 | `main` at `673e1230` |
| --- | --- | --- |
| Modules | 47 | 56 |
| Patches | not counted | 288 |
| Patches with no inverse (`package.json` kinds) | 71 | 106 |
| Patches that append to a table | not counted | 157, into 48 tables in 40 files |
| `AsyncLocalStorage` scopes | 3 | 5 |
| Module-level setters | 7 | 10 |
| `create<Cap>(env)` call sites | about 40 files | 105 calls |
| Driver-gated file entries (`onlyWith`) | not counted | 34, in 14 modules |

| Rank in research 0003 | Under the new engine |
| --- | --- |
| 1. Reversible, order-free edits | By construction. A render has no inverse and no install order. |
| 2. Capability kit | Stays dropped (refactor 0003, research 0010). The guard test `scripts/capability-contract.test.ts` is still not written. |
| 3. Typed service context | One more generated table. Its own plan. |
| 4. Contract keys (`provides`, `requires`) | Part of the descriptor work. With Postgres only, the `api-keys` owner pair is the one exclusive key left. |
| 5. Install reason | The project stores the requested set, and the render derives the rest. |
| 6. Contract versions | Not necessary. One release tag covers the CLI, the base and the modules (ADR 0062). Update notes shipped with ADR 0058. |
| 7. Middleware table | One generated table with a phase field. |
| 8 and 9. Catalog, `explain`, no module names in the CLI | Rules of the new engine. |
| 10 to 12 | Hold. |

The Better Auth `plugins` arrays are the one doubt for generated tables. Four tables hold 19 entries in `packages/auth/src/auth.ts` and `client.ts`, and Better Auth derives its types from them.

## Open points

1. Which class does each `ownedFiles` path take in the new engine? The replay says "written one time" fits the UI blocks, but then an upstream fix never reaches them.
2. What does the engine do with a file that exists on both sides with no base?
3. Does a merged file with a conflict stop the run, or does the run finish and report?
4. A typecheck of the 10 clean merges would settle whether a clean text merge is safe to accept without review.
5. A second replay on a one-release update would show the normal case. PrimeShopr has later updates in its history.

## Evidence left on the box

The scripts and their output are in `.dev/research-0013-replay/` in this repo. The folder is ignored by git, and it survives a redeploy.

| File | Content |
| --- | --- |
| `replay.py`, `replay_lib.py` | The three sides and the merge for each file |
| `analyze.py` | The per-class figures and the JSON merge by key |
| `rows.json` | One record for each of the 450 files |
| `detail.json` | Line counts for the 55 merged files |
| `out.txt`, `analyze.txt` | The printed summaries |

Run `python3 -I replay.py`, then `python3 analyze.py`, from that folder. Both read `/home/dev/projects/primeshopr` and this repo.
