# Plan: One render-and-merge engine in place of add, update and remove

## Context

`add`, `update` and `remove` are three engines, and each one edits a project in place. Together with the patch folder, the merge plan and the backfill they hold about 11,600 of the 24,800 lines in `packages/cli/src`. Refactor survey 0003 counts five spellings of one rule in them: may the tool overwrite this file? Its first three candidates all try to join copies inside these engines.

The engines cannot undo their own work. 106 of the 288 descriptor patches (the two `package.json` kinds) have no inverse, so `remove` leaves them in the project. The four table kinds append in install order, so a table depends on install history. `update` does not merge. It prints three sides of each edited file into a Markdown merge plan, and an agent merges the whole file by hand and then records it with `--resolved`.

[Research 0013](../research/0013-research-three-way-merge-replay-2026-11-20.md) replayed the PrimeShopr update to 0.8.0. The old engine left 80 files for an agent. A three-way merge alone clears 17 of them. The larger gain comes from the class of a file: 16 files that the owner is expected to rewrite gave 118 of the 248 conflicts.

The owner decided on 2026-11-19 and 2026-11-20 to write the engine again as one render function and a three-way merge, to move the registration tables into generated files, and to support Postgres only. [Research 0010](../research/0010-research-restart-retrospective-2026-11-17.md) holds the design this plan starts from, and [research 0003](../research/0003-research-everything-is-a-plugin-2026-10-02.md) holds the model: every edit reversible, and a result that depends only on the set of modules.

Goal: an agent takes a Saasaloy update with less merge work, and the CLI can undo every edit it makes.

Target: on the PrimeShopr 0.8.0 replay, at most 45 files need an agent (proposed; baseline 80 from research 0013; the owner accepted it on 2026-11-20). No edit of the engine lacks an undo (baseline: 106 patches with no inverse on `main` at `673e1230`).

