// Tests for ./readonly.ts. Repo-only, like ./state.test.ts: the descriptor does not ship
// it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReadonlySession,
  buildGrantPlan,
  quoteIdent,
  readonlyRoleName,
} from "./readonly.ts";
import type { ClassifiedTable, TableColumns } from "./readonly.ts";

const CLASSES: ClassifiedTable[] = [
  {
    table: "users",
    columns: { id: "plain", email: "pii", name: "pii", created_at: "plain" },
  },
  {
    table: "accounts",
    columns: { id: "plain", user_id: "plain", password: "secret" },
  },
];

const LIVE: TableColumns[] = [
  { table: "users", columns: ["id", "email", "name", "created_at"] },
  { table: "accounts", columns: ["id", "user_id", "password"] },
];

function plan(
  over: Partial<Parameters<typeof buildGrantPlan>[0]> = {}
): ReturnType<typeof buildGrantPlan> {
  return buildGrantPlan({
    database: "acme_shop_production",
    role: "acme_shop_ro",
    live: LIVE,
    superuser: false,
    classes: CLASSES,
    ...over,
  });
}

describe("readonlyRoleName", () => {
  it("swaps the _dev suffix for _ro", () => {
    assert.equal(readonlyRoleName("acme_shop_dev"), "acme_shop_ro");
  });

  it("touches only a trailing _dev", () => {
    assert.equal(readonlyRoleName("my_dev_tools_dev"), "my_dev_tools_ro");
  });
});

describe("quoteIdent", () => {
  it("double-quotes a name and doubles an inner quote", () => {
    assert.equal(quoteIdent("users"), '"users"');
    assert.equal(quoteIdent('a"b'), '"a""b"');
  });
});

describe("buildGrantPlan", () => {
  it("creates the role with no password and sets its limits", () => {
    const { statements } = plan();

    assert.match(statements[0] ?? "", /CREATE ROLE "acme_shop_ro" LOGIN;/);
    assert.match(statements[0] ?? "", /rolname = 'acme_shop_ro'/);
    assert.ok(statements.every((sql) => !/PASSWORD/i.test(sql)));
    assert.ok(
      statements.includes(
        'ALTER ROLE "acme_shop_ro" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2'
      )
    );
    assert.ok(
      statements.includes(
        'ALTER ROLE "acme_shop_ro" SET default_transaction_read_only = on'
      )
    );
    assert.ok(
      statements.includes(
        "ALTER ROLE \"acme_shop_ro\" SET statement_timeout = '15s'"
      )
    );
    assert.ok(
      statements.includes(
        "ALTER ROLE \"acme_shop_ro\" SET idle_in_transaction_session_timeout = '30s'"
      )
    );
    assert.ok(
      statements.includes(
        'GRANT CONNECT ON DATABASE "acme_shop_production" TO "acme_shop_ro"'
      )
    );
    assert.ok(
      statements.includes('GRANT USAGE ON SCHEMA public TO "acme_shop_ro"')
    );
  });

  it("sets log_statement only for a superuser", () => {
    const plain = plan();
    assert.equal(plain.auditLog, false);
    assert.ok(plain.statements.every((sql) => !sql.includes("log_statement")));

    const superuser = plan({ superuser: true });
    assert.equal(superuser.auditLog, true);
    assert.ok(
      superuser.statements.includes(
        "ALTER ROLE \"acme_shop_ro\" SET log_statement = 'all'"
      )
    );
  });

  it("revokes each table, then grants its pii and plain columns only", () => {
    const { statements, tables } = plan();

    assert.deepEqual(statements.slice(-4), [
      'REVOKE ALL ON TABLE public."accounts" FROM "acme_shop_ro"',
      'GRANT SELECT ("id", "user_id") ON TABLE public."accounts" TO "acme_shop_ro"',
      'REVOKE ALL ON TABLE public."users" FROM "acme_shop_ro"',
      'GRANT SELECT ("id", "email", "name", "created_at") ON TABLE public."users" TO "acme_shop_ro"',
    ]);
    assert.deepEqual(
      tables.find((entry) => entry.table === "accounts"),
      {
        table: "accounts",
        granted: ["id", "user_id"],
        secret: ["password"],
        unclassified: [],
      }
    );
  });

  it("never grants a whole table", () => {
    const { statements } = plan();

    assert.ok(
      statements.every((sql) => !/GRANT SELECT ON|GRANT ALL/.test(sql))
    );
    assert.ok(statements.every((sql) => !sql.includes("DEFAULT PRIVILEGES")));
  });

  it("gives an unclassified live column nothing", () => {
    const { statements, tables } = plan({
      live: [{ table: "users", columns: ["id", "email", "phone"] }],
    });

    assert.ok(
      statements.includes(
        'GRANT SELECT ("id", "email") ON TABLE public."users" TO "acme_shop_ro"'
      )
    );
    assert.deepEqual(tables[0]?.unclassified, ["phone"]);
  });

  it("gives an unclassified live table a revoke and no grant", () => {
    const { statements, tables } = plan({
      live: [{ table: "new_things", columns: ["id", "secret_sauce"] }],
    });

    assert.ok(
      statements.includes(
        'REVOKE ALL ON TABLE public."new_things" FROM "acme_shop_ro"'
      )
    );
    assert.ok(statements.every((sql) => !sql.includes('"new_things" TO')));
    assert.deepEqual(tables[0]?.unclassified, ["id", "secret_sauce"]);
  });

  it("skips a classified column the database does not have yet", () => {
    const { statements } = plan({
      live: [{ table: "users", columns: ["id", "email"] }],
    });

    assert.ok(
      statements.includes(
        'GRANT SELECT ("id", "email") ON TABLE public."users" TO "acme_shop_ro"'
      )
    );
  });

  it("reads a class only from the table's own entry", () => {
    const { tables } = plan({
      live: [{ table: "accounts", columns: ["email", "toString"] }],
    });

    assert.deepEqual(tables[0]?.granted, []);
    assert.deepEqual(tables[0]?.unclassified, ["email", "toString"]);
  });
});

describe("assertReadonlySession", () => {
  it("passes the read-only role with the read-only default", () => {
    assert.doesNotThrow(() => {
      assertReadonlySession(
        { currentUser: "acme_shop_ro", defaultReadOnly: "on" },
        "acme_shop_ro"
      );
    });
  });

  it("refuses another user", () => {
    assert.throws(() => {
      assertReadonlySession(
        { currentUser: "acme_shop", defaultReadOnly: "on" },
        "acme_shop_ro"
      );
    }, /Connected as acme_shop, not acme_shop_ro.*Nothing ran/);
  });

  it("refuses a session with the read-only default off", () => {
    assert.throws(() => {
      assertReadonlySession(
        { currentUser: "acme_shop_ro", defaultReadOnly: "off" },
        "acme_shop_ro"
      );
    }, /default_transaction_read_only is off.*readonly-grants/);
  });
});
