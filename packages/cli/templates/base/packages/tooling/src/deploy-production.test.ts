import { describe, expect, it } from "vitest";
import {
  ciState,
  deployProduction,
  gateProblems,
  gateReport,
  orderTargets,
  parseArgs,
  resolveConfig,
  smokeProblem,
  smokeRowProblems,
  smokeUrls,
  tagMessage,
  tagName,
} from "./deploy-production.ts";
import type {
  Facts,
  Io,
  Options,
  SmokeRequest,
  Workspace,
} from "./deploy-production.ts";
import type { DeployTarget, SmokeCheck } from "./types.ts";

const HEAD = "7812604aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const config = resolveConfig({});
const withCi = resolveConfig({ ciWorkflow: "ci.yml" });

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    branch: "main",
    dirty: [],
    head: HEAD,
    remoteHead: HEAD,
    ci: "passed",
    lastTag: "deploy-20261023-1430",
    newMigrations: [],
    hasDb: true,
    ...overrides,
  };
}

const plain: Options = { dryRun: false, migrate: false };

describe(parseArgs, () => {
  it("takes no flags as a plain deploy", () => {
    expect(parseArgs([])).toStrictEqual(plain);
  });

  it("reads every flag", () => {
    expect(
      parseArgs([
        "--dry-run",
        "--migrate",
        "--skip-ci",
        "Actions outage",
        "--only",
        "api",
      ])
    ).toStrictEqual({
      dryRun: true,
      migrate: true,
      skipCi: "Actions outage",
      only: "api",
    });
  });

  it("ignores the -- pnpm passes through", () => {
    expect(parseArgs(["--", "--dry-run"])).toStrictEqual({
      ...plain,
      dryRun: true,
    });
  });

  it("refuses --skip-ci without a reason", () => {
    expect(() => parseArgs(["--skip-ci"])).toThrow(/needs a reason/);
    expect(() => parseArgs(["--skip-ci", "--migrate"])).toThrow(
      /needs a reason/
    );
    expect(() => parseArgs(["--skip-ci", " "])).toThrow(/needs a reason/);
  });

  it("refuses --only without a service", () => {
    expect(() => parseArgs(["--only"])).toThrow(/--only needs a service/);
    expect(() => parseArgs(["--only", "--dry-run"])).toThrow(
      /--only needs a service/
    );
  });

  it("refuses an unknown flag", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument --force/);
  });
});

describe(ciState, () => {
  it("passes when any run on the commit succeeded", () => {
    expect(
      ciState([
        { status: "completed", conclusion: "cancelled" },
        { status: "completed", conclusion: "success" },
      ])
    ).toBe("passed");
  });

  it("waits while a run is not complete", () => {
    expect(ciState([{ status: "in_progress", conclusion: "" }])).toBe(
      "running"
    );
  });

  it("fails when every run finished without success", () => {
    expect(ciState([{ status: "completed", conclusion: "failure" }])).toBe(
      "failed"
    );
  });

  it("reports no run", () => {
    expect(ciState([])).toBe("missing");
  });
});

describe(resolveConfig, () => {
  it("fills every key an older or emptied config file lacks", () => {
    expect(resolveConfig({})).toStrictEqual({
      branches: ["main", "hotfix-*"],
      tagPrefix: "deploy-",
      ciWorkflow: undefined,
      migrations: "packages/db/migrations/*.sql",
    });
  });

  it("keeps what the project set", () => {
    expect(
      resolveConfig({ branches: ["release"], ciWorkflow: "ci.yml" })
    ).toMatchObject({ branches: ["release"], ciWorkflow: "ci.yml" });
  });
});

