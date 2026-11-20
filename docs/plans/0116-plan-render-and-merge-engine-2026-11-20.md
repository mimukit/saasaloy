# Plan: One render-and-merge engine in place of add, update and remove

Grilled: 2026-11-20

## Context

`add`, `update` and `remove` are three engines, and each one edits a project in place. Together with the patch folder, the merge plan and the backfill they hold about 11,600 of the 24,800 lines in `packages/cli/src`. Refactor survey 0003 counts five spellings of one rule in them: may the tool overwrite this file? Its first three candidates all try to join copies inside these engines.

The engines cannot undo their own work. 106 of the 288 descriptor patches (the two `package.json` kinds) have no inverse, so `remove` leaves them in the project. The four table kinds append in install order, so a table depends on install history. `update` does not merge. It prints three sides of each edited file into a Markdown merge plan, and an agent merges the whole file by hand and then records it with `--resolved`.

[Research 0013](../research/0013-research-three-way-merge-replay-2026-11-20.md) replayed the PrimeShopr update to 0.8.0. The old engine left 80 files for an agent. A three-way merge alone clears 17 of them. The larger gain comes from the class of a file: 16 files that the owner is expected to rewrite gave 118 of the 248 conflicts.

The owner decided on 2026-11-19 and 2026-11-20 to write the engine again as one render function and a three-way merge, to move the registration tables into generated files, and to support Postgres only. [Research 0010](../research/0010-research-restart-retrospective-2026-11-17.md) holds the design this plan starts from, and [research 0003](../research/0003-research-everything-is-a-plugin-2026-10-02.md) holds the model: every edit reversible, and a result that depends only on the set of modules.

Goal: an agent takes a Saasaloy update with less merge work, and the CLI can undo every edit it makes.

Target: on the PrimeShopr 0.8.0 replay, at most 45 files need an agent (proposed; baseline 80 from research 0013; the owner accepted it on 2026-11-20). No edit of the engine lacks an undo (baseline: 106 patches with no inverse on `main` at `673e1230`). With the grill answers below, the estimate from the replay data is 38 to 41 files.

