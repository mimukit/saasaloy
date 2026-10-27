// Tests for the request-scoped database client in ./db-scope.ts. `add auth` ships this
// file as `db-scope.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// It covers the contract both `db-provider.ts` variants inherit, because both re-export
// `authDb` and `dbScope` from this one file and differ only in what `withAuthScope`
// does after entering the scope. The variants themselves import `@repo/db/client`, which
// resolves only inside a scaffolded project, so they cannot be imported here.
//
// The failure being guarded is the one a manual sign-in does not catch: under
// `database-postgres` a client bound at module scope serves the first request and throws
// "Cannot perform I/O on behalf of a different request" on the second.

import { describe, expect, it } from "vitest";
import { authDb, dbScope } from "./db-scope";

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
      expect(() => (authDb as Record<string, unknown>)[prop]).toThrow(
        /outside `withAuthScope`/
      );
    }
  });

  it("names auth and the wrapper in the thrown message", () => {
    expect(() => authDb.select).toThrow(
      expect.toSatisfy((error: Error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/@repo\/auth/);
        expect(error.message).toMatch(/withAuthScope/);
        expect(error.message).toMatch(/select/);
        return true;
      })
    );
  });

  it("answers undefined for the adapter's construction-time `_` probe", () => {
    // `drizzleAdapter(authDb, …)` reads `db._?.schema` in its own body, which runs
    // while `src/auth.ts` is still loading. Throwing here would take the Worker down
    // on import rather than on a misuse.
    expect(authDb._).toBeUndefined();
  });

  it("answers undefined for `then` and for symbol probes", () => {
    // An `await` on anything holding this object probes `then`; loggers and
    // `util.inspect` probe symbols. Neither is a misuse worth throwing over.
    expect(authDb.then).toBeUndefined();
    expect(
      (authDb as unknown as Record<symbol, unknown>)[Symbol.toStringTag]
    ).toBeUndefined();
  });
});

describe("authDb inside a scope", () => {
  it("resolves the client the scope was entered with", () => {
    const db = fakeDb("a");
    dbScope.run(db, () => {
      expect(authDb.id).toBe("a");
      expect(authDb._).toStrictEqual({ fullSchema: { user: "a-user" } });
    });
  });

  it("binds a method to the real client rather than the proxy", () => {
    dbScope.run(fakeDb("a"), () => {
      const select = authDb.select as () => string;
      expect(select()).toBe("a-select");
    });
  });

  it("resolves the second scope's client, not the first", () => {
    // Two concurrent requests in one isolate: the whole reason the client cannot be
    // bound at module scope.
    dbScope.run(fakeDb("first"), () => {
      expect(authDb.id).toBe("first");
      dbScope.run(fakeDb("second"), () => {
        expect(authDb.id).toBe("second");
      });
      expect(authDb.id).toBe("first");
    });
  });

  it("keeps the client across an await inside the scope", async () => {
    await dbScope.run(fakeDb("a"), async () => {
      await Promise.resolve();
      expect(authDb.id).toBe("a");
    });
  });

  it("throws again once the scope has exited", () => {
    dbScope.run(fakeDb("a"), () => {
      expect(authDb.id).toBe("a");
    });
    expect(() => authDb.select).toThrow(/outside `withAuthScope`/);
  });
});
