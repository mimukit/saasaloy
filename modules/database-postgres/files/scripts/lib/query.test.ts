// Tests for ./query.ts. Repo-only, like ./state.test.ts: the descriptor does not ship it.
// Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_TRACE,
  assertPrivateFile,
  assertReadonlyUrl,
  normalizeEmail,
  parseQueryArgs,
  readonlyEnvPath,
} from "./query.ts";

const PREFIX = "acme_shop_dev";
const ROLE = "acme_shop_ro";
const PATH = "/home/ada/.config/acme_shop/prod-readonly.env";
const RO = "postgres://acme_shop_ro:pw@10.0.0.9:5432/acme_shop_production";
const DEV = "postgres://dev:pw@10.0.0.1:5432/acme_shop_dev";

function check(url?: string): ReturnType<typeof assertReadonlyUrl> {
  return assertReadonlyUrl({
    url,
    devPrefix: PREFIX,
    devUrl: DEV,
    role: ROLE,
    path: PATH,
  });
}

describe("readonlyEnvPath", () => {
  it("puts the file under ~/.config/<project>", () => {
    assert.equal(readonlyEnvPath("/home/ada", PREFIX), PATH);
  });
});

describe("parseQueryArgs", () => {
  it("reads the SQL and the default row cap", () => {
    assert.deepEqual(parseQueryArgs(["select 1"]), {
      kind: "sql",
      sql: "select 1",
      maxRows: 200,
    });
  });

  it("leaves the SQL to stdin when no argument came", () => {
    assert.deepEqual(parseQueryArgs([]), { kind: "sql", maxRows: 200 });
    assert.deepEqual(parseQueryArgs(["--max-rows", "5"]), {
      kind: "sql",
      maxRows: 5,
    });
  });

  it("skips the leading -- pnpm forwards", () => {
    assert.deepEqual(parseQueryArgs(["--", "select 1", "--max-rows", "10"]), {
      kind: "sql",
      sql: "select 1",
      maxRows: 10,
    });
  });

  it("takes --max-rows from 1 to 5000 only", () => {
    assert.equal(parseQueryArgs(["x", "--max-rows", "1"]).maxRows, 1);
    assert.equal(parseQueryArgs(["x", "--max-rows", "5000"]).maxRows, 5000);
    for (const bad of ["0", "5001", "2.5", "ten", "-1"]) {
      assert.throws(
        () => parseQueryArgs(["x", "--max-rows", bad]),
        /--max-rows/,
        bad
      );
    }
    assert.throws(() => parseQueryArgs(["x", "--max-rows"]), /needs a value/);
  });

  it("reads --auth-trace and lowers the email", () => {
    assert.deepEqual(parseQueryArgs(["--auth-trace", " Ada@Example.COM "]), {
      kind: "auth-trace",
      email: "ada@example.com",
      maxRows: 200,
    });
  });

  it("refuses SQL beside --auth-trace, two SQL arguments, and unknown flags", () => {
    assert.throws(
      () => parseQueryArgs(["select 1", "--auth-trace", "a@b.co"]),
      /takes no SQL/
    );
    assert.throws(() => parseQueryArgs(["select 1", "select 2"]), /one quoted/);
    assert.throws(() => parseQueryArgs(["--unmask"]), /Unknown flag --unmask/);
  });
});

describe("normalizeEmail", () => {
  it("refuses a value with no @", () => {
    assert.throws(() => normalizeEmail("ada"), /not an email/);
  });
});

describe("assertPrivateFile", () => {
  it("passes mode 600 and 400", () => {
    assert.doesNotThrow(() => {
      assertPrivateFile(PATH, 0o600);
    });
    assert.doesNotThrow(() => {
      assertPrivateFile(PATH, 0o400);
    });
  });

  it("refuses a file the group or others can read", () => {
    assert.throws(() => {
      assertPrivateFile(PATH, 0o644);
    }, /mode 644.*chmod 600/);
    assert.throws(() => {
      assertPrivateFile(PATH, 0o640);
    }, /mode 640/);
    assert.throws(() => {
      assertPrivateFile(PATH, 0o602);
    }, /mode 602/);
  });
});

describe("assertReadonlyUrl", () => {
  it("passes the production database as the read-only role", () => {
    assert.deepEqual(check(RO), {
      url: RO,
      database: "acme_shop_production",
      host: "10.0.0.9:5432",
    });
  });

  it("refuses an empty or missing URL", () => {
    assert.throws(() => check(""), /has no PROD_READONLY_DATABASE_URL/);
    assert.throws(() => check(), /has no PROD_READONLY_DATABASE_URL/);
  });

  it("refuses another database", () => {
    assert.throws(
      () => check("postgres://acme_shop_ro:pw@10.0.0.9:5432/acme_shop_staging"),
      /names acme_shop_staging, not acme_shop_production/
    );
  });

  it("refuses the dev server", () => {
    assert.throws(
      () =>
        check("postgres://acme_shop_ro:pw@10.0.0.1:5432/acme_shop_production"),
      /development server/
    );
  });

  it("refuses another user", () => {
    assert.throws(
      () => check("postgres://acme_shop:pw@10.0.0.9:5432/acme_shop_production"),
      /connects as acme_shop, not acme_shop_ro/
    );
  });

  it("never prints the URL or its password", () => {
    const secret =
      "postgres://acme_shop:s3cret@10.0.0.9:5432/acme_shop_production";
    assert.throws(
      () => check(secret),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes("s3cret") &&
        !error.message.includes(secret)
    );
  });
});

describe("AUTH_TRACE", () => {
  const sql = AUTH_TRACE.map((query) => query.sql).join("\n");

  it("names no secret column and no verifications table", () => {
    for (const name of [
      "password",
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      "verifications",
      "identifier",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`\\b${name}\\b`), name);
    }
  });

  it("keys each query on the email as $1, and caps sessions at 20", () => {
    assert.ok(AUTH_TRACE.every((query) => query.sql.includes("email = $1")));
    assert.match(AUTH_TRACE[2]?.sql ?? "", /limit 20$/);
  });
});
