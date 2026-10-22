# Plan: Add several modules in one `saasaloy add` run

Grilled: 2026-10-22

## Context

`saasaloy add` takes one module per run. `parseArgs` in `packages/cli/src/commands/add.ts:112` keeps the first positional and reports every other one as an unknown argument, so `saasaloy add admin teams --yes` refuses and writes nothing. People and agents work around it with a shell loop: `for m in admin billing teams; do saasaloy add $m --yes; done`.

The loop has two faults. A refusal at the third module leaves the first two on disk, because `executePlan` has no rollback (#49). And each run checks conflicts, collisions and `requiresOneOf` against its own graph only, so a clash between the third and the seventh module shows up after six modules are already written. Plan 0074's `saasaloy-build` skill picks a module set from `saasaloy list --json` and installs it, so the agent path hits this on every build.

Success: `saasaloy add admin billing billing-console teams --yes` resolves one graph, prints one plan, asks once, and refuses before the first write when any module in the set would refuse on its own.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Approach | One graph from several roots, one plan, one confirmation. Rejected: a loop inside the CLI (keeps the half-installed state the shell loop has) and preset modules that only carry `dependsOn` (cover fixed sets, not the set an agent picks from a brief). |
| Syntax | `saasaloy add <module>... [flags]`. One positional keeps today's behaviour and output exactly. |
| Source | Every name resolves from one registry source. Each positional goes through `parseCoordinate`, and the run refuses when two coordinates differ in owner, repo or ref. A bare name and `mimukit/saasaloy/<name>` are the same source. |
| Already installed | A named module that is installed is skipped with a note, and the rest install. `--force` re-applies every named module that is installed. When every named module and its prerequisites are installed, the run prints "Nothing to do" and exits 0, as today. |
| Unknown names | The run reads every named descriptor before it plans, and refuses with all unknown names in one message. |
| Refusals | Every check that refuses today (`requires.saasaloy`, `requiresOneOf`, `conflictsWith`, file collisions, owned collisions) runs on the merged graph before the first write. One refusal stops the whole run. |
| Error attribution | A message that says `X (required by Y)` names the named root that pulled `X` in. When two roots pull it in, it names the first in argv order. |
| Lock pinning | `pinToLock` reads only the named modules the run re-applies under `--force`. When they share one lock SHA, the run pins to it. When they differ, the run refuses and names each module with its SHA: `Cannot re-apply admin (9f3a1c2) and teams (b81e04d) together, they are pinned to different commits. Re-apply them in separate runs, or pass @<ref>.` A skipped module is not read, so its pin does not count. This keeps ADR 0012: only `@ref` and `update` move a module off its pin. |
| `--force` scope | Re-applies the named modules only, not their installed prerequisites, as it does for one module today. |
| Order | Topological order first, then argv order between independent roots, so the same command always writes the same bytes. |
| Duplicates | A repeated name, or a named module that is also a prerequisite of another named one, is de-duplicated with no message. |
| Source with no module | `owner/repo` with no module, mixed with names, refuses and prints the usage line. |
| Prompt cap | `MAX_REQUIREMENT_PROMPTS` stays 8. Only `database` declares `requiresOneOf` today. |
| Outward actions | File one GitHub issue for this plan, blocked by #223. Post one comment on #228 that links the new issue and says the `saasaloy-build` skill uses `saasaloy add <a> <b> ...` once it lands. |
| Picker | Bare `saasaloy add` in a terminal uses clack's `multiselect` in place of `select`. |
| Skill pointers | The wire-up lines in `printNextSteps` already group by module. They print for every module the run wrote a block for, as today. |
| `--dry-run --json` | Adds a `requested` array of the named modules in argv order. Existing fields keep their shape, so `schemaVersion` stays 1 (ADR 0046). |
| `--with` | Applies to the whole set: one `--with` value answers a `requiresOneOf` choice for every module that declares it. |
| Ordering | Blocked by #223, which adds `--with` and `--json` to the same `parseArgs` and dry-run output. |
| Tests | Vitest, beside the source, as the CLI already does: `resolve.test.ts`, `add.test.ts`, and the formatter tests in `lib/`. One e2e case in `test/e2e`. |

## Approach

Resolve each named module with the existing `resolveGraph` and fold the results with `mergeGraph` (`packages/cli/src/lib/resolve.ts`). `mergeGraph` already keeps every prerequisite ahead of its dependents, and `add` already uses it for a picked driver. The rest of the pipeline (`buildPlan`, `detectConflicts`, `detectCollisions`, `applyAndPersist`, the lock and the manifest) already works on a graph with many modules, because `add teams` installs its prerequisites in one plan today. The work is to turn the single `requested: string` into a list wherever it is read.

### Phase 1: parse and resolve several names (#233)

- `parseArgs` returns `names: string[]` in place of `name`, and stops reporting extra positionals as unknown. Keep the unknown-flag rule.
- Parse every name with `parseCoordinate`. Refuse when the coordinates name different sources, and say which two differ.
- Refuse `owner/repo` with no module when other names are present. De-duplicate repeated names.
- Add a `resolveGraphs(source, names)` helper beside `resolveGraph` that resolves each root and folds them with `mergeGraph`. It also returns a `rootOf` map from each module in the graph to the first named root that pulled it in.
- Read every named descriptor before planning, and refuse with the full list of names the source does not have.
- Update `add.test.ts`'s `parseArgs` cases: "reports a second positional as an extra argument" becomes "keeps every positional as a name".

Done when: `saasaloy add waitlist nosuch other --dry-run` in `.dev` refuses with one message that names `nosuch` and `other`, and `pnpm --filter saasaloy test` passes.

### Phase 2: one plan for the set (#233)

- `requested` becomes `requested: string[]` in `buildPlan`, `summarizePlan`, `formatCliMismatches`, `formatMissingRequirements`, `formatConflicts`, `formatCollisions`, `formatOwnedCollisions`, `formatIncomplete` and `formatRecovery`. Each formatter uses `rootOf` for the "required by" clause. With one name, every message reads as it does today.
- The install set is every module in the merged graph that is not installed, plus every named module that is installed when `--force` is set.
- Print a note for each named module that is skipped because it is installed.
- `summarizePlan` lists the prerequisites under each named root that pulled them in.
- `pinToLock` takes the forced named modules and returns one pinned coordinate, or refuses on a split as the Lock pinning row says.

Done when: in a fresh `.dev` project, `saasaloy add admin teams --yes` writes both modules and their prerequisites in one run, and the closing line names every installed module. Then `saasaloy add admin teams --yes` again prints "Nothing to do" and exits 0. And `saasaloy add database-d1 database-postgres --yes` exits 2 with the conflict message while `git status --short` in `.dev` prints nothing new. A unit test in `add.test.ts` shows `pinToLock` refuses two forced modules with different SHAs.

### Phase 3: pickers, flags and JSON (#233)

- Bare `saasaloy add` in a terminal opens `multiselect` over the modules not yet installed. No TTY still refuses and names the usage.
- `--with` answers a `requiresOneOf` choice for every module in the set that declares it, after #223 lands.
- `--dry-run --json` adds `requested`.
- Update the `add` usage line and `HELP` to `saasaloy add [<module>...|<owner/repo[@ref]/module>...|<owner/repo>]`.
- Update `docs/wiki/reference.md` and `docs/wiki/how-to/add-a-module.md` to show `add` with several modules.

Done when: `saasaloy add waitlist teams --dry-run --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0));if(d.requested.join()!=="waitlist,teams")process.exit(1)'` exits 0, and the e2e case for two modules passes under `pnpm --filter saasaloy test:e2e`.

## Non-goals

- Rollback of a partial apply. That is #49. This plan only moves every refusal ahead of the first write.
- Names from more than one registry source in one run.
- Preset or bundle modules.
- Several names for `remove` and `update`.
- Edits to the `saasaloy-build` skill. It does not exist yet (plan 0074 Phase 11, #228); the comment on #228 carries the note.
