import { describe, expect, it } from "vitest";
import {
  assertProductionTarget,
  defaultDumpDirectory,
  dumpCommand,
  dumpFileName,
  postgresMajor,
  productionDatabaseName,
  readMode,
  runProduction,
} from "./production.ts";
import type { ProductionDeps } from "./production.ts";

// Tests for ./production.ts, the checks and the order behind `pnpm db:prod:dump` and
// `pnpm db:prod:migrate`. Every child process is a stand-in, so they need no Docker, no
// pg_dump and no database.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const PREFIX = "acme_shop_dev";
const PRODUCTION = "postgres://owner:pw@10.20.0.9:5432/acme_shop_production";
const DEV = "postgres://dev:pw@10.10.0.4:5432/acme_shop_dev_issue_81_abc";
const NOW = new Date("2026-10-22T15:45:01.123Z");
const FILE = "/backups/acme_shop_production-20261022T154501Z.dump";

describe(productionDatabaseName, () => {
  it("swaps the _dev suffix for _production", () => {
    expect(productionDatabaseName(PREFIX)).toBe("acme_shop_production");
    expect(productionDatabaseName("app_dev")).toBe("app_production");
  });
});

describe(assertProductionTarget, () => {
  it("passes the production database on its own server", () => {
    expect(
      assertProductionTarget({
        url: PRODUCTION,
        devPrefix: PREFIX,
        devUrl: DEV,
      })
    ).toStrictEqual({
      url: PRODUCTION,
      database: "acme_shop_production",
      host: "10.20.0.9:5432",
    });
  });

  it("refuses an empty or missing URL", () => {
    expect(() =>
      assertProductionTarget({ url: undefined, devPrefix: PREFIX })
    ).toThrow(/DATABASE_URL is empty/);
    expect(() =>
      assertProductionTarget({ url: "", devPrefix: PREFIX })
    ).toThrow(/DATABASE_URL is empty/);
  });

  it("refuses a URL that is not one", () => {
    expect(() =>
      assertProductionTarget({ url: "not a url", devPrefix: PREFIX })
    ).toThrow(/not a postgres/);
  });

  it("refuses any database but the production one", () => {
    for (const name of [
      "acme_shop_dev",
      "acme_shop_dev_test",
      "other_shop_production",
      "postgres",
    ]) {
      expect(() =>
        assertProductionTarget({
          url: `postgres://u:p@10.20.0.9:5432/${name}`,
          devPrefix: PREFIX,
        })
      ).toThrow(`names ${name}, not acme_shop_production`);
    }
  });

  it("refuses the production name on the development server", () => {
    expect(() =>
      assertProductionTarget({
        url: "postgres://u:p@10.10.0.4:5432/acme_shop_production",
        devPrefix: PREFIX,
        devUrl: DEV,
      })
    ).toThrow(/development server/);
  });

  it("never puts the password in a message", () => {
    expect(() =>
      assertProductionTarget({
        url: "postgres://u:secret-pw@10.20.0.9:5432/acme_shop_dev",
        devPrefix: PREFIX,
      })
    ).toThrow(/^(?!.*secret-pw)/s);
  });
});

describe(dumpFileName, () => {
  it("names the database and the UTC time to the second", () => {
    expect(dumpFileName("acme_shop_production", NOW)).toBe(
      "acme_shop_production-20261022T154501Z.dump"
    );
  });
});

describe(defaultDumpDirectory, () => {
  it("puts dumps in the home folder, named for the project", () => {
    expect(defaultDumpDirectory("/home/dev", PREFIX)).toBe(
      "/home/dev/acme_shop-backups"
    );
  });
});

describe(postgresMajor, () => {
  it("reads the major version off the compose image", () => {
    expect(
      postgresMajor("services:\n  postgres:\n    image: postgres:18\n")
    ).toBe("18");
    expect(postgresMajor('    image: "postgres:17.6-alpine"\n')).toBe("17");
  });

  it("refuses a compose file with no postgres image", () => {
    expect(() =>
      postgresMajor("services:\n  redis:\n    image: redis:8\n")
    ).toThrow(/compose.yaml names no postgres:<major> image/);
  });
});

describe(dumpCommand, () => {
  it("runs pg_dump in the matching postgres image, with the URL in the environment", () => {
    const { command, args } = dumpCommand({ local: false, major: "18" });
    expect(command).toBe("docker");
    expect(args).toContain("postgres:18");
    expect(
      args.slice(args.indexOf("-e"), args.indexOf("-e") + 2)
    ).toStrictEqual(["-e", "DATABASE_URL"]);
    expect(args.at(-1)).toBe('exec pg_dump --format=custom "$DATABASE_URL"');
  });

  it("runs the pg_dump on PATH for PG_DUMP=local", () => {
    expect(dumpCommand({ local: true, major: "18" })).toStrictEqual({
      command: "sh",
      args: ["-c", 'exec pg_dump --format=custom "$DATABASE_URL"'],
    });
  });
});

