# Why Postgres, not D1

Saasaloy supports one SQL dialect, Postgres. Every module with a table ships one schema file written against Drizzle's `pg-core`, and `database-postgres` is the one driver behind `database`. Until this change a project could also pick a second driver for Cloudflare D1, which runs SQLite.

## The decision

The owner decided on 2026-11-19 that Saasaloy supports Postgres only. No project ran D1, so no data migration was needed. [ADR 0065](../adr/0065-adr-postgres-is-the-only-sql-dialect-2026-11-20.md) records the decision and its consequences, and it supersedes the part of [ADR 0026](../adr/0026-adr-database-driver-split-2026-08-28.md) that kept D1 as the default driver.

## The D1 limits that shaped Saasaloy code

A module that had to run on both dialects could use only what both allowed. Four D1 limits left marks you can still find in the code. The behaviour stays until issue [#372](https://github.com/mimukit/saasaloy/issues/372) simplifies it.

- **No interactive transaction.** D1 cannot open a transaction, read a row back, and decide what to write next. The `admin` write wrapper (`modules/admin/files/api/lib/admin-write.ts`) could not roll a change back with its audit rows on D1, so each statement committed as it ran. The `database` seed engine computes every seed id as a UUIDv5 before the first write, so the whole seed could go to D1 as one atomic `db.batch` (`modules/database/files/src/seed/id.ts` and `plan.ts`). The `cms` publish and the `notification` preference writes are ordered steps that fail safe for the same reason.
- **A cap on bound parameters.** D1 binds at most 100 parameters to one statement. The `admin` audit repository (`modules/admin/files/db/repositories/audit.ts`) binds 10 values a row, so it inserts at most 9 rows a statement and splits a long write into several statements.
- **`CAST AS TEXT`.** Postgres has no `uuid = text` operator, so the `payment` store (`modules/payment/files/api/payment-store.ts`) casts the users side of each join to text. It writes `CAST(... AS TEXT)` and not `::text`, because the same file ran on D1. The same store also matched two unique-violation shapes: SQLSTATE 23505 from Postgres and `UNIQUE constraint failed` from D1.
- **No `SELECT … FOR UPDATE`.** Checkout in `ecommerce` locks the variant rows it sells from. D1 has no row lock, so `ecommerce` depended on `database-postgres` and never ran on D1.

## D1's numbers

From Cloudflare's [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) pages, read 2026-11-20:

| Limit | Workers Free | Workers Paid |
|---|---|---|
| Database size | 500 MB | 10 GB |
| Storage per account | 5 GB | 1 TB |
| Bound parameters per query | 100 | 100 |
| Queries per Worker invocation | 50 | 1000 |
| Databases per account | 10 | 1,000,000 |
| Rows read | 5 million a day | 25 billion a month included, then $0.001 a million rows |
| Rows written | 100,000 a day | 50 million a month included, then $1.00 a million rows |

A product that outgrows 10 GB in one database has to split its data across databases.

## The cost of two dialects

The second dialect cost more than the 21 files of its driver. On `main` at `17c4da66`:

- 14 modules shipped 17 twin files, an `X.sqlite.ts` or `X.d1.ts` beside each `X.pg.ts`, and a change to a table had to land in both.
- 34 file entries carried an `onlyWith` gate to pick one twin, and the CLI carried the code that read it.
- CI ran the e2e suite on two legs, one for each driver.
- In the PrimeShopr replay of [research 0013](../research/0013-research-three-way-merge-replay-2026-11-20.md), one dialect variant recorded as the source of the auth schema turned 2 merge conflicts into 19.

## What D1 gave, and how Postgres covers it

D1 gave two things. A deploy needed only a Cloudflare account, and local development needed nothing but wrangler.

- **No account to pay for.** [Neon's free tier](https://neon.com/pricing) gives each project 1 GB and 100 compute hours a month, and it needs no credit card. Hyperdrive, the optional connection pool in front of it, is on the Workers Free plan with 100,000 queries a day ([Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)). Both were read on 2026-11-20.
- **Local development.** `pnpm db:setup` starts a Postgres container through the Docker backend of `database-postgres`, and `db:drop` throws it away. The `saasaloy-database-postgres` skill covers the `--server` and `--neon` backends too.

The loss is real. A deploy now needs a Neon account, or an account at another Postgres host. Local development now needs Docker.

## A project that wants D1

Saasaloy does not support D1. A project can port its own schema to D1, but it then owns that fork. Every Saasaloy update that touches a table conflicts with it, because each module ships its tables for Postgres only.

_Verified against `main`@`7fe1e866` on 2026-11-21._
