// Tests for the request-scoped database client in ./db-scope.ts. This file is NOT in
// the descriptor's `scaffolds[].files` list, so `add auth` never copies it into a user's
// project — it exists for this repo only. `src/env.test.ts` records the rest of the
// convention: `node:test` rather than vitest, and an explicit `.ts` on the import.
//
// It covers the contract both `db-provider.ts` variants inherit, because both re-export
// `authDb` and `dbScope` from this one file and differ only in what `withAuthScope`
// does after entering the scope. The variants themselves import `@repo/db/client`, which
// resolves only inside a scaffolded project, so they cannot be imported here.
//
// The failure being guarded is the one a manual sign-in does not catch: under
// `database-postgres` a client bound at module scope serves the first request and throws
// "Cannot perform I/O on behalf of a different request" on the second.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authDb, dbScope } from "./db-scope.ts";

/** A stand-in for a Drizzle client: enough surface to tell two of them apart. */
function fakeDb(id: string) {
  return {
    id,
    _: { fullSchema: { user: `${id}-user` } },
    select() {
      // `this` proves the method was bound to the real client, not to the proxy.
      return `${(this as { id: string }).id}-select`;
    },
  };
}

describe("authDb outside a scope", () => {
  it("throws when the adapter reads a query method", () => {
    for (const prop of ["select", "insert", "update", "delete", "query"]) {
      assert.throws(
        () => (authDb as Record<string, unknown>)[prop],
        /outside `withAuthScope`/,
        `reading ${prop} outside a scope must throw`
      );
    }
  });

  it("names auth and the wrapper in the thrown message", () => {
    assert.throws(
      () => authDb.select,
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /@repo\/auth/);
        assert.match(error.message, /withAuthScope/);
        assert.match(error.message, /select/);
        return true;
      }
    );
  });

  it("answers undefined for the adapter's construction-time `_` probe", () => {
    // `drizzleAdapter(authDb, …)` reads `db._?.schema` in its own body, which runs
    // while `src/auth.ts` is still loading. Throwing here would take the Worker down
    // on import rather than on a misuse.
    assert.equal(authDb._, undefined);
  });

  it("answers undefined for `then` and for symbol probes", () => {
    // An `await` on anything holding this object probes `then`; loggers and
    // `util.inspect` probe symbols. Neither is a misuse worth throwing over.
    assert.equal(authDb.then, undefined);
    assert.equal(
      (authDb as unknown as Record<symbol, unknown>)[Symbol.toStringTag],
      undefined
    );
  });
});

describe("authDb inside a scope", () => {
  it("resolves the client the scope was entered with", () => {
    const db = fakeDb("a");
    dbScope.run(db, () => {
      assert.equal(authDb.id, "a");
      assert.deepEqual(authDb._, { fullSchema: { user: "a-user" } });
    });
  });

  it("binds a method to the real client rather than the proxy", () => {
    dbScope.run(fakeDb("a"), () => {
      const select = authDb.select as () => string;
      assert.equal(select(), "a-select");
    });
  });

  it("resolves the second scope's client, not the first", () => {
    // Two concurrent requests in one isolate: the whole reason the client cannot be
    // bound at module scope.
    dbScope.run(fakeDb("first"), () => {
      assert.equal(authDb.id, "first");
      dbScope.run(fakeDb("second"), () => {
        assert.equal(authDb.id, "second");
      });
      assert.equal(authDb.id, "first");
    });
  });

  it("keeps the client across an await inside the scope", async () => {
    await dbScope.run(fakeDb("a"), async () => {
      await Promise.resolve();
      assert.equal(authDb.id, "a");
    });
  });

  it("throws again once the scope has exited", () => {
    dbScope.run(fakeDb("a"), () => {
      assert.equal(authDb.id, "a");
    });
    assert.throws(() => authDb.select, /outside `withAuthScope`/);
  });
});
