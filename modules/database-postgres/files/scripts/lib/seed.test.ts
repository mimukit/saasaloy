// Tests for the `db:seed` guard in ./seed.ts. Repo-only, like ./branch-name.test.ts: the
// descriptor does not ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context } from "./context.ts";
import { assertSeedTarget, refuseProduction, seedUrl } from "./seed.ts";

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
