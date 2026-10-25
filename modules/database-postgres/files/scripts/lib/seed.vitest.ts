// Tests for the `db:seed` guard in ./seed.ts. It ships as `seed.test.ts` when testing is
// on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import {
  assertSeedServer,
  assertSeedTarget,
  assertTestTarget,
  refuseProduction,
  seedUrl,
} from "./seed";

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

describe(refuseProduction, () => {
  it("refuses NODE_ENV=production", () => {
    expect(() => refuseProduction({ NODE_ENV: "production" })).toThrow(
      /production/
    );
  });

  it("lets every other NODE_ENV through", () => {
    expect(() => refuseProduction({})).not.toThrow();
    expect(() => refuseProduction({ NODE_ENV: "development" })).not.toThrow();
  });
});

describe(seedUrl, () => {
  it("prefers DATABASE_URL from the environment", () => {
    expect(
      seedUrl(context(`${LOCAL}/app_dev`), {
        DATABASE_URL: `${LOCAL}/app_dev_x`,
      })
    ).toBe(`${LOCAL}/app_dev_x`);
  });

  it("falls back to apps/api/.env", () => {
    expect(seedUrl(context(`${LOCAL}/app_dev`), {})).toBe(`${LOCAL}/app_dev`);
  });

  it("asks for db:setup when neither has one", () => {
    expect(() => seedUrl(context(), {})).toThrow(/pnpm db:setup/);
  });
});

describe(assertSeedTarget, () => {
  it("accepts the plain database and a branch one, and names it", () => {
    expect(assertSeedTarget("app_dev", `${LOCAL}/app_dev`)).toBe("app_dev");
    expect(
      assertSeedTarget("app_dev", `${LOCAL}/app_dev_issue_207_abc123`)
    ).toBe("app_dev_issue_207_abc123");
  });

  it("refuses postgres, the maintenance database", () => {
    expect(() => assertSeedTarget("app_dev", `${LOCAL}/postgres`)).toThrow(
      /Refusing to seed "postgres"/
    );
  });

  it("refuses another project's database", () => {
    expect(() => assertSeedTarget("app_dev", `${LOCAL}/shop_dev`)).toThrow(
      /Refusing to seed/
    );
  });

  it("refuses a string that is not a URL", () => {
    expect(() => assertSeedTarget("app_dev", "app_dev")).toThrow(/not a URL/);
  });
});

describe(assertTestTarget, () => {
  it("accepts the checkout's test database, and names it", () => {
    expect(assertTestTarget(context(), `${LOCAL}/app_dev_test`)).toBe(
      "app_dev_test"
    );
  });

  it("follows the branch: a branch checkout gets its own test database", () => {
    const branch = { ...context(), database: "app_dev_issue_207_abc123" };
    expect(
      assertTestTarget(branch, `${LOCAL}/app_dev_issue_207_abc123_test`)
    ).toBe("app_dev_issue_207_abc123_test");
    expect(() => assertTestTarget(branch, `${LOCAL}/app_dev_test`)).toThrow(
      /only app_dev_issue_207_abc123_test/
    );
  });

  it("refuses the development database and a branch one", () => {
    for (const database of ["app_dev", "app_dev_issue_207_abc123"]) {
      expect(() => assertTestTarget(context(), `${LOCAL}/${database}`)).toThrow(
        new RegExp(`Refusing to use "${database}" as the test database`)
      );
    }
  });

  it("refuses postgres and another project's test database", () => {
    for (const database of ["postgres", "shop_dev_test"]) {
      expect(() => assertTestTarget(context(), `${LOCAL}/${database}`)).toThrow(
        /only app_dev_test/
      );
    }
  });

  it("refuses a string that is not a URL", () => {
    expect(() => assertTestTarget(context(), "app_dev_test")).toThrow(
      /not a URL/
    );
  });
});

describe(assertSeedServer, () => {
  const REMOTE = "postgres://app:secret@db.example.com:5432";

  it("lets the URL from apps/api/.env through", () => {
    expect(() =>
      assertSeedServer(context(`${LOCAL}/app_dev`), {})
    ).not.toThrow();
  });

  it("lets a shell DATABASE_URL on the same server through", () => {
    expect(() =>
      assertSeedServer(context(`${LOCAL}/app_dev`), {
        DATABASE_URL: `${LOCAL}/app_dev_issue_207_abc123`,
      })
    ).not.toThrow();
  });

  it("refuses a shell DATABASE_URL on another server, and names both hosts", () => {
    expect(() =>
      assertSeedServer(context(`${LOCAL}/app_dev`), {
        DATABASE_URL: `${REMOTE}/app_dev`,
      })
    ).toThrow(/db\.example\.com:5432.*127\.0\.0\.1:5432/);
  });

  it("refuses a shell DATABASE_URL when apps/api/.env has none", () => {
    expect(() =>
      assertSeedServer(context(), { DATABASE_URL: `${LOCAL}/app_dev` })
    ).toThrow(/Run pnpm db:setup first/);
  });

  it("never prints the password", () => {
    expect(() =>
      assertSeedServer(context(`${LOCAL}/app_dev`), {
        DATABASE_URL: `${REMOTE}/app_dev`,
      })
    ).toThrow(
      expect.toSatisfy((error: Error) => !error.message.includes("secret"))
    );
  });
});
