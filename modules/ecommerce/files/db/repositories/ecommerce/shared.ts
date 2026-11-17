import type { Db } from "../../client";

// What every ecommerce repository shares: the executor type and the id helper.
//
// A repository function takes a `Db` or an open transaction. One that needs several writes
// to land together opens `db.transaction(...)` itself; inside a caller's transaction, or
// inside a route test's, that becomes a savepoint, so the caller's rollback still wins.

/** An open Drizzle transaction on the Postgres client. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The client or an open transaction. */
export type Executor = Db | Tx;

export function newId(): string {
  return crypto.randomUUID();
}

/** A `Date` as a SQL `timestamptz` parameter. */
export function isoTime(date: Date): string {
  return date.toISOString();
}
