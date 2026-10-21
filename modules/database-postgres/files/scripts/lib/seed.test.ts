// Tests for the `db:seed` guard in ./seed.ts. Repo-only, like ./branch-name.test.ts: the
// descriptor does not ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context } from "./context.ts";
import {
  assertSeedServer,
  assertSeedTarget,
  assertTestTarget,
  refuseProduction,
  seedUrl,
} from "./seed.ts";

function context(databaseUrl?: string): Context {
  const values = new Map<string, string>();
  if (databaseUrl) {
    values.set("DATABASE_URL", databaseUrl);
  }
  return {
    database: "app_dev",
    env: { exists: true, lines: [], path: "/x/apps/api/.env", values },
    isDefaultBranch: true,
    prefix: "app_dev",
    root: "/x",
    statePath: "/x/apps/api/.env.db",
  };
}

const LOCAL = "postgres://postgres:postgres@127.0.0.1:5432";

describe("refuseProduction", () => {
  it("refuses NODE_ENV=production", () => {
    assert.throws(
      () => refuseProduction({ NODE_ENV: "production" }),
      /production/
    );
  });

  it("lets every other NODE_ENV through", () => {
    refuseProduction({});
    refuseProduction({ NODE_ENV: "development" });
  });
});

describe("seedUrl", () => {
  it("prefers DATABASE_URL from the environment", () => {
    assert.equal(
      seedUrl(context(`${LOCAL}/app_dev`), {
        DATABASE_URL: `${LOCAL}/app_dev_x`,
      }),
      `${LOCAL}/app_dev_x`
    );
  });

  it("falls back to apps/api/.env", () => {
    assert.equal(seedUrl(context(`${LOCAL}/app_dev`), {}), `${LOCAL}/app_dev`);
  });

  it("asks for db:setup when neither has one", () => {
    assert.throws(() => seedUrl(context(), {}), /pnpm db:setup/);
  });
});

describe("assertSeedTarget", () => {
  it("accepts the plain database and a branch one, and names it", () => {
    assert.equal(assertSeedTarget("app_dev", `${LOCAL}/app_dev`), "app_dev");
    assert.equal(
      assertSeedTarget("app_dev", `${LOCAL}/app_dev_issue_207_abc123`),
      "app_dev_issue_207_abc123"
    );
  });

  it("refuses postgres, the maintenance database", () => {
    assert.throws(
      () => assertSeedTarget("app_dev", `${LOCAL}/postgres`),
      /Refusing to seed "postgres"/
    );
  });

  it("refuses another project's database", () => {
    assert.throws(
      () => assertSeedTarget("app_dev", `${LOCAL}/shop_dev`),
      /Refusing to seed/
    );
  });

  it("refuses a string that is not a URL", () => {
    assert.throws(() => assertSeedTarget("app_dev", "app_dev"), /not a URL/);
  });
});

describe("assertTestTarget", () => {
  it("accepts the checkout's test database, and names it", () => {
    assert.equal(
      assertTestTarget(context(), `${LOCAL}/app_dev_test`),
      "app_dev_test"
    );
  });

  it("follows the branch: a branch checkout gets its own test database", () => {
    const branch = { ...context(), database: "app_dev_issue_207_abc123" };
    assert.equal(
      assertTestTarget(branch, `${LOCAL}/app_dev_issue_207_abc123_test`),
      "app_dev_issue_207_abc123_test"
    );
    assert.throws(
      () => assertTestTarget(branch, `${LOCAL}/app_dev_test`),
      /only app_dev_issue_207_abc123_test/
    );
  });

  it("refuses the development database and a branch one", () => {
    for (const database of ["app_dev", "app_dev_issue_207_abc123"]) {
      assert.throws(
        () => assertTestTarget(context(), `${LOCAL}/${database}`),
        new RegExp(`Refusing to use "${database}" as the test database`)
      );
    }
  });

  it("refuses postgres and another project's test database", () => {
    for (const database of ["postgres", "shop_dev_test"]) {
      assert.throws(
        () => assertTestTarget(context(), `${LOCAL}/${database}`),
        /only app_dev_test/
      );
    }
  });

  it("refuses a string that is not a URL", () => {
    assert.throws(
      () => assertTestTarget(context(), "app_dev_test"),
      /not a URL/
    );
  });
});

describe("assertSeedServer", () => {
  const REMOTE = "postgres://app:secret@db.example.com:5432";

  it("lets the URL from apps/api/.env through", () => {
    assertSeedServer(context(`${LOCAL}/app_dev`), {});
  });

  it("lets a shell DATABASE_URL on the same server through", () => {
    assertSeedServer(context(`${LOCAL}/app_dev`), {
      DATABASE_URL: `${LOCAL}/app_dev_issue_207_abc123`,
    });
  });

  it("refuses a shell DATABASE_URL on another server, and names both hosts", () => {
    assert.throws(
      () =>
        assertSeedServer(context(`${LOCAL}/app_dev`), {
          DATABASE_URL: `${REMOTE}/app_dev`,
        }),
      /db\.example\.com:5432.*127\.0\.0\.1:5432/
    );
  });

  it("refuses a shell DATABASE_URL when apps/api/.env has none", () => {
    assert.throws(
      () => assertSeedServer(context(), { DATABASE_URL: `${LOCAL}/app_dev` }),
      /Run pnpm db:setup first/
    );
  });

  it("never prints the password", () => {
    assert.throws(
      () =>
        assertSeedServer(context(`${LOCAL}/app_dev`), {
          DATABASE_URL: `${REMOTE}/app_dev`,
        }),
      (error: Error) => !error.message.includes("secret")
    );
  });
});
