import { describe, expect, it } from "vitest";
import {
  defaultDumpDirectory,
  dumpFileName,
  exportArgs,
  projectSlug,
  runDump,
} from "./dump.ts";
import type { DumpDeps } from "./dump.ts";

// Tests for ./dump.ts, the order behind `pnpm db:prod:dump`. wrangler is a stand-in, so
// they need no Cloudflare account and no network.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const NOW = new Date("2026-10-22T15:45:01.123Z");
const FILE = "/backups/app-db-20261022T154501Z.sql";

describe(projectSlug, () => {
  it("slugifies the root package name", () => {
    expect(projectSlug("@acme/shop")).toBe("acme_shop");
    expect(projectSlug("My App")).toBe("my_app");
  });

  it("falls back to app for a name that slugifies to nothing", () => {
    expect(projectSlug("")).toBe("app");
    expect(projectSlug("@/")).toBe("app");
  });
});

describe(defaultDumpDirectory, () => {
  it("puts dumps in the home folder, named for the project", () => {
    expect(defaultDumpDirectory("/home/dev", "@acme/shop")).toBe(
      "/home/dev/acme_shop-backups"
    );
  });
});

describe(dumpFileName, () => {
  it("names the database and the UTC time to the second", () => {
    expect(dumpFileName("app-db", NOW)).toBe("app-db-20261022T154501Z.sql");
  });
});

describe(exportArgs, () => {
  it("exports the remote database by name to the file", () => {
    expect(
      exportArgs("app-db", "../../apps/api/wrangler.jsonc", FILE)
    ).toStrictEqual([
      "d1",
      "export",
      "app-db",
      "--remote",
      "--config",
      "../../apps/api/wrangler.jsonc",
      "--output",
      FILE,
    ]);
  });
});

interface Recorded {
  calls: string[];
  exported: string[];
  removed: string[];
  said: string[];
}

function fakes(over: Partial<DumpDeps> = {}): {
  deps: DumpDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { calls: [], exported: [], removed: [], said: [] };
  const deps: DumpDeps = {
    database: "app-db",
    dumpDirectory: "/backups",
    now: () => NOW,
    makeDirectory: () => {
      recorded.calls.push("mkdir");
    },
    exportTo: (file) => {
      recorded.calls.push("export");
      recorded.exported.push(file);
      return 0;
    },
    fileSize: () => 4096,
    removeFile: (file) => {
      recorded.removed.push(file);
    },
    say: (message) => {
      recorded.said.push(message);
    },
    ...over,
  };
  return { deps, recorded };
}

describe(runDump, () => {
  it("exports into a new timestamped file and names it", () => {
    const { deps, recorded } = fakes();

    expect(runDump(deps)).toBe(FILE);
    expect(recorded.calls).toStrictEqual(["mkdir", "export"]);
    expect(recorded.exported).toStrictEqual([FILE]);
    expect(recorded.said.join("\n")).toContain(`Dumped app-db to ${FILE}`);
  });

  it("deletes the file and throws when wrangler fails", () => {
    const { deps, recorded } = fakes({ exportTo: () => 1 });

    expect(() => runDump(deps)).toThrow(/wrangler d1 export failed \(exit 1\)/);
    expect(recorded.removed).toStrictEqual([FILE]);
  });

  it("deletes the file and throws on an empty export", () => {
    const { deps, recorded } = fakes({ fileSize: () => 0 });

    expect(() => runDump(deps)).toThrow(/wrangler d1 export failed \(exit 0\)/);
    expect(recorded.removed).toStrictEqual([FILE]);
  });
});
