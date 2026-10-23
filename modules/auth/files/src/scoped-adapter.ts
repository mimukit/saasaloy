import type { BetterAuthOptions, DBAdapter, Where } from "better-auth";
import type { Audience } from "./authorize";

// Each Better Auth instance in `./auth.ts` reads the one `sessions` table both instances
// share, so a client session row and an admin session row sit side by side. The cookie
// names keep the two apart in an honest browser. This wrapper keeps them apart for a
// dishonest one: a user who copies the client token into the admin cookie, or the other
// way round, gets no session at all.
//
// Better Auth finds the session behind a cookie with one adapter call,
// `findOne({ model: "session", where: [{ field: "token", ... }] })`, in `findSession`.
// Every endpoint, every session middleware and every `auth.api.*` call goes through it.
// The wrapper adds `audience = <this instance>` to that lookup and to any other session
// lookup keyed on `token`, so a row of the other audience is simply not found. There is
// no extra read: the condition rides on the query Better Auth already runs.
//
// The transaction path needs its own wrap. `drizzleAdapter` runs here without the
// `transaction` option, so Better Auth's transaction hands the callback the inner adapter,
// not this wrapper. Wrapping `transaction(cb)` scopes that adapter too, so a lookup made
// inside a transaction is refused the same way. `auth.vitest.ts` pins both paths: a
// better-auth bump that moves the lookup fails the build, not a user's session.
//
// Only lookups are scoped. Writes and deletes keyed on `token` (a refresh, a sign-out)
// run unchanged: they act on a row the caller already proved it holds.

type AdapterFactory = (
  options: BetterAuthOptions
) => DBAdapter<BetterAuthOptions>;
type Lookup = Parameters<DBAdapter["findOne"]>[0];
type ManyLookup = Parameters<DBAdapter["findMany"]>[0];

/** Whether this query finds a session by its token, which is the cookie's lookup. */
function isTokenLookup(model: string, where: Where[] | undefined): boolean {
  return model === "session" && (where ?? []).some((w) => w.field === "token");
}

/** The same `where`, with this instance's audience added when it is a token lookup. */
function scopeWhere(
  model: string,
  where: Where[] | undefined,
  audience: Audience
): Where[] | undefined {
  return isTokenLookup(model, where)
    ? [...(where ?? []), { field: "audience", value: audience }]
    : where;
}

/** Wrap the two lookup methods of an adapter, or of the adapter a transaction hands out. */
function scopeLookups<A extends Pick<DBAdapter, "findOne" | "findMany">>(
  adapter: A,
  audience: Audience
): A {
  return {
    ...adapter,
    findOne: <T>(data: Lookup) =>
      adapter.findOne<T>({
        ...data,
        where: scopeWhere(data.model, data.where, audience) ?? [],
      }),
    findMany: <T>(data: ManyLookup) =>
      adapter.findMany<T>({
        ...data,
        where: scopeWhere(data.model, data.where, audience),
      }),
  };
}

/**
 * The adapter factory `betterAuth({ database })` takes, with every session lookup by
 * token limited to `audience`. Pass it what `drizzleAdapter(...)` returns.
 */
export function scopeSessionsTo(
  factory: AdapterFactory,
  audience: Audience
): AdapterFactory {
  return (options) => {
    const adapter = scopeLookups(factory(options), audience);
    return {
      ...adapter,
      transaction: (callback) =>
        adapter.transaction((trx) => callback(scopeLookups(trx, audience))),
    };
  };
}
