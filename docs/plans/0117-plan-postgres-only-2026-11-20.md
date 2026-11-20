# Plan: remove the D1 driver and support Postgres only

Grilled: 2026-11-20

Updated: 2026-11-20, after the grill. The owner kept the removal and added the why-Postgres wiki page and the `apps/web` landing site to Phase 4. The owner settled both rows in the session, so the stamp stands.

Issue: [#366](https://github.com/mimukit/saasaloy/issues/366). Sources: [`docs/research/0010-research-restart-retrospective-2026-11-17.md`](../research/0010-research-restart-retrospective-2026-11-17.md) (change 3), [`docs/research/0013-research-three-way-merge-replay-2026-11-20.md`](../research/0013-research-three-way-merge-replay-2026-11-20.md), and the engine plan [`0116-plan-render-and-merge-engine-2026-11-20.md`](0116-plan-render-and-merge-engine-2026-11-20.md).

## Context

The owner decided on 2026-11-19 that Saasaloy supports one SQL dialect, Postgres. No project runs D1, so no data migration path is necessary.

The D1 driver costs more than its 21 files. On `main` at `17c4da66`:

- 14 modules ship 17 twin schema or helper files (`X.sqlite.ts` or `X.d1.ts` beside `X.pg.ts`), and 34 file entries carry `onlyWith`. Every `onlyWith` names `database-d1` or `database-postgres`, and no other module uses the field.
- `cms` and `auth-phone` carry 6 more driver gates through `when.installed`, 3 of them on `database-d1`.
- `scripts/table-names.test.ts` enforces the twin rule. `scaffold:check`, `playground`, `verify-e2e`, `release-smoke` and the `e2e.yml` matrix default to D1 or test both drivers.
- About 50 code comments in 14 modules explain a design by a D1 limit (no interactive transaction, the 100-parameter cap, `CAST AS TEXT`).
- D1 appears in 12 shipped skills, 8 hand-written wiki pages, `README.md`, `AGENTS.md`, `CONTEXT.md`, `llms.txt` and 25 ADRs.
- In the PrimeShopr replay of research 0013, a dialect variant recorded as the source of the auth schema turned 2 merge conflicts into 19.

`conflictsWith` and `requiresOneOf` stay. The `api-keys` driver pair uses them (ADR 0055), and the engine of #365 reuses `lib/requires.ts` and `lib/conflicts.ts`.

Goal: a module author writes one schema file for one dialect, and a project update carries no dialect variant into the merge.

Target: 0 `onlyWith` entries (baseline 34), 0 twin files (baseline 17), and 0 files that name `database-d1` outside the allowed history paths (baseline about 190 files). The allowed paths are `docs/adr/`, `docs/plans/`, `docs/research/`, `docs/refactor/`, `docs/qa/`, `docs/status/` and `packages/cli/CHANGELOG.md`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Data migration | None. No project runs D1 (owner, 2026-11-19). |
| `database` and `database-postgres` | Stay two modules in this issue. `database` keeps `requiresOneOf: ["database-postgres"]`, so `add database` still pulls the driver. `database-postgres` drops `conflictsWith`. The merge into one module waits for a rename path in the #365 engine, and a follow-up issue holds it. |
| `onlyWith` | Removed from every descriptor, from `registry-item.schema.json`, and from the old engine (`applier.ts`, `add.ts`, `schema.ts`, `updater.ts`, `when.ts`) with its tests. The #365 engine then never implements it. |
| `conflictsWith` and `requiresOneOf` | Kept in the schema and the CLI for the `api-keys` pair. Only the database trio's values change. |
| The surviving `.pg.ts` sources | Renamed to drop the `.pg` suffix (`auth.pg.ts` becomes `auth.ts`), `ecommerce.pg.ts` included. The target paths do not change, so a project sees no difference. |
| `when.installed` driver gates in `cms` and `auth-phone` | The D1 entries go. A Postgres entry keeps its gate unchanged. |
| Code that works around a D1 limit | Behaviour stays. Only a comment that names D1 as the reason is rewritten or removed. A follow-up issue holds the simplification. |
| Local and CI database | Postgres everywhere. `scaffold:check` adds `database-postgres`. The CI `scaffold` job gets the `postgres:18` service container that `e2e.yml` already uses, and passes `--server` to `db:setup`. On a laptop, `db:setup` starts the Docker backend. |
| `release-smoke` upgrade baseline | The baseline moves from 0.5.0 with `database-d1` to 0.7.0 with `database-postgres`, the first release whose `database-postgres` exists (`requires: saasaloy >=0.7.0`). |
| README promise | Workers, Hyperdrive, KV and R2 have free plans, and Neon's free Postgres tier gives each project 1 GB and 100 compute hours a month with no credit card. Checked against https://neon.com/pricing and https://developers.cloudflare.com/hyperdrive/platform/pricing/ on 2026-11-20. Neon suspends compute after 5 idle minutes and never pauses the project; Supabase pauses a free project after one idle week. Hyperdrive Free fails queries past 100,000 a day. |
| ADRs | One new ADR at the next free number records Postgres as the only dialect. ADR 0026 is marked superseded by it. ADR 0001 and ADR 0042 get a dated amendment. ADRs 0029, 0033 and 0037 get a one-line amendment where they name D1 as the default or `database` as the driver example of two drivers. History ADRs (0004, 0018, 0019, 0043, 0048, 0063) stay as written. |
| Existing projects | No update note, runbook or `doctor` check, because no project runs D1. The CHANGELOG lists `saasaloy add database-d1` no longer resolving under BREAKING CHANGES. |
| Merge gate and release | The work can start now. The PR merges only after 0.9.0 is released (#358), and the change ships in 0.10.0. The CHANGELOG entry goes under an `Unreleased` heading that the 0.10.0 release takes. |
| Order against #365 | #366 merges before #365. #365 rebases onto it and never implements `onlyWith`; its Phase 7 conversion script runs again on that rebase. |
| README vendor | Name Neon with its numbers, link https://neon.com/pricing, and put the Hyperdrive limit of 100,000 queries a day in `docs/wiki/reference.md`. |
| Follow-up work | Two `needs-planning` issues, filed during the grill on 2026-11-20: #371 merges `database-postgres` into `database`, blocked by #365, and #372 simplifies the code that works around a D1 limit. |
| Outward actions | Only the afkkit authorization: commits on the issue branch, one push, one PR. The runner does not merge, and it files no issue. |
| Docker on the box | `scaffold:check` and `release:smoke` start Postgres through the Docker backend of `db:setup`. The devaloy box has Docker. |
| Why-Postgres wiki page | A new page `docs/wiki/why-postgres.md`, title "Why Postgres, not D1", section `Decisions`, mode `explanation`, with a `.wikimap.yaml` entry whose `documents` are `modules/database/**`, `modules/database-postgres/**` and the new ADR. It ships in the same PR as the removal, because until then the rest of the wiki names D1 as the default. Owner request, 2026-11-20. |
| Landing site and docs content | `apps/web`, the Saasaloy site, changes with the template: `src/content/landing.ts` (the stack line, the `d1` tile, the `database` module line and the free-tier FAQ answers) and `src/lib/module-catalog.test.ts`. The FAQ uses the Neon and Hyperdrive numbers of this table. The `/docs` site renders `docs/wiki/`, so the wiki changes reach it with no extra step. Owner request, 2026-11-20. |
| Test runner | The existing runners: `node:test` for scripts and module payload, the CLI's own suite for `packages/cli`. No new kind of test. |

## Approach

Delete the registry side first, then the engine support, then the tooling, then the words. Each phase keeps `pnpm test` green, so each phase is one commit or a small group of commits on one branch and one PR.

Rejected: merge `database-postgres` into `database` now (the old engine reports a vanished module and skips it, so PrimeShopr's update breaks; the #365 engine can render a rename and is the right place); keep `onlyWith` in the CLI for a later dialect (the owner chose one dialect, and the #365 engine would carry dead code).

### Phase 1: remove D1 from the registry

- Delete `modules/database-d1/`.
- Delete the 17 `.sqlite.ts` and `.d1.ts` twin files in `admin`, `api-keys-organization`, `api-keys-user`, `auth`, `cms`, `feature-flags`, `file-uploads`, `multitenant`, `notification`, `payment`, `sms`, `subscription`, `teams` and `waitlist`, and their descriptor entries.
- Drop `onlyWith` from the 17 surviving entries, and rename each `.pg.ts` source and its `source` path.
- Delete the D1 `when.installed` patches in `cms` (2) and `auth-phone` (1).
- Set `database`'s `requiresOneOf` to `["database-postgres"]`, and remove `database-postgres`'s `conflictsWith`.
- Remove the twin rule from `scripts/table-names.test.ts`, and keep its plural-name checks.

Done when: `ls modules/database-d1` fails; `grep -rn onlyWith modules` prints nothing; `find modules -name '*.sqlite.ts' -o -name '*.d1.ts' -o -name '*.pg.ts'` prints nothing; `pnpm test:modules` and `pnpm test:scripts` pass.

### Phase 2: remove `onlyWith` from the engine

- Remove `onlyWith` from `packages/cli/schemas/registry-item.schema.json` and from the `when` description in `update-note.schema.json`.
- Remove the variant selection and its refusal from `packages/cli/src/lib/applier.ts`, and the `onlyWith` reads from `add.ts`, `schema.ts`, `updater.ts` and `when.ts`.
- Delete or rewrite the `onlyWith` tests. A CLI test that uses `database-d1` only as a fixture name for a conflict pair may keep a fixture registry, but a test that reads the real `modules/` must not name it.
- Replace the `--with database-d1` example in `add.ts` help text, and the `d1_databases` example in `patch/jsonc.ts` and `patch/index.ts` comments with a binding that still ships (`kv_namespaces`).

Done when: `grep -rn onlyWith packages/cli/src packages/cli/schemas` prints nothing; `pnpm --filter saasaloy test` and `pnpm typecheck` pass.

### Phase 3: move the tooling and CI to Postgres

- `scripts/scaffold-check.ts`: `MVP_MODULES` names `database-postgres`; `db:setup` runs with `--server` when `SCAFFOLD_DATABASE_SERVER` is set, and otherwise starts the Docker backend. Update `scaffold-check.test.ts` and the `saasaloy-build` skill list it holds to.
- `.github/workflows/ci.yml`: the `scaffold` job gets the `postgres:18` service and sets `SCAFFOLD_DATABASE_SERVER`.
- `scripts/playground.ts` and `scripts/play-presets.json`: Postgres is the only database; remove `--db d1`.
- `scripts/verify-e2e.ts` and `.github/workflows/e2e.yml`: remove the `d1` driver and the matrix; the job runs the Postgres leg only.
- `scripts/release-smoke.ts`: remove the `full-database-d1` project and its fixtures, and move the upgrade baseline to 0.7.0 with `database-postgres`.
- `scripts/agent-bench/`, `scripts/qa-tenant-scoping*.sh`, `scripts/smoke.ts`, `scripts/update-deps.ts`: remove the D1 branches.

Done when: `pnpm test`, `pnpm scaffold:check` and `pnpm release:smoke` pass on the devaloy box with Docker; `.github/workflows/` names no `d1`.

### Phase 4: the words: docs, wiki, landing site, skills, README and ADRs

- `README.md`, `apps/web/src/content/landing.ts` and `packages/cli/templates/base/packages/ui/src/content/landing.ts`: the free-tier promise on the Neon and Hyperdrive basis of Design decisions, and the database row as "Drizzle ORM on Postgres". The landing tile names `database-postgres` only. Update `apps/web/src/lib/module-catalog.test.ts` to match.
- Write `docs/wiki/why-postgres.md` and its `.wikimap.yaml` entry. The page covers, in this order:
  1. The decision, its date (2026-11-19), and a link to the new ADR.
  2. The D1 limits that shaped Saasaloy code, each with the module that shows it: no interactive transaction (the batched writes in `admin` and the `database` seed engine), the cap on bound parameters (the `admin` audit repository), `CAST AS TEXT` in the `payment` store, and no `SELECT … FOR UPDATE`, so `ecommerce` never ran on D1. Read each example from the code comments before Phase 4 rewrites them.
  3. The D1 numbers from Cloudflare's D1 limits and pricing pages, quoted with the URL and the date read.
  4. The cost of two dialects: 17 twin files, 34 `onlyWith` gates, two CI legs, and the PrimeShopr replay where one dialect variant turned 2 merge conflicts into 19 (research 0013).
  5. What D1 gave and how the Postgres path covers it: no account (Neon's free tier needs no credit card, and Hyperdrive is on the Workers Free plan with 100,000 queries a day), and local development (the Docker backend of `db:setup`). Name the loss plainly: a deploy now needs a Neon account, and local development needs Docker.
  6. What a project that wants D1 does: Saasaloy does not support it. A project that ports its own schema to D1 owns that fork, and every update that touches a table then conflicts.
- The base template skills (`saasaloy-build`, `saasaloy-setup` and its product-spec template, `saasaloy-deploy`, `saasaloy-env`, `saasaloy-feature`, `saasaloy-testing`), `AGENTS.md`, `_env.example` and `docs/runbook-deploy.md` of the base template: remove the driver question and every D1 path.
- The module skills that name D1 (`database`, `database-postgres`, `auth`, `waitlist`, `admin`, `api`, `ecommerce`, `e2e`, `infra-ci-deploy`, `queue`, `notification`, `payment`).
- The D1 comments in module code: rewrite or remove; change no behaviour.
- `AGENTS.md`, `CONTEXT.md` (the driver-module entry keeps `api-keys` as its example), `llms.txt`, `modules/README.md` and the 8 hand-written wiki pages.
- The new ADR, and the amendments of Design decisions.
- `packages/cli/CHANGELOG.md`: a BREAKING CHANGES entry under the unreleased version.
- Run `pnpm docs:generate` and `pnpm docs:freshness`.

Done when: `pnpm lint`, `pnpm docs:check`, `pnpm docs:freshness` and `pnpm test` pass; `docs/wiki/why-postgres.md` is in `.wikimap.yaml` and renders at `/docs/why-postgres` in a build of `apps/web`; `grep -rIn '\bD1\b' apps/web/src` prints nothing; and `grep -rIl 'database-d1' . --exclude-dir={node_modules,.git,.dev} | grep -vE '^\./(docs/(adr|plans|research|refactor|qa|status)/|packages/cli/CHANGELOG\.md)'` prints nothing.

## Open questions

None. The grill on 2026-11-20 settled the merge gate, the order against #365, the README vendor, the follow-up issues and the Docker question. They are rows in Design decisions.

## Non-goals

- A data migration from D1.
- Any change to `kv-cloudflare`, `queue-cloudflare` or `storage-cloudflare`.
- The merge of `database` and `database-postgres` into one module.
- A simplification of code that works around a D1 limit.
- Any change to the add, update and remove engines beyond removing `onlyWith` (that is #365).