describe(gateProblems, () => {
  it("passes main at its pushed HEAD", () => {
    expect(gateProblems(facts(), plain, config)).toStrictEqual([]);
  });

  it("passes a hotfix branch", () => {
    expect(
      gateProblems(facts({ branch: "hotfix-prices" }), plain, config)
    ).toStrictEqual([]);
  });

  it("refuses a feature branch and names the allowed ones", () => {
    const [problem] = gateProblems(
      facts({ branch: "issue-80-admin" }),
      plain,
      config
    );
    expect(problem).toMatch(/The branch is issue-80-admin/);
    expect(problem).toMatch(/main, hotfix-\*/);
    expect(problem).toMatch(/git switch main/);
  });

  it("reads the branch list from the config", () => {
    const release = resolveConfig({ branches: ["release"] });
    expect(gateProblems(facts(), plain, release)).toHaveLength(1);
    expect(
      gateProblems(facts({ branch: "release" }), plain, release)
    ).toStrictEqual([]);
  });

  it("refuses a dirty tree and names the files", () => {
    const [problem] = gateProblems(
      facts({ dirty: ["README.md"] }),
      plain,
      config
    );
    expect(problem).toMatch(/uncommitted changes \(README.md\)/);
    expect(problem).toMatch(/git commit/);
  });

  it("refuses a branch origin does not have", () => {
    const [problem] = gateProblems(
      facts({ branch: "hotfix-prices", remoteHead: undefined }),
      plain,
      config
    );
    expect(problem).toMatch(/git push -u origin hotfix-prices/);
  });

  it("refuses a HEAD that differs from origin", () => {
    const [problem] = gateProblems(
      facts({ remoteHead: "1234567bbb" }),
      plain,
      config
    );
    expect(problem).toMatch(/HEAD \(7812604\) is not origin\/main \(1234567\)/);
  });

  it.each(["failed", "running", "missing"] as const)(
    "refuses CI that is %s, and names --skip-ci",
    (ci) => {
      const [problem] = gateProblems(facts({ ci }), plain, withCi);
      expect(problem).toMatch(/ci\.yml/);
      expect(problem).toMatch(/--skip-ci/);
    }
  );

  it("lets --skip-ci pass a red CI", () => {
    expect(
      gateProblems(
        facts({ ci: "failed" }),
        { ...plain, skipCi: "outage" },
        withCi
      )
    ).toStrictEqual([]);
  });

  it("asks for --migrate when a migration changed", () => {
    const changed = facts({
      newMigrations: ["packages/db/migrations/0012_orders.sql"],
    });
    const [problem] = gateProblems(changed, plain, config);
    expect(problem).toMatch(
      /1 migration file\(s\) changed since deploy-20261023-1430/
    );
    expect(problem).toMatch(/pnpm deploy:production --migrate/);
    expect(
      gateProblems(changed, { ...plain, migrate: true }, config)
    ).toStrictEqual([]);
  });

  it("asks for --migrate on a one-Worker deploy too", () => {
    const changed = facts({ newMigrations: ["packages/db/migrations/x.sql"] });
    expect(
      gateProblems(changed, { ...plain, only: "api" }, config)
    ).toHaveLength(1);
  });

  it("names the first commit when there is no deploy tag", () => {
    const [problem] = gateProblems(
      facts({ lastTag: undefined, newMigrations: ["a.sql"] }),
      plain,
      config
    );
    expect(problem).toMatch(/since the first commit \(no deploy tag yet\)/);
  });

  it("refuses --migrate in a project with no @repo/db", () => {
    const [problem] = gateProblems(
      facts({ hasDb: false }),
      { ...plain, migrate: true },
      config
    );
    expect(problem).toMatch(/--migrate needs the @repo\/db workspace/);
  });

  it("lists every failed gate at once", () => {
    expect(
      gateProblems(
        facts({
          branch: "x",
          dirty: ["a"],
          ci: "failed",
          newMigrations: ["b"],
        }),
        plain,
        withCi
      )
    ).toHaveLength(4);
  });
});

describe(gateReport, () => {
  it("reports the CI gate as off when the config names no workflow", () => {
    const ci = gateReport(facts({ ci: "off" }), plain, config).find(
      (gate) => gate.name === "CI"
    );
    expect(ci).toMatchObject({ state: "off" });
    expect(ci?.detail).toMatch(/CI gate: off/);
  });

  it("reports a passed gate as ok", () => {
    const states = gateReport(facts(), plain, withCi).map((gate) => gate.state);
    expect(states.every((state) => state === "ok")).toBeTruthy();
  });
});

