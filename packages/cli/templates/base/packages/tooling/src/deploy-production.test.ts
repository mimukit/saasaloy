import { describe, expect, it } from "vitest";
import {
  ciState,
  deployProduction,
  gateProblems,
  gateReport,
  isReleaseOnly,
  jobState,
  orderTargets,
  parseArgs,
  releaseLabel,
  releaseWarning,
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
  ReleaseFacts,
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
    release: {
      onHead: "v0.3.0",
      latest: "v0.3.0",
      after: [],
      sinceDeploy: true,
    },
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

  it("reads --wait-ci", () => {
    expect(parseArgs(["--dry-run", "--wait-ci"])).toStrictEqual({
      ...plain,
      dryRun: true,
      waitCi: true,
    });
  });

  it("refuses --wait-ci with --skip-ci, because one waits for the gate the other passes", () => {
    expect(() =>
      parseArgs(["--wait-ci", "--skip-ci", "Actions outage"])
    ).toThrow(/--wait-ci waits for the CI gate, and --skip-ci passes it/);
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

  const green = { status: "completed", conclusion: "success" };

  it("passes a run GitHub still shows as queued once every job's steps ended green", () => {
    expect(
      ciState([
        {
          status: "queued",
          conclusion: "",
          jobs: [
            { status: "completed", conclusion: "success", steps: [green] },
            {
              status: "in_progress",
              conclusion: "",
              steps: [green, { status: "completed", conclusion: "skipped" }],
            },
          ],
        },
      ])
    ).toBe("passed");
  });

  it("waits on a lagging run with no job yet", () => {
    expect(ciState([{ status: "queued", conclusion: "", jobs: [] }])).toBe(
      "running"
    );
    expect(ciState([{ status: "queued", conclusion: "" }])).toBe("running");
  });

  it("fails a lagging run as soon as one step failed", () => {
    expect(
      ciState([
        {
          status: "in_progress",
          conclusion: "",
          jobs: [
            {
              status: "in_progress",
              conclusion: "",
              steps: [green, { status: "completed", conclusion: "failure" }],
            },
          ],
        },
      ])
    ).toBe("failed");
  });
});

describe(jobState, () => {
  const green = { status: "completed", conclusion: "success" };

  it("trusts a completed job's own conclusion", () => {
    expect(
      jobState({ status: "completed", conclusion: "success", steps: [] })
    ).toBe("passed");
    expect(
      jobState({ status: "completed", conclusion: "cancelled", steps: [green] })
    ).toBe("failed");
  });

  it("passes a lagging job whose every step ended success or skipped", () => {
    expect(
      jobState({
        status: "in_progress",
        conclusion: "",
        steps: [green, { status: "completed", conclusion: "skipped" }],
      })
    ).toBe("passed");
  });

  it("waits on a lagging job while a step still runs", () => {
    expect(
      jobState({
        status: "in_progress",
        conclusion: "",
        steps: [green, { status: "in_progress", conclusion: "" }],
      })
    ).toBe("running");
  });

  it("fails a lagging job with a failed step", () => {
    expect(
      jobState({
        status: "in_progress",
        conclusion: "",
        steps: [
          { status: "completed", conclusion: "failure" },
          { status: "queued", conclusion: "" },
        ],
      })
    ).toBe("failed");
  });

  it("does not pass a job with no steps", () => {
    expect(jobState({ status: "in_progress", conclusion: "", steps: [] })).toBe(
      "running"
    );
  });
});

describe(isReleaseOnly, () => {
  const bump = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -3 +3 @@",
    '-  "version": "0.7.1",',
    '+  "version": "0.8.0",',
  ].join("\n");

  it("takes a version bump and a changelog entry", () => {
    expect(isReleaseOnly(["CHANGELOG.md", "package.json"], bump)).toBeTruthy();
  });

  it("refuses a dependency change in package.json", () => {
    expect(
      isReleaseOnly(
        ["CHANGELOG.md", "package.json"],
        `${bump}\n@@ -20 +20 @@\n-    "hono": "4.0.0",\n+    "hono": "4.1.0",`
      )
    ).toBeFalsy();
  });

  it("refuses any other file", () => {
    expect(
      isReleaseOnly(
        ["CHANGELOG.md", "package.json", "apps/api/src/index.ts"],
        bump
      )
    ).toBeFalsy();
  });

  it("refuses an empty change", () => {
    expect(isReleaseOnly([], "")).toBeFalsy();
  });
});

