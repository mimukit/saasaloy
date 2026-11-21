# Plan: keep the database split and remove its friction

Grilled: 2026-11-21

Issue: [#371](https://github.com/mimukit/saasaloy/issues/371). Sources: [`0117-plan-postgres-only-2026-11-20.md`](0117-plan-postgres-only-2026-11-20.md) (the row "`database` and `database-postgres`"), ADR 0026, ADR 0065.

## Context

#371 asked to merge `database-postgres` into `database`. The owner chose on 2026-11-21 to keep the two modules, after a check of what the merge costs:

- The CLI would need a rename path in `update`, `outdated` and the v1 conversion.
- `update` writes the new module name only on the files it renders again (`engine/apply.ts` `recordOf`). Unchanged merged files and every `once` file keep `database-postgres` in the manifest. `doctor` then reports a partial install (`lib/doctor.ts:937`) and a module that owns no files (`lib/doctor.ts:532`). `lib/collisions.ts:163-172` can refuse a claim and name `saasaloy remove database-postgres`. So the rename would also need a manifest rewrite.
- Every project with a database goes through the rename, so a bug in it breaks `update` for all of them.
- The merge gives a project no new capability.

Two points of the split still cost a user something:

- `add.ts:530` refuses an unmet `requiresOneOf` with `--yes`, `--json` or no terminal, and a terminal gets a question with one answer. `init` refuses the same way (`engine/render.ts:366`). So every scripted `saasaloy add database` needs `--with database-postgres`, and every agent must learn the flag.
- Both modules scaffold `packages/db/tsconfig.json`. The driver copy adds `node` types, `allowImportingTsExtensions` and `scripts`, and it always wins, because `database` cannot install without the driver. The core copy never survives an install, and it is the example in two comments of `lib/collisions.ts`.

Goal: a person or an agent installs the database with `saasaloy add database`, in a script or on a terminal, with no flag and no question.

Target: `saasaloy add database --yes` in `.dev` installs `database` and `database-postgres` and exits 0 (baseline: refuses, exit code `EXIT_REFUSED`); 0 copies of `packages/db/tsconfig.json` in `modules/database` (baseline 1).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Merge the two modules | No. The owner kept the split on 2026-11-21, for the cost listed in Context. |
| One-option rule | When a `requiresOneOf` list has exactly one option, `add` and `init` add that option with no question and print one line that names it. A list of two or more keeps today's prompt and refusal. |
| `--with database-postgres` | Still accepted, so an old script keeps working. |
| The core's `tsconfig.json` | `modules/database` drops it. The driver's copy is the only one. |
| Release | 0.11.0, with the Postgres-only change. Both plan 0119 and plan 0120 land on `main` before the 0.11.0 tag (grill 2026-11-21 Q1 and Q4, asked). |
| `update` and a new one-option requirement | `update` keeps its refusal (`formatUpdateRequirements`). It never installs a module the owner did not ask for (grill Q3, defaulted). |
| Issue | #371 is retitled `feat(cli): add the single requiresOneOf option without a question`, and its body records the decision against the merge (grill Q2, asked). |
| Outward actions | The build of #371 takes an issue branch, commits, a push, and one pull request. No merge, and no comment on another issue (grill Q11, asked). |
| Test runner | The CLI's own vitest suite for `packages/cli`; `node:test` for scripts and module payload. No new kind of test. |

## Approach

Change the rule in the CLI, then drop the dead file, then the words. Each phase keeps `pnpm test` green.

Rejected: merge the modules (Context lists the cost); keep everything as it is (the flag stays in every script and agent file).

### Phase 1: add the single option with no question (built 2026-11-21)

- `packages/cli/src/commands/add.ts`: before the refusal at line 530 and before the prompt, push each unmet requirement whose `options` has length 1 into `requested`, reload the side, and log `database needs database-postgres; adding it.`
- `packages/cli/src/engine/render.ts:366` (the `init` path): the same rule, through one shared helper in `lib/requires.ts` so `add` and `init` cannot drift.
- `update`: `formatUpdateRequirements` stays, per the row in Design decisions.
- Tests: `add database --yes` with no terminal succeeds and installs both; a two-option fixture (`api-keys`) still refuses; `--with` still works; `init` with a preset that lists `database` alone succeeds.

Done when: the new tests pass; `pnpm --filter saasaloy test` and `pnpm typecheck` pass; in `.dev`, `saasaloy add database --yes` exits 0 and the lock holds both modules.

### Phase 2: drop the core's `tsconfig.json` (built 2026-11-21)

- Remove `files/tsconfig.json` and its `scaffolds[]` row from `modules/database/registry-item.json`.
- `lib/collisions.ts` has no special case for this file: its `dependsOn` rule allows the override. Rewrite only the comments at lines 7-10 and 157-160, which use this file as their example.

Done when: `ls modules/database/files/tsconfig.json` fails; `pnpm test:modules` and `pnpm scaffold:check` pass; `release:smoke` updates a 0.10.0 project with a database with 0 conflict markers and `packages/db/tsconfig.json` unchanged.

### Phase 3: the words (built 2026-11-21)

- Remove `--with database-postgres` from the skills (`saasaloy-database`, `saasaloy-build`, `saasaloy-setup`), `llms.txt`, `README.md`, `modules/README.md` and the wiki. Keep it in `add.ts` help as the `--with` example only if `api-keys` makes a worse one.
- `CONTEXT.md`: the `requiresOneOf` entry states the one-option rule.
- `packages/cli/CHANGELOG.md`: one line under the unreleased version.
- Run `pnpm docs:generate`, `pnpm docs:check` and `pnpm docs:stale`.

Done when: `git grep -n -- "--with database-postgres" -- . ':!docs/adr' ':!docs/plans' ':!docs/research' ':!docs/qa' ':!docs/status' ':!packages/cli/CHANGELOG.md'` prints nothing; `pnpm test` and `pnpm lint` pass.

## Open questions

None. The grill of 2026-11-21 settled them.

## Non-goals

- The merge of the two modules.
- A second database driver.
- The code that works around a D1 limit. Plan 0120 (#372) holds it.