describe(tagName, () => {
  it("writes the UTC date and minute", () => {
    expect(tagName(new Date("2026-10-23T14:30:59Z"), "deploy-")).toBe(
      "deploy-20261023-1430"
    );
  });

  it("uses the configured prefix", () => {
    expect(tagName(new Date("2026-10-23T14:30:59Z"), "live-")).toBe(
      "live-20261023-1430"
    );
  });
});

describe(tagMessage, () => {
  it("records the commit, the Workers, and the migration and CI skip when they happened", () => {
    const message = tagMessage(
      HEAD,
      { ...plain, migrate: true, skipCi: "Actions outage" },
      ["api", "web"]
    );
    expect(message).toMatch(/Production deploy of 7812604: api, web\./);
    expect(message).toMatch(
      /Ran pnpm --filter @repo\/db run db:prod:migrate first/
    );
    expect(message).toMatch(/CI gate skipped: Actions outage/);
  });

  it("leaves out what did not happen", () => {
    const message = tagMessage(HEAD, plain, ["web"]);
    expect(message).not.toMatch(/migrate|skipped/);
  });
});

describe(smokeProblem, () => {
  const api: SmokeRequest = {
    id: "api-health",
    service: "api",
    path: "/health",
    status: 200,
    body: '"ok"',
    url: "https://api.example.com/health",
  };

  it("passes the right status and body", () => {
    expect(smokeProblem(api, 200, '{"status":"ok"}')).toBeUndefined();
  });

  it("fails a wrong status", () => {
    expect(smokeProblem(api, 500, "")).toMatch(
      /https:\/\/api\.example\.com\/health answered 500, expected 200/
    );
  });

  it("fails a right status with the wrong body", () => {
    expect(smokeProblem(api, 200, "Not Found")).toMatch(/without "ok"/);
  });
});

describe(orderTargets, () => {
  const targets: DeployTarget[] = [
    { service: "web", order: 30 },
    { service: "api", order: 10 },
    { service: "admin", order: 20 },
  ];

  it("orders the installed Workers, lowest first", () => {
    expect(orderTargets(targets, ["web", "admin", "api"])).toStrictEqual({
      order: ["api", "admin", "web"],
      problems: [],
    });
  });

  it("breaks a tie by service name, so the order never depends on file order", () => {
    const tied = orderTargets(
      [
        { service: "web", order: 10 },
        { service: "docs", order: 10 },
      ],
      ["web", "docs"]
    );
    expect(tied.order).toStrictEqual(["docs", "web"]);
  });

  it("stops on a deployable workspace with no row, and names it", () => {
    const { problems } = orderTargets(
      [{ service: "web", order: 30 }],
      ["web", "api"]
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /apps\/api deploys and has no DEPLOY_TARGETS row/
    );
    expect(problems[0]).toMatch(/packages\/tooling\/src\/targets\.ts/);
  });

  it("stops on a row for a service that is not a deployable workspace", () => {
    const { problems } = orderTargets(targets, ["web"]);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/DEPLOY_TARGETS names api/);
    expect(problems.join("\n")).toMatch(/DEPLOY_TARGETS names admin/);
  });

  it("stops on a service listed twice", () => {
    const { problems } = orderTargets(
      [
        { service: "web", order: 30 },
        { service: "web", order: 40 },
      ],
      ["web"]
    );
    expect(problems.join("\n")).toMatch(/DEPLOY_TARGETS lists web twice/);
  });
});

describe(smokeRowProblems, () => {
  it("stops on a row for a service that does not deploy", () => {
    const problems = smokeRowProblems(
      [{ id: "api-health", service: "api", path: "/health", status: 200 }],
      ["web"]
    );
    expect(problems.join("\n")).toMatch(
      /SMOKE_CHECKS row api-health names api/
    );
  });

  it("stops on an id listed twice", () => {
    const row: SmokeCheck = {
      id: "home",
      service: "web",
      path: "/",
      status: 200,
    };
    expect(smokeRowProblems([row, row], ["web"]).join("\n")).toMatch(
      /SMOKE_CHECKS lists home twice/
    );
  });
});