describe(readMode, () => {
  it("takes dump or migrate and nothing else", () => {
    expect(readMode(["dump"])).toBe("dump");
    expect(readMode(["migrate"])).toBe("migrate");
    expect(() => readMode([])).toThrow(/Usage/);
    expect(() => readMode(["migrate", "--force"])).toThrow(/Usage/);
    expect(() => readMode(["restore"])).toThrow(/Usage/);
  });
});

interface Recorded {
  calls: string[];
  dumped: { command: string; args: string[]; url: string; file: string }[];
  migrated: string[];
  removed: string[];
  said: string[];
}

/** Stand-ins for every side effect, recording what ran. */
function fakes(over: Partial<ProductionDeps> = {}): {
  deps: ProductionDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    dumped: [],
    migrated: [],
    removed: [],
    said: [],
  };
  const deps: ProductionDeps = {
    url: PRODUCTION,
    devPrefix: PREFIX,
    devUrl: DEV,
    local: false,
    compose: "services:\n  postgres:\n    image: postgres:18\n",
    dumpDirectory: "/backups",
    now: () => NOW,
    hasDocker: () => true,
    makeDirectory: () => {
      recorded.calls.push("mkdir");
    },
    dump: (command, args, url, file) => {
      recorded.calls.push("dump");
      recorded.dumped.push({ command, args, url, file });
      return Promise.resolve(0);
    },
    fileSize: () => 2048,
    removeFile: (file) => {
      recorded.removed.push(file);
    },
    migrate: (url) => {
      recorded.calls.push("migrate");
      recorded.migrated.push(url);
      return true;
    },
    say: (message) => {
      recorded.said.push(message);
    },
    ...over,
  };
  return { deps, recorded };
}

describe(runProduction, () => {
  it("dumps and stops for dump", async () => {
    const { deps, recorded } = fakes();

    await runProduction("dump", deps);

    expect(recorded.calls).toStrictEqual(["mkdir", "dump"]);
    expect(recorded.dumped[0]?.url).toBe(PRODUCTION);
    expect(recorded.dumped[0]?.file).toBe(FILE);
    expect(recorded.said.join("\n")).toContain(
      "Target: acme_shop_production on 10.20.0.9:5432."
    );
  });

  it("dumps first, then migrates, for migrate", async () => {
    const { deps, recorded } = fakes();

    await runProduction("migrate", deps);

    expect(recorded.calls).toStrictEqual(["mkdir", "dump", "migrate"]);
    expect(recorded.migrated).toStrictEqual([PRODUCTION]);
  });

  it("checks the target before anything runs", async () => {
    const { deps, recorded } = fakes({
      url: "postgres://u:p@10.20.0.9:5432/acme_shop_dev",
    });

    await expect(runProduction("migrate", deps)).rejects.toThrow(
      /not acme_shop_production/
    );
    expect(recorded.calls).toStrictEqual([]);
  });

  it("refuses with no Docker and no PG_DUMP=local, before it dumps", async () => {
    const { deps, recorded } = fakes({ hasDocker: () => false });

    await expect(runProduction("migrate", deps)).rejects.toThrow(
      /No Docker daemon.*PG_DUMP=local/
    );
    expect(recorded.calls).not.toContain("dump");
    expect(recorded.calls).not.toContain("migrate");
  });

  it("uses the local pg_dump without asking for Docker", async () => {
    const { deps, recorded } = fakes({
      local: true,
      hasDocker: () => {
        throw new Error("Docker was asked for");
      },
    });

    await runProduction("dump", deps);

    expect(recorded.dumped[0]?.command).toBe("sh");
  });

  it("stops the migration on a failed dump and deletes the file", async () => {
    const { deps, recorded } = fakes({
      dump: () => Promise.resolve(1),
    });

    await expect(runProduction("migrate", deps)).rejects.toThrow(
      /pg_dump failed \(exit 1\), so nothing was migrated/
    );
    expect(recorded.migrated).toStrictEqual([]);
    expect(recorded.removed).toStrictEqual([FILE]);
  });

  it("deletes the file when pg_dump cannot start", async () => {
    const { deps, recorded } = fakes({
      dump: () => Promise.reject(new Error("spawn docker ENOENT")),
    });

    await expect(runProduction("migrate", deps)).rejects.toThrow(/ENOENT/);
    expect(recorded.migrated).toStrictEqual([]);
    expect(recorded.removed).toStrictEqual([FILE]);
  });

  it("stops the migration on an empty dump", async () => {
    const { deps, recorded } = fakes({ fileSize: () => 0 });

    await expect(runProduction("migrate", deps)).rejects.toThrow(
      /pg_dump failed \(exit 0\)/
    );
    expect(recorded.migrated).toStrictEqual([]);
    expect(recorded.removed).toStrictEqual([FILE]);
  });

  it("names the dump when drizzle-kit migrate fails", async () => {
    const { deps } = fakes({ migrate: () => false });

    await expect(runProduction("migrate", deps)).rejects.toThrow(
      `drizzle-kit migrate failed. ${FILE} holds the database as it was before it started.`
    );
  });
});