describe(resolveConfig, () => {
  it("fills every key an older or emptied config file lacks", () => {
    expect(resolveConfig({})).toStrictEqual({
      branches: ["main", "hotfix-*"],
      tagPrefix: "deploy-",
      ciWorkflow: undefined,
      migrations: "packages/db/migrations/*.sql",
      release: {
        tagPrefix: "v",
        githubRelease: true,
        preMajor: true,
        changelogSections: undefined,
        include: [],
      },
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
      ["api", "web"],
      "v0.3.0"
    );
    expect(message).toMatch(
      /Production deploy of 7812604 \(v0\.3\.0\): api, web\./
    );
    expect(message).toMatch(
      /Ran pnpm --filter @repo\/db run db:prod:migrate first/
    );
    expect(message).toMatch(/CI gate skipped: Actions outage/);
  });

  it("leaves out what did not happen", () => {
    const message = tagMessage(HEAD, plain, ["web"], "v0.3.0");
    expect(message).not.toMatch(/migrate|skipped/);
  });
});

const noRelease: ReleaseFacts = { after: [], sinceDeploy: false };
const pastRelease: ReleaseFacts = {
  latest: "v0.3.0",
  after: [
    "abc1234 fix(api): retry the webhook",
    "def5678 feat(web): add the faq",
  ],
  sinceDeploy: true,
};

describe(releaseLabel, () => {
  it("names the release tag on HEAD", () => {
    expect(releaseLabel(facts().release)).toBe("v0.3.0");
  });

  it("says how far HEAD is past the newest release", () => {
    expect(releaseLabel(pastRelease)).toBe("2 commit(s) after v0.3.0");
  });

  it("says when no release exists", () => {
    expect(releaseLabel(noRelease)).toBe("no release tag");
  });
});

describe(releaseWarning, () => {
  it("is silent when HEAD is a release commit", () => {
    expect(
      releaseWarning(facts().release, "deploy-20261023-1430")
    ).toBeUndefined();
  });

  it("names a project with no release yet", () => {
    expect(releaseWarning(noRelease)).toMatch(
      /HEAD has no release tag yet.*run pnpm release first, unless this is an urgent hotfix/
    );
  });

  it("lists the commits after the release, so the changelog gap is visible", () => {
    const warning = releaseWarning(pastRelease, "deploy-20261023-1430") ?? "";
    expect(warning).toMatch(/HEAD is 2 commit\(s\) past v0\.3\.0/);
    expect(warning).toMatch(/\n {2}abc1234 fix\(api\): retry the webhook/);
    expect(warning).toMatch(/\n {2}def5678 feat\(web\): add the faq/);
  });

  it("names the last deploy tag when no release came after it", () => {
    expect(
      releaseWarning(
        { ...pastRelease, sinceDeploy: false },
        "deploy-20261023-1430"
      )
    ).toMatch(/No release since the last deploy tag \(deploy-20261023-1430\)/);
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
  /** Every `gh` call, its arguments joined. */
  ghs: string[];
  /** Every `sleep` in milliseconds. */
  sleeps: number[];
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
  /** The release tag on HEAD. */
  releaseOnHead?: string;
  /** The newest release tag HEAD descends from, when HEAD is not one. */
  latestRelease?: string;
  /** `git log --oneline <latestRelease>..HEAD`. */
  afterRelease?: string;
  /** Whether the last deploy tag already contains `latestRelease`. */
  releaseDeployed?: boolean;
  /** What `gh` answers, by its joined arguments and the time since the run started. */
  gh?: (line: string, elapsedMs: number) => string;
  /** HEAD's parent, and the change HEAD makes to it. */
  parent?: { sha: string; files: string; packageDiff: string };
  /** `rev-list --parents -n 1 HEAD`, for a merge commit. */
  parents?: string;
}

const WEB: Workspace = { service: "web", packageName: "@repo/web" };
const API: Workspace = { service: "api", packageName: "@repo/api" };

function fake(setup: FakeSetup = {}): Fake {
  const said: string[] = [];
  const runs: string[] = [];
  const gits: string[] = [];
  const ghs: string[] = [];
  const sleeps: number[] = [];
  const start = new Date("2026-10-23T14:30:00Z").getTime();
  // The clock moves only when the run sleeps.
  let elapsed = 0;
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
      if (line.startsWith("describe") && line.includes("--match v*")) {
        const tag = line.includes("--exact-match")
          ? setup.releaseOnHead
          : (setup.releaseOnHead ?? setup.latestRelease);
        if (tag === undefined) {
          throw new Error("no names found");
        }
        return tag;
      }
      if (line.startsWith("merge-base --is-ancestor")) {
        if (setup.releaseDeployed !== true) {
          throw new Error("not an ancestor");
        }
        return "";
      }
      if (line.startsWith("log --oneline v")) {
        return setup.afterRelease ?? "";
      }
      if (line.startsWith("describe")) {
        if (lastTag === undefined) {
          throw new Error("no names found");
        }
        return lastTag;
      }
      if (line === "rev-list --parents -n 1 HEAD") {
        if (setup.parents !== undefined) {
          return setup.parents;
        }
        return setup.parent === undefined
          ? HEAD
          : `${HEAD} ${setup.parent.sha}`;
      }
      if (setup.parent !== undefined) {
        if (line === `diff --name-only ${setup.parent.sha} HEAD`) {
          return setup.parent.files;
        }
        if (line.startsWith(`diff --unified=0 ${setup.parent.sha} HEAD`)) {
          return setup.parent.packageDiff;
        }
      }
      if (line.startsWith("diff --name-only") || line.startsWith("ls-files")) {
        return setup.migrations ?? "";
      }
      if (line.startsWith("push") && setup.pushFails === true) {
        throw new Error("push rejected");
      }
      return "";
    },
    gh: (args) => {
      const line = args.join(" ");
      ghs.push(line);
      return setup.gh?.(line, elapsed) ?? "[]";
    },
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
    sleep: async (ms) => {
      sleeps.push(ms);
      elapsed += ms;
      await Promise.resolve();
    },
    say: (text) => {
      said.push(text);
    },
    now: () => new Date(start + elapsed),
    workspaces: () => setup.workspaces ?? [WEB],
    wranglerConfig: (service) => setup.routes?.[service],
    hasDb: () => setup.hasDb ?? false,
  };
  return { io, said, runs, gits, ghs, sleeps };
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

describe("the CI gate in a whole run", () => {
  const PARENT = "34720f5bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const ciProject = { ...project, config: { ciWorkflow: "ci.yml" } };
  const dry: Options = { ...plain, dryRun: true };
  const wait: Options = { ...dry, waitCi: true };
  const bump = '@@ -3 +3 @@\n-  "version": "0.7.1",\n+  "version": "0.8.0",';
  const greenRun =
    '[{"status":"completed","conclusion":"success","databaseId":2}]';
  const lagging = '[{"status":"queued","conclusion":"","databaseId":7}]';
  const jobs = (...steps: { status: string; conclusion: string | null }[]) =>
    JSON.stringify({
      jobs: [{ status: "in_progress", conclusion: null, steps }],
    });
  const done = { status: "completed", conclusion: "success" };
  const runningStep = { status: "in_progress", conclusion: null };
  const failedStep = { status: "completed", conclusion: "failure" };
  /** `gh` answers `runs` for `commit`, `jobs` for the jobs call, and `[]` otherwise. */
  const ciOn =
    (commit: string, runs: string, jobsAnswer = jobs(runningStep)) =>
    (line: string) => {
      if (line.startsWith("api ")) {
        return jobsAnswer;
      }
      return line.includes(`--commit ${commit}`) ? runs : "[]";
    };
  const release = (
    files = "CHANGELOG.md\npackage.json",
    packageDiff = bump
  ) => ({
    sha: PARENT,
    files,
    packageDiff,
  });

  async function gate(
    options: Options,
    setup: Parameters<typeof fake>[0]
  ): Promise<Fake & { output: string }> {
    const run = fake({ workspaces: [WEB, API], routes: webDomain, ...setup });
    await deployProduction(options, run.io, ciProject);
    return { ...run, output: run.said.join("\n") };
  }

  it("passes a run GitHub still shows as queued once its jobs' steps ended green", async () => {
    const run = await gate(dry, { gh: ciOn(HEAD, lagging, jobs(done)) });
    expect(run.output).toMatch(/ok\s+ci\.yml passed on HEAD\./);
    expect(run.ghs).toContain("api repos/{owner}/{repo}/actions/runs/7/jobs");
  });

  it("fails a lagging run with one failed step, with the failed-on-HEAD message", async () => {
    const run = await gate(dry, {
      gh: ciOn(HEAD, lagging, jobs(done, failedStep)),
    });
    expect(run.output).toMatch(/fail\s+ci\.yml failed on HEAD\./);
  });

  it("keeps a lagging run whose step still runs as running", async () => {
    const run = await gate(dry, {
      gh: ciOn(HEAD, lagging, jobs(done, runningStep)),
    });
    expect(run.output).toMatch(/fail\s+ci\.yml is still running on HEAD/);
  });

  it("reads no jobs for a run that shows completed", async () => {
    const run = await gate(dry, { gh: ciOn(HEAD, greenRun) });
    expect(run.output).toMatch(/ok\s+ci\.yml passed on HEAD\./);
    expect(run.ghs.some((line) => line.startsWith("api "))).toBeFalsy();
  });

  it("passes a release commit on its parent's green run while HEAD's own run still runs", async () => {
    const run = await gate(dry, {
      gh: (line) =>
        line.includes(`--commit ${PARENT}`)
          ? greenRun
          : ciOn(HEAD, lagging)(line),
      parent: release(),
    });
    expect(run.output).toMatch(
      /ok\s+ci\.yml passed on 34720f5, and HEAD changes only the release version and CHANGELOG\.md\./
    );
  });

  it.each([
    ["changes code", release("CHANGELOG.md\napps/api/src/index.ts", "")],
    [
      "changes a dependency",
      release(
        "CHANGELOG.md\npackage.json",
        `${bump}\n@@ -20 +20 @@\n-    "hono": "4.0.0",\n+    "hono": "4.1.0",`
      ),
    ],
  ])("takes no parent pass when HEAD %s", async (_what, parent) => {
    const run = await gate(dry, { gh: ciOn(PARENT, greenRun), parent });
    expect(run.output).toMatch(/fail\s+ci\.yml has no run on HEAD/);
  });

  it("takes no parent pass for a merge commit", async () => {
    const run = await gate(dry, {
      gh: ciOn(PARENT, greenRun),
      parent: release(),
      parents: `${HEAD} ${PARENT} 9999999ccccccccccccccccccccccccccccccccc`,
    });
    expect(run.output).toMatch(/fail\s+ci\.yml has no run on HEAD/);
    expect(run.ghs.some((line) => line.includes(PARENT))).toBeFalsy();
  });

  it("takes no parent pass when the parent's run failed", async () => {
    const run = await gate(dry, {
      gh: ciOn(
        PARENT,
        '[{"status":"completed","conclusion":"failure","databaseId":3}]'
      ),
      parent: release(),
    });
    expect(run.output).toMatch(/fail\s+ci\.yml has no run on HEAD/);
  });

  it("--wait-ci passes on the first read after the steps turn green", async () => {
    // Green from the third read on: the first read, then two sleeps.
    const run = await gate(wait, {
      gh: (line, elapsed) =>
        ciOn(HEAD, lagging, jobs(elapsed >= 30_000 ? done : runningStep))(line),
    });
    expect(run.sleeps).toStrictEqual([15_000, 15_000]);
    expect(run.output).toMatch(/ok\s+ci\.yml passed on HEAD\./);
  });

  it("--wait-ci stops at the first failed read", async () => {
    const run = await gate(wait, {
      gh: (line, elapsed) =>
        ciOn(
          HEAD,
          lagging,
          jobs(elapsed >= 15_000 ? failedStep : runningStep)
        )(line),
    });
    expect(run.sleeps).toStrictEqual([15_000]);
    expect(run.output).toMatch(/fail\s+ci\.yml failed on HEAD\./);
  });

  it("--wait-ci waits through a run GitHub lists late", async () => {
    const run = await gate(wait, {
      gh: (line, elapsed) =>
        elapsed >= 2 * 60_000 ? ciOn(HEAD, greenRun)(line) : "[]",
    });
    expect(run.sleeps).toHaveLength(8);
    expect(run.output).toMatch(/ok\s+ci\.yml passed on HEAD\./);
  });

  it("--wait-ci stops when no run shows up within 5 minutes", async () => {
    const run = await gate(wait, {});
    expect(run.sleeps).toHaveLength(20);
    expect(run.output).toMatch(/has no run on 7812604 after 5 minutes/);
    expect(run.output).toMatch(/fail\s+ci\.yml has no run on HEAD/);
  });

  it("--wait-ci gives up at 30 minutes and reports the run as still running", async () => {
    const run = await gate(wait, { gh: ciOn(HEAD, lagging) });
    expect(run.sleeps).toHaveLength(120);
    expect(run.output).toMatch(/still running after 30 minutes/);
    expect(run.output).toMatch(/fail\s+ci\.yml is still running on HEAD/);
    // One progress line a minute, not one a read.
    expect(run.said.filter((line) => line.includes("minute(s)"))).toHaveLength(
      30
    );
  });

  it("--wait-ci does not wait when another gate fails", async () => {
    const run = fake({
      dirty: " M README.md",
      workspaces: [WEB, API],
      routes: webDomain,
      gh: ciOn(HEAD, lagging),
    });
    await expect(
      deployProduction({ ...plain, waitCi: true }, run.io, ciProject)
    ).rejects.toThrow(/uncommitted changes[\s\S]*still running on HEAD/);
    expect(run.sleeps).toStrictEqual([]);
    expect(run.runs).toStrictEqual([]);
  });

  it("--wait-ci then deploys once CI passes", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
      releaseOnHead: "v0.3.0",
      gh: (line, elapsed) =>
        ciOn(HEAD, lagging, jobs(elapsed > 0 ? done : runningStep))(line),
    });
    await deployProduction({ ...plain, waitCi: true }, run.io, ciProject);
    expect(run.sleeps).toStrictEqual([15_000]);
    expect(run.runs).toContain("pnpm --filter @repo/web run deploy");
  });
});