describe(smokeUrls, () => {
  const checks: SmokeCheck[] = [
    { id: "web-home", service: "web", path: "/", status: 200 },
    { id: "web-404", service: "web", path: "/nope", status: 404 },
    { id: "api-health", service: "api", path: "/health", status: 200 },
  ];

  it("builds one request per custom domain and check of the service", () => {
    const urls = smokeUrls(
      "web",
      {
        routes: [
          { pattern: "example.com", custom_domain: true },
          { pattern: "www.example.com", custom_domain: true },
        ],
      },
      checks
    ).map((request) => request.url);
    expect(urls).toStrictEqual([
      "https://example.com/",
      "https://example.com/nope",
      "https://www.example.com/",
      "https://www.example.com/nope",
    ]);
  });

  it("ignores a zone route and a route string, which are not custom domains", () => {
    expect(
      smokeUrls(
        "web",
        {
          routes: [
            "example.com/*",
            { pattern: "example.com/*", zone_name: "example.com" },
          ],
        },
        checks
      )
    ).toStrictEqual([]);
  });

  it("answers nothing for a config with no routes", () => {
    expect(smokeUrls("api", { name: "x-api" }, checks)).toStrictEqual([]);
    expect(smokeUrls("api", undefined, checks)).toStrictEqual([]);
  });
});

// ---- The whole run, with every side effect faked -----------------------------------------

interface Fake {
  io: Io;
  said: string[];
  runs: string[];
  gits: string[];
}

interface FakeSetup {
  branch?: string;
  dirty?: string;
  remoteHead?: string | undefined;
  lastTag?: string | undefined;
  migrations?: string;
  workspaces?: Workspace[];
  routes?: Record<string, unknown>;
  hasDb?: boolean;
  runExit?: (line: string) => number;
  answer?: (url: string) => { status: number; body: string };
  pushFails?: boolean;
  noCommit?: boolean;
}

const WEB: Workspace = { service: "web", packageName: "@repo/web" };
const API: Workspace = { service: "api", packageName: "@repo/api" };

function fake(setup: FakeSetup = {}): Fake {
  const said: string[] = [];
  const runs: string[] = [];
  const gits: string[] = [];
  const remoteHead = "remoteHead" in setup ? setup.remoteHead : HEAD;
  const lastTag = "lastTag" in setup ? setup.lastTag : "deploy-20261020-0900";
  const io: Io = {
    git(args) {
      const line = args.join(" ");
      gits.push(line);
      if (setup.noCommit === true && line.startsWith("rev-parse")) {
        throw new Error("fatal: ambiguous argument 'HEAD': unknown revision");
      }
      if (line === "rev-parse --abbrev-ref HEAD") {
        return setup.branch ?? "main";
      }
      if (line === "rev-parse HEAD") {
        return HEAD;
      }
      if (line.startsWith("rev-parse --verify origin/")) {
        if (remoteHead === undefined) {
          throw new Error("unknown revision");
        }
        return remoteHead;
      }
      if (line.startsWith("status --porcelain")) {
        return setup.dirty ?? "";
      }
      if (line.startsWith("describe")) {
        if (lastTag === undefined) {
          throw new Error("no names found");
        }
        return lastTag;
      }
      if (line.startsWith("diff --name-only") || line.startsWith("ls-files")) {
        return setup.migrations ?? "";
      }
      if (line.startsWith("push") && setup.pushFails === true) {
        throw new Error("push rejected");
      }
      return "";
    },
    gh: () => "[]",
    run: async (command, args) => {
      const line = [command, ...args].join(" ");
      runs.push(line);
      return await Promise.resolve(setup.runExit?.(line) ?? 0);
    },
    fetch: async (url) => {
      const { status, body } = setup.answer?.(url) ?? { status: 200, body: "" };
      return await Promise.resolve({
        status,
        text: async () => await Promise.resolve(body),
      });
    },
    sleep: async () => {
      await Promise.resolve();
    },
    say: (text) => {
      said.push(text);
    },
    now: () => new Date("2026-10-23T14:30:00Z"),
    workspaces: () => setup.workspaces ?? [WEB],
    wranglerConfig: (service) => setup.routes?.[service],
    hasDb: () => setup.hasDb ?? false,
  };
  return { io, said, runs, gits };
}