Precondition: 0.9.0 is released (#358). From that release a CLI reads the modules at its own tag (ADR 0062), so `main` can change the payload without a break for released CLIs.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| A new engine replaces the three | Owner, 2026-11-20. The content of a generated project, the repo, the npm name and the module code stay. |
| Scope of this plan | Owner, 2026-11-20: the engine and the tables. The descriptor stays `registry-item.json`, and module code stays in `modules/*/files`. The TypeScript descriptor and a `reference/` project get their own plans. |
| Registration tables | Owner, 2026-11-19: files that the CLI writes in full. They move in Phase 7, after the cutover, so the engine swap does not wait on them. |
| Files the owner rewrites | Owner, 2026-11-20: written one time. `update` never merges them. It prints one line when upstream changed one, and a command merges one file on request. |
| SQL dialect | Owner, 2026-11-19: Postgres only. The removal of `database-d1` is its own plan. Until then the engine reads `onlyWith` as a `when.installed` gate. |
| One operation | `apply(oldLock, newLock)`. `init` is an apply from nothing, `add X` adds X to the requested set, `remove X` takes it out, and `update` moves the version. One code path decides every write. |
| Render | `render({ payload, requested, options })` returns a map from path to bytes and class. It reads no disk and no network. The caller loads the payload first. |
| Patches inside the render | A patch becomes a transform that the render applies in memory, in one fixed order: dependency order, then module name. The insert side of each codemod in `packages/cli/src/lib/patch/` is reused. No inverse and no reversal refusal is necessary, because a remove is a render without the module. |
| File classes | Each rendered file has one class. `generated`: the CLI writes it in full on every run. `merged`: three-way merge. `once`: written when the path is new, then left alone. Today's `seedFiles`, `ownedFiles` and the module `seed` flag (ADR 0060) all map to `once`. |
| Text merge | `git merge-file --diff3` through `execFile`. `init` and `lib/git-state.ts` already call git, so this adds no dependency. The exit code is the conflict count. |
| JSON merge | `package.json`, `wrangler.jsonc`, `tsconfig.json` and `turbo.json` merge by key, with `jsonc-parser`, which the CLI already ships. Research 0013: 19 text conflicts become 13 key conflicts. |
| The base of a merge | The render of the old lock, from the payload at the old ref. The engine accepts it only when its sha256 equals the hash in the manifest. Research 0013 found the base of 316 of 317 files this way. Payloads are cached for each user, outside the project. |
| What the manifest hash means | Always the hash of the bytes the render gave, never the bytes on disk. The flags `adopted`, `mergedWith` and `deleted` go. |
| Pending work | A tracked file that holds a conflict marker, or a pending update note. `update` exits 3 while either exists. `--resolved` goes. `--done` stays for notes (ADR 0058). |
| A conflict | Does not stop the run. The run writes the markers, moves the lock and the manifest to the new version, and exits 3. |
| Formatting | Whole module files are already formatted in the registry. A generated table is printed in a layout that Prettier leaves unchanged. For a file that a transform changed, `apply` formats `base` and `theirs` with the project's Prettier when it exists, through `lib/format.ts`. |
| Build order | The new engine lands beside the old one under `packages/cli/src/engine/`, reachable only with `SAASALOY_ENGINE=next`. One PR makes it the default and deletes the old engines. No release ships between the cutover and the table move, so a project converts one time. |
| Tests | vitest unit tests beside the source in `packages/cli/src/engine/`, the registry round trip in `packages/cli/test/matrix/`, and command runs in `packages/cli/test/e2e/`. These are the runners and folders the CLI uses today. No new kind of test. |
| The replay measure | A script takes a project path and a commit. No PrimeShopr file enters this repo, because the repo is public. |

## Approach

Build the engine as new code that shares no control flow with `applier.ts`, `updater.ts` or `remover.ts`. Prove it against the old engine while both exist, convert an existing project, then delete the old engines.

What the engine reuses:

- `lib/registry.ts` to load descriptors and module files at a ref, and `SAASALOY_REGISTRY_DIR` for offline tests.
- `lib/resolve.ts` and `lib/requires.ts` for the dependency graph, `conflictsWith` and `requiresOneOf`.
- `lib/when.ts` for the `when` gates, and `lib/testing.ts` for the testing block in `AGENTS.md`.
- `lib/scaffold.ts` for the template rules: the `_name` to `.name` rename and the `{{VAR}}` tokens.
- `lib/saasaloy-config.ts` (`resolveTarget`) for aliases.
- `lib/collisions.ts` for two modules that write one path. The render refuses, as `add` does today.
- `lib/patch/` codemods, insert side only, as render transforms.
- `lib/update-notes.ts`, `lib/update-note-select.ts` and `lib/pending-notes.ts` unchanged. A merge cannot change code the owner wrote, so the notes stay.
- `lib/exit.ts` exit codes 0, 1, 2 and 3 with their current meaning, and `lib/json-output.ts` for `--json`.
- `lib/prompts.ts` for the refuse-with-no-terminal rule (ADR 0046).

Alternatives, each rejected for one reason:

- Change the old engines in steps (the "continue" list of research 0010). `update` would render while `add` and `remove` still patch, so the render of an old lock would not match the bytes on disk, and each difference becomes a false conflict.
- Move the tables to generated files first. The payload would then fork before an engine exists that can write a generated file.
- Keep a copy of the base render inside the project. It makes `remove` work offline with no cache, but it doubles every managed file in the owner's repo. Open question 2 keeps it for the grill.

### Phase 1: Prototype the two generated tables that carry types (#365)

Throwaway code under `.dev/`, deleted after the answer. Scaffold the `full` preset with the current CLI. Move `auth.plugins`, `adminAuth.plugins` and the two client plugin arrays (`packages/auth/src/auth.ts`, `client.ts`) into generated files, and move the route chain of `apps/api/src/index.ts` into `routes.generated.ts` with an owner chain after it. Better Auth and the Hono RPC client both derive types from these values.

If a type is lost, that table stays inside its file as a transform, and Phase 7 skips it.

Done when: the prototype project passes `pnpm typecheck`, one call to a plugin endpoint through the auth client and one RPC call through `@repo/api/client` typecheck in it, and the result for each of the two tables (kept types, or the compiler error) is written on the tracking issue.

### Phase 2: The render function (#365)

- `engine/payload.ts`: load the base template and every module of the resolved set into memory, from the registry at one ref or from a local directory.
- `engine/render.ts`: resolve the set, apply the `when` gates, copy the template and the module files to their targets, apply each patch as a transform in the fixed order, and return path, bytes, class, module and source path for each file.
- `engine/classes.ts`: one function that gives the class of a path from `_saasaloy-base.json` and the descriptor.
- Read `onlyWith` as a `when.installed` gate.

Done when: `pnpm --filter saasaloy test` runs a test that renders the `minimal` and `full` presets of `scripts/play-presets.json` and compares each file with a scaffold the old engine made by `init` and `add` in the fixed order. After Prettier runs on both sides, the trees are equal. A second test renders the same set from a shuffled module list and gets the same bytes.

### Phase 3: Merge and apply (#365)

- `engine/merge.ts`: the three-way text merge through `git merge-file --diff3`, with the labels `mine`, `base` and `saasaloy <version>`.
- `engine/json-merge.ts`: the merge by key.
- `engine/apply.ts`: for each path, compare `base`, `theirs` and `mine` and choose one action: leave, write, delete, merge, or report. It stages every result in memory and writes the project last.
- The rules a text merge cannot give: a file on both sides with no base, a file that upstream deleted and the owner changed (the engine leaves the file and drops its record), and a file the owner deleted (it stays deleted, with one report line when upstream changes it).
- Manifest version 2: `class` for each file, and `hash` as the render hash. The lock gains `requested`, the modules the owner asked for. The rest of the installed set is derived.
- A scan for conflict markers over the `merged` files, used by `update`, `doctor` and `outdated`.

Done when: unit tests cover each action with a fixture of three sides, including the six result kinds of research 0013 (clean, already equal, conflict, both sides with no base, upstream delete against an owner edit, no base found). A test applies a set, edits one `merged` file and one `once` file, applies a newer fixture payload, and finds the merged file changed, the `once` file untouched, and the manifest hashes equal to the new render.

### Phase 4: The commands on the new engine, behind the flag (#365)

- With `SAASALOY_ENGINE=next`, `init`, `add`, `remove` and `update` call `apply`. `--dry-run`, `--diff`, `--yes`, `--json` and `--with` keep their meaning.
- `update` prints the report in place of the merge plan: the files with markers, the `once` files that upstream changed, the files left deleted, and the update notes.
- `update --merge <path>` runs the three-way merge on one `once` file on request.
- A draft of the new `saasaloy-update` skill, kept beside the current one until the cutover.

Done when: the registry round trip passes in `packages/cli/test/matrix/`: for each module in `modules/`, `add` on a fresh base and then `remove` gives the starting tree byte for byte, and for each pair with no dependency edge, both add orders give the same tree. `SAASALOY_ENGINE=next pnpm scaffold:check` passes.

### Phase 5: Convert an existing project, and measure (#365)

- `engine/convert.ts`: read a version 1 manifest and lock. For each tracked file, find the base by its recorded hash across the lock revision and the release tags, as research 0013 did, and write version 2 records. A file with no base found becomes a both-sides file.
- `scripts/replay-update.ts <project> <commit>`: copy a project at a commit to a temporary folder, run the conversion and an update there with the new engine's classes and merge functions, and print the count of files that need an agent, by result kind.

Done when: `node scripts/replay-update.ts /home/dev/projects/primeshopr d9cc35fc` prints at most 45 files that need an agent, and the conversion finds a base for at least 316 of the 317 tracked files. A fixture test converts a small version 1 project and checks the version 2 manifest.

### Phase 6: Cut over and delete the old engines (#365)

- The new engine becomes the default, and the flag goes.
- Delete `applier.ts`, `updater.ts`, `remover.ts`, `merge-plan.ts`, `backfill.ts`, `commands/backfill-report.ts`, the inverse and refusal tables in `patch/index.ts`, and the tests that cover only them. Delete `--resolved` and `--from`.
- Replace the `saasaloy-update` skill in the base template with the new one. Fix every file that names the merge plan or `--resolved`: `llms.txt`, `README.md`, `CONTEXT.md`, `docs/wiki/reference.md`, the base `AGENTS.md`, and the `admin`, `auth` and `shell` skills.
- Write the ADRs with domainkit: one for the engine (it replaces the write rules of ADRs 0019 and 0031 and keeps ADR 0034 by construction), one for the three file classes (it widens ADR 0060), and one for the base by hash (it replaces the snapshot rule of ADR 0059).
- Write the update note that tells a project agent what the first run with the new engine does.

Done when: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm scaffold:check` and `pnpm release:smoke` pass on the branch with the old engine files gone, `grep -rn -e "--resolved" -e "merge plan" packages/cli/templates modules llms.txt README.md CONTEXT.md docs/wiki` finds nothing, and `wc -l` over `packages/cli/src` without tests is below the 24,807 lines of `673e1230`.

### Phase 7: Generated tables (#365)

- The descriptor gains `tables` (the module that owns a table declares its id, file and shape) and `entries` (a module adds an entry to a table by id, with an optional `order`, default 1000). The schema and its types change in one PR.
- A script converts the 157 table patches (`plugin-array` 100, `chained-route` 22, `const-array` 19, `nav-entry` 16) into `entries`, and the 48 tables into `tables`.
- Each file that holds a table today imports the generated file in its place. The owner's own entries go in the file the owner keeps, after the generated ones.
- The render writes each table sorted by `order`, then module name. `DEPLOY_TARGETS` already carries an `order` field in its entries, and it keeps that value.
- Delete the four table codemods. Write the update notes for a project that holds inline tables.
- Tables that Phase 1 could not move stay as transforms.

Done when: no descriptor in `modules/` holds a patch of the four table kinds (`jq` over `modules/*/registry-item.json` prints 0), `pnpm scaffold:check` and `pnpm release:smoke` pass, `prettier --check` passes on the generated files of the `full` preset, the Phase 4 round trip still passes, and `node scripts/replay-update.ts /home/dev/projects/primeshopr d9cc35fc` still prints at most 45.

### Phase 8: Release (#365)

Attended: the owner approves the release that ships the new engine (ADR 0064). It cannot come first, because it ships the work of Phases 2 to 7.

Convert PrimeShopr at its current head with the released CLI, as the first real project.

Done when: the release is on npm, and PrimeShopr at its head runs `saasaloy update` to exit 0 or 3 with a version 2 manifest and passes its own `pnpm check` after the agent clears the markers.

## Migration and rollback

Two stored formats change: `.saasaloy/manifest.json` (version 2, Phase 3) and `saasaloy-lock.json` (the `requested` list, Phase 3). No database changes.

- **Forward.** The first run of the new engine in a version 1 project converts both files (Phase 5). The run needs a clean git tree, so the conversion is one reviewable diff.
- **Rollback.** Revert that commit. The version 1 files return, and the last old-engine CLI reads them. A project that already cleared markers loses that work with the revert, so the update note says to convert on a branch.
- **One way.** A CLI older than the cutover refuses a version 2 project, because both schemas reject unknown fields. The same rule applied when `pendingNotes` arrived (ADR 0058).

## Open questions

1. Does `add` need a clean git tree? `update` refuses a dirty one today. The `saasaloy-build` skill adds modules stage by stage, and an agent may not commit between them.
2. Where does the base payload live: a per-user cache, or a copy of the last render inside the project? A cold cache with no network stops `remove`.
3. How does a key conflict show in a JSON file? Markers break `pnpm install` until an agent resolves them. The other choice keeps `mine` and lists the key in the report, but then nothing on disk says that work is pending.
4. A `generated` file that the owner edited: refuse with exit 2, or overwrite and report?
5. A file on both sides with no base: write two-way markers as git does for "both added", or leave `mine` and report? `--zdiff3` gives smaller markers and needs git 2.35.
6. Several `ownedFiles` hold registration tables today (`packages/env/src/services.ts`, `sources.ts`, `packages/tooling/src/targets.ts`). Which part becomes a generated table, and which part stays a `once` file?
7. How often does `update` print the line for a `once` file that upstream changed: on every run, or one time for each upstream change?
8. Does `saasaloy update <module>` still exist when one release tag covers every module of the default registry?
9. How does one render take a module from a third-party registry at its own commit (ADR 0012)?
10. Does `update --abort` stay, with `lib/backup.ts`, or does the clean-tree rule and git replace it?
11. Research 0013 ran no typecheck on its 10 clean merges. Does `apply` tell the agent to run `pnpm check`, or does it run a check itself?
12. Which version number does Phase 8 release, and does a project older than 0.9.0 convert in one step? PrimeShopr decides the answer in practice.
13. The flag: an environment variable as planned, or a hidden command option?
14. How many conflicts does the table move give a project with inline tables? PrimeShopr at its head can measure it in Phase 7.

## Non-goals

- The TypeScript descriptor, and `provides` and `requires` contract keys (research 0003 rank 4, research 0010 change 4).
- A `reference/` project and a registry build step (research 0010 change 2).
- The removal of `database-d1` and the twin schema files.
- A feature as one workspace (research 0010 change 5).
- The typed service context and the ordered middleware table (research 0003 ranks 3 and 7). Each becomes one more generated table after this plan.
- A merge that reads syntax. The merge is by line for text and by key for JSON.
- A typecheck or a test run inside the CLI. The project's `pnpm check` stays the gate.
- A third-party module tier, namespaced registries, and contract versions.
