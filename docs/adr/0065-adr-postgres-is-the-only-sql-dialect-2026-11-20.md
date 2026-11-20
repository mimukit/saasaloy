# 0065: Postgres is the only SQL dialect

Saasaloy supported two SQL dialects through two database drivers, `database-d1` (SQLite on Cloudflare D1) and `database-postgres`. The owner decided on 2026-11-19 that Saasaloy supports one dialect, Postgres. No project runs D1, so the change needs no data migration. Settled in the grill of plan [0117](../plans/0117-plan-postgres-only-2026-11-20.md) (issue [#366](https://github.com/mimukit/saasaloy/issues/366)), from change 3 of [research 0010](../research/0010-research-restart-retrospective-2026-11-17.md).

The second dialect cost more than its own 21 files. On `main` at `17c4da66`, 14 modules shipped 17 twin schema or helper files (`X.sqlite.ts` or `X.d1.ts` beside `X.pg.ts`), and 34 file entries carried `onlyWith` to pick one twin. `cms` and `auth-phone` carried 6 more driver gates through `when.installed`. CI ran the e2e suite on two legs, and `scaffold:check`, the playground and `release-smoke` defaulted to D1. About 50 code comments in 14 modules explained a design by a D1 limit: no interactive transaction, at most 100 bound parameters to a statement, no `::text` cast, no `SELECT … FOR UPDATE`. In the PrimeShopr replay of [research 0013](../research/0013-research-three-way-merge-replay-2026-11-20.md), one dialect variant recorded as the source of the auth schema turned 2 merge conflicts into 19.

**Postgres is the only SQL dialect a Saasaloy module targets.** `database-d1` is deleted from the registry, every twin file goes, and each surviving `.pg.ts` source drops its suffix with no change to its target path. A module author writes one schema file against `pg-core`.

**`onlyWith` is removed** from the descriptor schema, from every descriptor and from the CLI. Every use of it named a database driver, and no other module used it.

**`conflictsWith` and `requiresOneOf` stay.** The `api-keys` owners use them ([ADR 0055](0055-adr-an-api-key-owner-is-a-driver-chosen-at-add-time-2026-10-22.md)), and `database` keeps `requiresOneOf: ["database-postgres"]`, so `add database` still pulls the driver in.

## Status

accepted. Supersedes [ADR 0026](0026-adr-database-driver-split-2026-08-28.md) where 0026 keeps D1 as the default and as a second driver; its core and driver split stands. Amends [ADR 0001](0001-adr-all-in-on-cloudflare-2026-07-22.md) and [ADR 0042](0042-adr-the-db-lifecycle-commands-belong-to-the-drivers-2026-09-20.md).

## Considered Options

- **Keep both dialects.** Rejected. Every module with a table pays for two schema files, every update merges a dialect variant, and the D1 side carried code shaped around limits Postgres does not have.
- **Merge `database-postgres` into `database` now.** Rejected for this change. The old engine reports a vanished module and skips it, so a project update would break. The render engine of issue [#365](https://github.com/mimukit/saasaloy/issues/365) can render a rename, and issue [#371](https://github.com/mimukit/saasaloy/issues/371) holds the merge.
- **Keep `onlyWith` in the CLI for a later dialect.** Rejected. The owner chose one dialect, and the #365 engine would carry dead code.
- **Ship a D1 to Postgres migration path.** Rejected. No project runs D1.

## Consequences

- **`database` and `database-postgres` stay two modules** until #371 merges them. `database-postgres` drops `conflictsWith`, because it has no sibling.
- **`saasaloy add database-d1` no longer resolves.** A descriptor that declares `onlyWith` no longer validates. A descriptor read at an older release still loads: the CLI reads its `onlyWith` as `when.installed`, so the base of a merge keeps every module. The base search no longer covers a move between SQL drivers (ADR 0068, amended). The CHANGELOG lists these under BREAKING CHANGES.
- **Code shaped by a D1 limit keeps its behaviour** until issue [#372](https://github.com/mimukit/saasaloy/issues/372) simplifies it: the batched audit inserts in `admin`, the one-batch seed plan in `database`, `CAST(... AS TEXT)` in the `payment` store. Only the comments that named D1 as the reason changed.
- **Local development and CI run Postgres.** On a laptop `db:setup` starts its Docker backend, and CI uses a `postgres:18` service container. Local development now needs Docker.
- **A deploy needs a Postgres host.** Neon's free tier gives each project 1 GB and 100 compute hours a month with no credit card, and Hyperdrive is on the Workers Free plan with 100,000 queries a day (both read 2026-11-20). A deploy no longer works with a Cloudflare account alone.
- **No migration path.** A project that wants D1 ports its own schema and owns that fork; every update that touches a table then conflicts.
- **History ADRs stay as written.** [ADR 0004](0004-adr-httponly-cookies-and-subdomains-2026-07-22.md), 0018, 0019, 0043, 0048 and 0063 describe D1 as it was when they were settled.

## References

Issue [#366](https://github.com/mimukit/saasaloy/issues/366). Plan: [`0117-plan-postgres-only-2026-11-20.md`](../plans/0117-plan-postgres-only-2026-11-20.md). Research: [0010](../research/0010-research-restart-retrospective-2026-11-17.md) change 3, [0013](../research/0013-research-three-way-merge-replay-2026-11-20.md). Follow-ups: [#371](https://github.com/mimukit/saasaloy/issues/371), [#372](https://github.com/mimukit/saasaloy/issues/372). The reader's page: [Why Postgres, not D1](../wiki/why-postgres.md).
