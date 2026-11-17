import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "@repo/db/client";

// The client a shop route opened, for the payment listener it may set off.
//
// The listener runs inside `createPayment(env).create`, `.submit`, `.confirm` and
// `.reject`, with only `env` in hand. It must write through the client the route is
// using: on another client it would not see an order the route has not committed, and
// under Postgres its writes would survive the route's rollback. Inside an `adminWrite`,
// `currentAdminWrite()` already answers that; a public shop route puts its client here.

const shopScope = new AsyncLocalStorage<Db>();

/** Run `body` with `db` as the shop's client. */
export function withShopDb<T>(db: Db, body: () => Promise<T>): Promise<T> {
  return shopScope.run(db, body);
}

/** The client the current shop route opened, or `undefined` outside one. */
export function currentShopDb(): Db | undefined {
  return shopScope.getStore();
}