describe(deployProduction, () => {
  it("runs the env check, each Worker in order, the smoke checks, then tags", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
      releaseOnHead: "v0.3.0",
    });
    await deployProduction(plain, run.io, project);
    expect(run.runs).toStrictEqual([
      "node packages/env/src/deploy.ts --check",
      "pnpm --filter @repo/api run deploy",
      "pnpm --filter @repo/web run deploy",
    ]);
    expect(run.gits).toContain(
      "tag --annotate deploy-20261023-1430 --message Production deploy of 7812604 (v0.3.0): api, web."
    );
    expect(run.gits).toContain("push --quiet origin deploy-20261023-1430");
    expect(run.said.join("\n")).toMatch(/api has no custom domain/);
  });

  it("names the release on HEAD, and prints no release warning", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
      releaseOnHead: "v0.3.0",
    });
    await deployProduction(plain, run.io, project);
    const output = run.said.join("\n");
    expect(output).toMatch(/Branch main at 7812604 \(v0\.3\.0\)\./);
    expect(output).toMatch(/Deployed 7812604 \(v0\.3\.0\) and pushed/);
    expect(output).not.toMatch(/Warning:/);
  });

  it("warns, lists the commits past the release, and still deploys and tags", async () => {
    const run = fake({
      workspaces: [WEB, API],
      routes: webDomain,
      latestRelease: "v0.3.0",
      afterRelease: "abc1234 fix(api): retry the webhook",
    });
    await deployProduction(plain, run.io, project);
    const output = run.said.join("\n");
    expect(output).toMatch(/Warning: HEAD is 1 commit\(s\) past v0\.3\.0/);
    expect(output).toMatch(/abc1234 fix\(api\): retry the webhook/);
    expect(run.gits).toContain(
      "tag --annotate deploy-20261023-1430 --message Production deploy of 7812604 (1 commit(s) after v0.3.0): api, web."
    );
  });

  it("warns in a dry run when no release exists yet", async () => {
    const run = fake({ workspaces: [WEB, API], routes: webDomain });
    await deployProduction({ ...plain, dryRun: true }, run.io, project);
    expect(run.said.join("\n")).toMatch(/Warning: HEAD has no release tag yet/);
    expect(run.gits.some((line) => line.startsWith("tag"))).toBeFalsy();
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