const webDomain = {
  web: { routes: [{ pattern: "example.com", custom_domain: true }] },
};

const project = {
  config: {},
  targets: [
    { service: "web", order: 30 },
    { service: "api", order: 10 },
  ],
  smokeChecks: [
    { id: "web-home", service: "web", path: "/", status: 200 },
    { id: "api-health", service: "api", path: "/health", status: 200 },
  ],
};

describe(deployProduction, () => {
  it("runs the env check, each Worker in order, the smoke checks, then tags", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
    });
    await deployProduction(plain, run.io, project);
    expect(run.runs).toStrictEqual([
      "node packages/env/src/deploy.ts --check",
      "pnpm --filter @repo/api run deploy",
      "pnpm --filter @repo/web run deploy",
    ]);
    expect(run.gits).toContain(
      "tag --annotate deploy-20261023-1430 --message Production deploy of 7812604: api, web."
    );
    expect(run.gits).toContain("push --quiet origin deploy-20261023-1430");
    expect(run.said.join("\n")).toMatch(/api has no custom domain/);
  });

  it.each([false, true])(
    "stops with the fix, not a raw git error, in a repository with no commit (dry run: %s)",
    async (preview) => {
      const run = fake({ noCommit: true, workspaces: [WEB, API] });
      const thrown = await deployProduction(
        { ...plain, dryRun: preview },
        run.io,
        project
      ).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toMatch(/has no commit yet/);
      expect(String(thrown)).toMatch(/Run: git add -A && git commit/);
      expect(String(thrown)).not.toMatch(/ambiguous argument/);
      expect(run.runs).toStrictEqual([]);
    }
  );

  async function dryRun(): Promise<Fake> {
    const run = fake({
      branch: "issue-1",
      workspaces: [WEB, API],
      routes: webDomain,
      migrations: "packages/db/migrations/0001_init.sql",
      hasDb: true,
    });
    await deployProduction(
      { ...plain, dryRun: true, migrate: true },
      run.io,
      project
    );
    return run;
  }

  it("reports every gate, the order and the smoke checks in a dry run", async () => {
    const run = await dryRun();
    const output = run.said.join("\n");
    expect(output).toMatch(/CI gate: off/);
    expect(output).toMatch(/The branch is issue-1/);
    expect(output).toMatch(/api \(10\), web \(30\)/);
    expect(output).toMatch(/https:\/\/example\.com\/ answers 200/);
    expect(output).toMatch(/db:prod:migrate/);
  });

  it("runs no build, upload, migration or tag in a dry run", async () => {
    const run = await dryRun();
    expect(run.runs).toStrictEqual(["node packages/env/src/deploy.ts --check"]);
    expect(run.gits.some((line) => line.startsWith("tag"))).toBeFalsy();
  });

  it("stops a real run on a failed gate before anything builds, and names each fix", async () => {
    const run = fake({ dirty: " M README.md", remoteHead: undefined });
    await expect(
      deployProduction(plain, run.io, {
        config: {},
        targets: [{ service: "web", order: 30 }],
        smokeChecks: [],
      })
    ).rejects.toThrow(
      /The deploy did not start[\s\S]*git commit[\s\S]*git push -u origin main/
    );
    expect(run.runs).toStrictEqual([]);
  });

  it.each([
    [" M AGENTS.md\n?? notes.txt", "AGENTS.md, notes.txt"],
    ["M AGENTS.md\n?? notes.txt", "AGENTS.md, notes.txt"],
    ["R  old.md -> new.md", "old.md -> new.md"],
  ])(
    "names each dirty file whole from git status output %j",
    async (porcelain, named) => {
      const run = fake({ dirty: porcelain });
      await expect(
        deployProduction(plain, run.io, {
          config: {},
          targets: [{ service: "web", order: 30 }],
          smokeChecks: [],
        })
      ).rejects.toThrow(`uncommitted changes (${named})`);
    }
  );

  it("stops before anything builds when a deployable workspace has no row", async () => {
    const run = fake({ workspaces: [WEB, API] });
    await expect(
      deployProduction(plain, run.io, {
        config: {},
        targets: [{ service: "web", order: 30 }],
        smokeChecks: [],
      })
    ).rejects.toThrow(/apps\/api deploys and has no DEPLOY_TARGETS row/);
    expect(run.runs).toStrictEqual([]);
  });

  it("runs the migration with --migrate, before the first Worker", async () => {
    const run = fake({
      migrations: "packages/db/migrations/0002.sql",
      hasDb: true,
      routes: webDomain,
    });
    await deployProduction({ ...plain, migrate: true }, run.io, {
      config: {},
      targets: [{ service: "web", order: 30 }],
      smokeChecks: [],
    });
    expect(run.runs).toStrictEqual([
      "node packages/env/src/deploy.ts --check",
      "pnpm --filter @repo/db run db:prod:migrate",
      "pnpm --filter @repo/web run deploy",
    ]);
  });

  it("writes no tag when a smoke check fails, and prints a rollback per Worker", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
      answer: () => ({ status: 500, body: "" }),
    });
    await expect(deployProduction(plain, run.io, project)).rejects.toThrow(
      /No deploy tag was written[\s\S]*pnpm --filter @repo\/api exec env-deploy --run api -- wrangler rollback[\s\S]*pnpm --filter @repo\/web exec env-deploy --run web -- wrangler rollback/
    );
    expect(run.gits.some((line) => line.startsWith("tag"))).toBeFalsy();
  });

  it("tries a failing smoke check three times", async () => {
    let calls = 0;
    const run = fake({
      routes: webDomain,
      answer: () => {
        calls += 1;
        return { status: calls < 3 ? 503 : 200, body: "" };
      },
    });
    await deployProduction(plain, run.io, {
      config: {},
      targets: [{ service: "web", order: 30 }],
      smokeChecks: [{ id: "web-home", service: "web", path: "/", status: 200 }],
    });
    expect(calls).toBe(3);
  });

  it("keeps the tag local and prints the push when the push fails", async () => {
    const run = fake({ routes: webDomain, pushFails: true });
    await expect(
      deployProduction(plain, run.io, {
        config: {},
        targets: [{ service: "web", order: 30 }],
        smokeChecks: [],
      })
    ).rejects.toThrow(/git push origin deploy-20261023-1430/);
  });

  it("deploys one Worker with --only, smoke checks it, and writes no tag", async () => {
    const run = fake({ workspaces: [WEB, API], routes: webDomain });
    await deployProduction({ ...plain, only: "web" }, run.io, project);
    expect(run.runs).toStrictEqual([
      "node packages/env/src/deploy.ts --check",
      "pnpm --filter @repo/web run deploy",
    ]);
    expect(run.gits.some((line) => line.startsWith("tag"))).toBeFalsy();
  });

  it("refuses --only for a service that does not deploy", async () => {
    const run = fake();
    await expect(
      deployProduction({ ...plain, only: "docs" }, run.io, {
        config: {},
        targets: [{ service: "web", order: 30 }],
        smokeChecks: [],
      })
    ).rejects.toThrow(/--only docs is not a deploy target\. Choose web/);
    expect(run.runs).toStrictEqual([]);
  });

  it("stops when a Worker deploy fails, before the next one and with no tag", async () => {
    const run = fake({
      workspaces: [WEB, API],
      runExit: (line) => (line.includes("@repo/api") ? 1 : 0),
    });
    await expect(deployProduction(plain, run.io, project)).rejects.toThrow(
      /Deploy api failed/
    );
    expect(run.runs).not.toContain("pnpm --filter @repo/web run deploy");
    expect(run.gits.some((line) => line.startsWith("tag"))).toBeFalsy();
  });
});