Merge gate: the work can start now, but the pull request merges only after 0.9.0 is released (#358). From that release a CLI reads the modules at its own tag (ADR 0062), so `main` can change the payload without a break for released CLIs (grill Q23, asked).

## Design decisions (settled)

Rows from the planning session name the owner and a date. Rows from the grill of 2026-11-20 name their question and say "asked" or "defaulted".

### Scope and shape

| Decision | Resolution |
|----------|-----------|
| A new engine replaces the three | Owner, 2026-11-20. The content of a generated project, the repo, the npm name and the module code stay. |
| Scope of this plan | Owner, 2026-11-20: the engine and the tables. The descriptor stays `registry-item.json`, and module code stays in `modules/*/files`. The TypeScript descriptor and a `reference/` project get their own plans. |
| Registration tables | Owner, 2026-11-19: files that the CLI writes in full. They move in Phase 7, after the cutover, so the engine swap does not wait on them. |
| Files the owner rewrites | Owner, 2026-11-20: written one time. `update` never merges them. |
| SQL dialect | Owner, 2026-11-19: Postgres only. The removal of `database-d1` is its own plan. Until then the engine reads `onlyWith` as a `when.installed` gate. |
| Issues and pull requests | One issue (#365), one branch, one pull request for Phases 1 to 7 (grill Q6, asked). The owner chose it over a split in three. |
| The release | Not a phase of #365. The issue ends when Phase 7 merges. The release follows the normal release steps (ADR 0064), and the version is `0.10.0` (grill Q21 and Q22, asked). See [After the merge](#after-the-merge). |
| Approved outward actions | A runner may comment on #365 with the Phase 1 result, push the branch, and open one pull request. Two follow-up issues are filed at the grill, as `needs-planning`: the removal of `database-d1`, and the TypeScript descriptor with contract keys (grill Q24, asked). No other outward action is approved. |

### The engine

| Decision | Resolution |
|----------|-----------|
| One operation | `apply(oldLock, newLock)`. `init` is an apply from nothing, `add X` adds X to the requested set, `remove X` takes it out, and `update` moves the version. One code path decides every write. |
| Render | `render({ payload, requested, options })` returns a map from path to bytes and class. It reads no disk and no network. The caller loads the payload first. |
| Patches inside the render | A patch becomes a transform that the render applies in memory, in one fixed order: dependency order, then module name. The insert side of each codemod in `packages/cli/src/lib/patch/` is reused. No inverse and no reversal refusal is necessary, because a remove is a render without the module. |
| File classes | Each rendered file has one class. `generated`: the CLI writes it in full on every run. `merged`: three-way merge. `once`: written when the path is new, then left alone. Today's `seedFiles`, `ownedFiles` and the module `seed` flag (ADR 0060) all map to `once`. |
| An owned file that holds a table | The table moves to a generated file in Phase 7, and the rest of the file stays `once`. Four files hold five tables: `packages/env/src/services.ts`, `packages/env/src/sources.ts`, `packages/tooling/src/targets.ts` and `packages/ui/src/blocks/navbar.tsx` (grill Q11, defaulted). |
| Text merge | `git merge-file` through `execFile`, with `--zdiff3` from git 2.35 and `--diff3` below it. A run that needs a merge and finds no git refuses with exit 2. A run with no merge needs no git (grill Q16, defaulted). |
| JSON merge | `package.json`, `wrangler.jsonc`, `tsconfig.json` and `turbo.json` merge by key, with `jsonc-parser`. A key that both sides changed gets conflict markers in the file, around that key. The engine first applies every key that does not conflict to all three sides, then runs the text merge, so only the conflicting keys still differ (grill Q3, asked; Q26, defaulted). |
| The base of a merge | The render of the old lock, from the payload at the old ref. The engine accepts it only when its sha256 equals the hash in the manifest. A file whose hash on disk equals the manifest needs no base. |
| Where the payload lives | A cache for each user: `$XDG_CACHE_HOME/saasaloy/payload/<source>@<ref>/`, else `~/.cache/…`. `SAASALOY_CACHE_DIR` overrides it for tests. A cold cache with no network refuses a run that needs a merge, with exit 2. No copy of the base lives in the project (grill Q2, asked; Q31, defaulted). |
| What the manifest hash means | Always the sha256 of the raw render, before Prettier, never the bytes on disk. A Prettier upgrade then cannot break the base check. The flags `adopted`, `mergedWith` and `deleted` go (grill Q17, defaulted). |
| Formatting | Whole module files are already formatted in the registry. A generated table is printed in a layout that Prettier leaves unchanged. For a file that a transform changed, `apply` formats `base` and `theirs` with the project's Prettier when it exists, through `lib/format.ts`. |
| Fixed formats | See [Formats](#formats) for manifest version 2, the lock and the table fields (grill Q27 and Q28, defaulted). |

### Conflicts and pending work

| Decision | Resolution |
|----------|-----------|
| A conflict | Does not stop the run. The run writes the markers, moves the lock and the manifest to the new version, and exits 3. A lock that stayed behind would make the next run merge over markers (grill Q10, defaulted). |
| How the CLI knows a merge is pending | The manifest lists each file that a run left with markers (`pendingMerges`). The scan reads only those files, and an entry clears when no marker line remains. A skill that quotes a marker is not pending work (grill Q8, defaulted). |
| A run while merges are pending | `add`, `remove` and `update` refuse with exit 2 until `pendingMerges` is empty (grill Q9, defaulted). |
| A file on both sides with no base | Two-way conflict markers, as git writes for "both added". A `once` path is exempt: the file exists, so the engine leaves it. Research 0013 counts 15 such files, 4 of them `once` (grill Q4, asked). |
| Upstream deleted a file the owner changed | The file stays, its record goes, and the report has one line. `remove` follows the same rule for an edited module file, as the remover does today (grill Q19, defaulted). |
| `remove` and a `once` file | Deleted when its hash on disk equals the manifest. Otherwise it stays, and the report has one line (grill Q33, defaulted). |
| The owner deleted a tracked file | It stays deleted. `update --restore <path>` writes the upstream file again, as today (grill Q20, defaulted). |
| A `once` file that upstream changed | `update` prints one line for it, one time for each upstream change. `outdated` lists it always. `update --merge <path>` runs the three-way merge on that one file. The manifest records the version that wrote it, so the base is findable (grill Q12, defaulted). |
| The owner edited a `generated` file | The run refuses with exit 2 and names the file. `--force` overwrites it (grill Q7, defaulted; ADR 0046). |
| Typecheck after a merge | The CLI runs none. The report ends with a line that names `pnpm check` (grill Q14, defaulted). |

### Commands and safety

| Decision | Resolution |
|----------|-----------|
| The clean-tree rule | `update` refuses a dirty tree, as today. `add` and `remove` refuse only when the run must merge or delete a file that has uncommitted changes (`git status --porcelain -- <paths>`). A write of a new file needs no clean tree, so the resume path of the `saasaloy-build` skill still works. `--force` overrides both (grill Q1, asked). |
| `saasaloy update <module>` | Dropped for the default registry. One update moves every default module to the tag of the CLI that runs. A staged update runs an older CLI: `pnpm dlx saasaloy@<version> update`. A CLI older than the lock refuses with exit 2 (grill Q5, asked; Q30, defaulted). |
| A third-party module | The lock keeps a source and a ref for each module, as today. `update` moves a third-party module to the tip of its recorded ref (grill Q13 and Q32, defaulted). |
| Undo | `--abort` stays, with `lib/backup.ts`, and now serves `add`, `remove` and `update`. The engine copies each file before it overwrites, merges or deletes it. A journal file marks an unfinished run, and the next run refuses until `--abort` or a finished run clears it. Git cannot undo a `--force` run over uncommitted work (grill Q25, defaulted). |
| Flags that go | `--resolved` and `--from`. `--done` stays for update notes (ADR 0058). |
| The flag during the build | `SAASALOY_ENGINE=next` selects the new engine inside the branch, for the parity tests of Phases 2 to 5. Phase 6 removes it, so it never ships (grill Q15, defaulted). |

### Conversion, build and test

| Decision | Resolution |
|----------|-----------|
| Which old projects convert | Any version 1 manifest that records `hash` and `from` for its files. Another project gets a refusal that names the last old-engine CLI to update with first (grill Q29, defaulted). |
| An old project with inline tables | The base of each table file is the shipped file, proved by its hash. The conflicts go to the agent with an update note. Phase 7 measures the count on PrimeShopr at its head, and the count is not a gate (grill Q18, defaulted). |
| One branch while `main` moves | The table conversion of Phase 7 stays a script in the branch until the merge. A rebase runs the script again, so nobody merges 56 descriptors by hand (grill Q34, defaulted). |
| Tests | vitest unit tests beside the source in `packages/cli/src/engine/`, the registry round trip in `packages/cli/test/matrix/`, and command runs in `packages/cli/test/e2e/`. These are the runners and folders the CLI uses today. No new kind of test. |
| The replay measure | A script takes a project path and a commit. No PrimeShopr file enters this repo, because the repo is public. |

### Formats

Manifest version 2, in `.saasaloy/manifest.json`:

```jsonc
{
  "version": 2,
  "files": {
    "apps/api/src/index.ts": {
      "module": "api",
      "from": "files/src/index.ts",
      "class": "merged",          // generated | merged | once
      "hash": "<sha256 of the raw render>",
      "version": "0.10.0"         // the release that wrote this render
    }
  },
  "pendingMerges": ["package.json"],
  "pendingNotes": [],
  "doneNotes": []
}
```

The lock keeps its `modules` map and gains `"requested": ["auth", "admin"]`, the modules the owner asked for. The rest of the installed set is derived from it.

A table in a descriptor, from Phase 7. The four shapes mirror the four patch kinds, so a script converts the 157 patches:

```jsonc
// the module that owns the table
"tables": [
  { "id": "email.providers", "file": "@email/providers.generated.ts", "shape": "calls" }
]
// a module that adds to it
"entries": [
  { "table": "email.providers", "call": "consoleEmail",
    "import": { "name": "consoleEmail", "from": "./providers/console" }, "order": 1000 }
]
```

`shape` is `calls` (from `plugin-array`), `objects` (from `const-array`), `routes` (from `chained-route`) or `nav` (from `nav-entry`). `order` is optional and defaults to 1000. A generated file is named `<name>.generated.ts`, sits beside the file that holds the table today, and starts with one header line that names the CLI.

## Approach

Build the engine as new code that shares no control flow with `applier.ts`, `updater.ts` or `remover.ts`. Prove it against the old engine while both exist in the branch, convert an existing project, then delete the old engines and move the tables.

What the engine reuses:

- `lib/registry.ts` to load descriptors and module files at a ref, and `SAASALOY_REGISTRY_DIR` for offline tests.
- `lib/resolve.ts` and `lib/requires.ts` for the dependency graph, `conflictsWith` and `requiresOneOf`.
- `lib/when.ts` for the `when` gates, and `lib/testing.ts` for the testing block in `AGENTS.md`.
- `lib/scaffold.ts` for the template rules: the `_name` to `.name` rename and the `{{VAR}}` tokens.
- `lib/saasaloy-config.ts` (`resolveTarget`) for aliases.
- `lib/collisions.ts` for two modules that write one path. The render refuses, as `add` does today.
- `lib/patch/` codemods, insert side only, as render transforms.
- `lib/backup.ts` for the copy before a write and for `--abort`.
- `lib/git-state.ts` for the clean-tree rule.
- `lib/update-notes.ts`, `lib/update-note-select.ts` and `lib/pending-notes.ts` unchanged. A merge cannot change code the owner wrote, so the notes stay.
- `lib/exit.ts` exit codes 0, 1, 2 and 3 with their current meaning, and `lib/json-output.ts` for `--json`.
- `lib/prompts.ts` for the refuse-with-no-terminal rule (ADR 0046).

Alternatives, each rejected for one reason:

- Change the old engines in steps (the "continue" list of research 0010). `update` would render while `add` and `remove` still patch, so the render of an old lock would not match the bytes on disk, and each difference becomes a false conflict.
- Move the tables to generated files first. The payload would then fork before an engine exists that can write a generated file.
- Keep a copy of the base render inside the project. It adds about 300 files to the tree and doubles the diff of each update (grill Q2).
- Three issues and three pull requests. The owner chose one (grill Q6).

### Phase 1: Prototype the two generated tables that carry types (#365)

Throwaway code under `.dev/`, deleted after the answer. Scaffold the `full` preset with the current CLI. Move `auth.plugins`, `adminAuth.plugins` and the two client plugin arrays (`packages/auth/src/auth.ts`, `client.ts`) into generated files, and move the route chain of `apps/api/src/index.ts` into `routes.generated.ts` with an owner chain after it. Better Auth and the Hono RPC client both derive types from these values.

If a type is lost, that table stays inside its file as a transform, and Phase 7 skips it.

Done when: the prototype project passes `pnpm typecheck`, one call to a plugin endpoint through the auth client and one RPC call through `@repo/api/client` typecheck in it, and the result for each of the two tables (kept types, or the compiler error) is a comment on #365.

### Phase 2: The render function (#365)

- `engine/payload.ts`: load the base template and every module of the resolved set into memory, from the user cache, from the registry at one ref, or from a local directory. A fetch fills the cache.
- `engine/render.ts`: resolve the set, apply the `when` gates, copy the template and the module files to their targets, apply each patch as a transform in the fixed order, and return path, bytes, class, module and source path for each file.
- `engine/classes.ts`: one function that gives the class of a path from `_saasaloy-base.json` and the descriptor.
- Read `onlyWith` as a `when.installed` gate.

Done when: `pnpm --filter saasaloy test` runs a test that renders the `minimal` and `full` presets of `scripts/play-presets.json` and compares each file with a scaffold the old engine made by `init` and `add` in the fixed order. After Prettier runs on both sides, the trees are equal. A second test renders the same set from a shuffled module list and gets the same bytes.

### Phase 3: Merge and apply (#365)

- `engine/merge.ts`: the three-way text merge through `git merge-file`, with the labels `mine`, `base` and `saasaloy <version>`.
- `engine/json-merge.ts`: the merge by key, with markers around a key that both sides changed.
- `engine/apply.ts`: for each path, compare `base`, `theirs` and `mine` and choose one action: leave, write, delete, merge, or report. It stages every result in memory, copies each file it will change through `lib/backup.ts`, writes a journal, writes the project, writes the manifest and the lock last, and removes the journal.
- The rules of the "Conflicts and pending work" table.
- Manifest version 2 and the `requested` list in the lock, as in [Formats](#formats).

Done when: unit tests cover each action with a fixture of three sides, including the six result kinds of research 0013 (clean, already equal, conflict, both sides with no base, upstream delete against an owner edit, no base found). A test applies a set, edits one `merged` file and one `once` file, applies a newer fixture payload, and finds the merged file changed, the `once` file untouched, and the manifest hashes equal to the new render. A test leaves a journal behind and finds that the next run refuses with exit 2 and that `--abort` restores the tree byte for byte.

### Phase 4: The commands on the new engine, behind the flag (#365)

- With `SAASALOY_ENGINE=next`, `init`, `add`, `remove` and `update` call `apply`. `--dry-run`, `--diff`, `--yes`, `--json`, `--with`, `--force`, `--abort`, `--restore` and `--done` keep their meaning.
- `update` takes no module name for the default registry, and it prints the report in place of the merge plan: the files with markers, the `once` files that upstream changed, the files left deleted, and the update notes.
- `update --merge <path>` runs the three-way merge on one `once` file.
- The clean-tree rule: whole tree for `update`, per file for `add` and `remove`.
- A draft of the new `saasaloy-update` skill, kept beside the current one until the cutover.

Done when: the registry round trip passes in `packages/cli/test/matrix/`: for each module in `modules/`, `add` on a fresh base and then `remove` gives the starting tree byte for byte, and for each pair with no dependency edge, both add orders give the same tree. `SAASALOY_ENGINE=next pnpm scaffold:check` passes. An e2e test runs `add` over a tree with an uncommitted new file and passes, and runs `add` where the plan merges a file with uncommitted changes and gets exit 2.

### Phase 5: Convert an existing project, and measure (#365)

- `engine/convert.ts`: read a version 1 manifest and lock. For each tracked file, find the base by its recorded hash across the lock revision and the release tags, as research 0013 did, and write version 2 records. A file with no base found becomes a both-sides file. A manifest with no `hash` or no `from` refuses.
- `scripts/replay-update.ts <project> <commit>`: copy a project at a commit to a temporary folder, run the conversion and an update there with the new engine's classes and merge functions, and print the count of files that need an agent, by result kind.

Done when: `node scripts/replay-update.ts /home/dev/projects/primeshopr d9cc35fc` prints at most 45 files that need an agent, and the conversion finds a base for at least 316 of the 317 tracked files. A fixture test converts a small version 1 project and checks the version 2 manifest.

### Phase 6: Cut over and delete the old engines (#365)

- The new engine becomes the default, and the flag goes.
- Delete `applier.ts`, `updater.ts`, `remover.ts`, `merge-plan.ts`, `backfill.ts`, `commands/backfill-report.ts`, the inverse and refusal tables in `patch/index.ts`, and the tests that cover only them. Delete `--resolved` and `--from`.
- Replace the `saasaloy-update` skill in the base template with the new one. Fix every file that names the merge plan, `--resolved` or `saasaloy update <module>`: `llms.txt`, `README.md`, `CONTEXT.md`, `docs/wiki/reference.md`, the base `AGENTS.md`, and the `admin`, `auth`, `feature-flags` and `shell` skills.
- Write the ADRs with domainkit: one for the engine (it replaces the write rules of ADRs 0019 and 0031 and keeps ADR 0034 by construction), one for the three file classes (it widens ADR 0060), and one for the base by hash and the user cache (it replaces the snapshot rule of ADR 0059).
- Write the update note that tells a project agent what the first run with the new engine does.

Done when: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm scaffold:check` and `pnpm release:smoke` pass on the branch with the old engine files gone, `grep -rn -e "--resolved" -e "merge plan" packages/cli/templates modules llms.txt README.md CONTEXT.md docs/wiki` finds nothing, and `wc -l` over `packages/cli/src` without tests is below the 24,807 lines of `673e1230`.

### Phase 7: Generated tables (#365)

- The descriptor gains `tables` and `entries`, as in [Formats](#formats). The schema and its types change together.
- A script converts the 157 table patches (`plugin-array` 100, `chained-route` 22, `const-array` 19, `nav-entry` 16) into `entries`, and the 48 tables into `tables`. The script stays in the branch until the merge.
- Each file that holds a table today imports the generated file in its place. The owner's own entries go in the file the owner keeps, after the generated ones.
- The render writes each table sorted by `order`, then module name. `DEPLOY_TARGETS` already carries an `order` field in its entries, and it keeps that value.
- Delete the four table codemods. Write the update notes for a project that holds inline tables.
- Tables that Phase 1 could not move stay as transforms.

Done when: no descriptor in `modules/` holds a patch of the four table kinds (`jq` over `modules/*/registry-item.json` prints 0), `pnpm scaffold:check` and `pnpm release:smoke` pass, `prettier --check` passes on the generated files of the `full` preset, the Phase 4 round trip still passes, and `node scripts/replay-update.ts /home/dev/projects/primeshopr d9cc35fc` still prints at most 45. The pull request body records the conflict count of the table move on PrimeShopr at its head.

## After the merge

These steps are not phases of #365, and no unattended run takes them (grill Q21, asked).

- The pull request merges only after 0.9.0 is released (#358).
- The owner approves the release of `0.10.0` through the release workflow (ADR 0064).
- PrimeShopr converts with the released CLI, as the first real project. That work belongs to the PrimeShopr tracker.

## Migration and rollback

Two stored formats change: `.saasaloy/manifest.json` (version 2, Phase 3) and `saasaloy-lock.json` (the `requested` list, Phase 3). No database changes.

- **Forward.** The first run of the new engine in a version 1 project converts both files (Phase 5). `update` needs a clean git tree, so the conversion is one reviewable diff.
- **Rollback.** `saasaloy update --abort` restores the files of the last run. After a commit, revert that commit. The version 1 files return, and the last old-engine CLI reads them. A project that already cleared markers loses that work with the revert, so the update note says to convert on a branch.
- **One way.** A CLI older than the cutover refuses a version 2 project, because both schemas reject unknown fields. The same rule applied when `pendingNotes` arrived (ADR 0058).

## Open questions

None. The grill of 2026-11-20 settled the 14 questions of the draft and deferred none.

## Non-goals

- The TypeScript descriptor, and `provides` and `requires` contract keys (research 0003 rank 4, research 0010 change 4). A follow-up issue holds it.
- A `reference/` project and a registry build step (research 0010 change 2).
- The removal of `database-d1` and the twin schema files. A follow-up issue holds it.
- A feature as one workspace (research 0010 change 5).
- The typed service context and the ordered middleware table (research 0003 ranks 3 and 7). Each becomes one more generated table after this plan.
- A merge that reads syntax. The merge is by line for text and by key for JSON.
- A typecheck or a test run inside the CLI. The project's `pnpm check` stays the gate.
- A third-party module tier, namespaced registries, and contract versions.
- `saasaloy update <module>` for the default registry.
- The release of `0.10.0` and the conversion of PrimeShopr.
