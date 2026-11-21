// The agent benchmark scorer's parsers (issue #222). Run with `pnpm test:scripts`, or
// `node --test scripts/agent-bench/score.test.ts`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import {
  checkEntity,
  deployCalls,
  deployOf,
  entityParts,
  featureSections,
  findConsoleMail,
  findProject,
  formatTable,
  judgeAgentUse,
  judgeAudit,
  judgeEntities,
  judgeInterview,
  judgeLanding,
  judgePreview,
  MVP_BAR,
  parseBuildLog,
  parseSeedCounts,
  portsFromRecord,
  previewUrls,
  sameCounts,
  stopPoint,
} from "./score.ts";
import type { Expect, LineResult } from "./score.ts";

const expect: Expect = {
  productName: "Shelfnote",
  entity: { table: "books", word: "book" },
  defaultLandingMarkers: ["not the scaffolding"],
};

const LOG = `# Build log

## Stage 1: scaffold
Commit \`a1b2c3d\`. Ran saasaloy init.

## Stage 2: modules
Commit: 0f9e8d7c6b5a. Added auth, admin, email.

## Stage 3: entity
Stopped: pnpm db:generate failed on the books table.

## Blocked
- \`saasaloy env\` asks for a TTY and has no flag.
- The app module does not exist.

## Left for a human
- Deploy with pnpm deploy:production.
`;

describe("parseBuildLog", () => {
  it("reads stages with their commits and status", () => {
    const log = parseBuildLog(LOG);
    assert.deepEqual(log.stages, [
      { title: "Stage 1: scaffold", commit: "a1b2c3d", status: "done" },
      { title: "Stage 2: modules", commit: "0f9e8d7c6b5a", status: "done" },
      { title: "Stage 3: entity", commit: undefined, status: "stopped" },
    ]);
  });

  it("reads the blocked items and the human steps apart from the stages", () => {
    const log = parseBuildLog(LOG);
    assert.deepEqual(log.blocked, [
      "`saasaloy env` asks for a TTY and has no flag.",
      "The app module does not exist.",
    ]);
    assert.deepEqual(log.humanSteps, ["Deploy with pnpm deploy:production."]);
    assert.equal(log.hasHumanSection, true);
  });

  it("reads stages nested as ### under a ## Stages section", () => {
    const log = parseBuildLog(
      `## Stages\n\n### Scaffold\nDone in abcdef1.\n\n### Auth\n- [ ] not started\n`
    );
    assert.deepEqual(
      log.stages.map((s) => [s.title, s.status]),
      [
        ["Scaffold", "done"],
        ["Auth", "open"],
      ]
    );
  });

  it("marks a stage stopped even when it names a commit", () => {
    const [stage] = parseBuildLog(
      "## Entity\nCommit abc1234, then pnpm check failed.\n"
    ).stages;
    assert.equal(stage?.status, "stopped");
  });

  it("keeps a committed stage done when a note mid-body uses a stop word", () => {
    const [stage] = parseBuildLog(
      "## Feature: stations\n\nCommit: 2f7972b\n\n- Deviation: no `user_id` column, since a required creator column could not be filled.\n- Runtime check by curl only.\n"
    ).stages;
    assert.equal(stage?.status, "done");
  });

  it("marks a committed stage stopped when a line opens with a stop word", () => {
    const [stage] = parseBuildLog(
      "## Entity\nCommit abc1234.\n- Blocked: the books migration does not apply.\n- Two screens left.\n"
    ).stages;
    assert.equal(stage?.status, "stopped");
  });

  it("returns empty lists for an empty log", () => {
    const log = parseBuildLog("");
    assert.deepEqual(log, {
      stages: [],
      blocked: [],
      humanSteps: [],
      hasHumanSection: false,
    });
  });
});

describe("stopPoint", () => {
  it("names the first unfinished stage and the first blocked item", () => {
    assert.equal(
      stopPoint(parseBuildLog(LOG)),
      'stage "Stage 3: entity" is stopped; blocked: `saasaloy env` asks for a TTY and has no flag.'
    );
  });

  it("names the last stage when every stage is done", () => {
    assert.equal(
      stopPoint(parseBuildLog("## One\nabc1234\n\n## Two\ndef5678\n")),
      'after stage "Two"'
    );
  });

  it("says so when the log lists no stage", () => {
    assert.equal(
      stopPoint(parseBuildLog("## Blocked\n- no brief\n")),
      "the build log lists no stage; blocked: no brief"
    );
  });
});

describe("seed counts", () => {
  const output =
    "> pnpm --filter @repo/db db:seed\n\nSeeded:\n  users     2 rows\n  books    12 rows\n  sessions  1 row\n";

  it("reads one count per table", () => {
    assert.deepEqual(
      [...parseSeedCounts(output)],
      [
        ["users", 2],
        ["books", 12],
        ["sessions", 1],
      ]
    );
  });

  it("matches two equal runs and rejects a changed or empty run", () => {
    const first = parseSeedCounts(output);
    assert.equal(sameCounts(first, parseSeedCounts(output)), true);
    assert.equal(
      sameCounts(first, parseSeedCounts(output.replace("12 rows", "24 rows"))),
      false
    );
    assert.equal(sameCounts(new Map(), new Map()), false);
  });
});

describe("findConsoleMail", () => {
  const mail = (to: string, subject: string) =>
    `───── email (console provider) ─────\nmessage-id: console-1\nfrom:       hello@shelfnote.test\nto:         ${to}\nsubject:    ${subject}\n\nbody\n────────────────────────────────────\n`;

  it("finds the mail sent to one address", () => {
    const log = `[wrangler] ready\n${mail("a@x.test", "Welcome")}${mail("b+1@x.test", "Reset your password")}`;
    assert.match(
      findConsoleMail(log, "b+1@x.test") ?? "",
      /Reset your password/
    );
    assert.equal(findConsoleMail(log, "c@x.test"), undefined);
  });

  it("finds the mail behind turbo's task prefix, as `pnpm dev` prints it", () => {
    const prefixed = mail("b@x.test", "Reset your password")
      .split("\n")
      .map((line) => `@repo/api:dev: ${line}`)
      .join("\n");
    assert.match(
      findConsoleMail(`@repo/web:dev: ready\n${prefixed}`, "b@x.test") ?? "",
      /Reset your password/
    );
  });
});

describe("judgeLanding", () => {
  it("fails the default copy and passes copy that names the product", () => {
    assert.equal(
      judgeLanding("<h1>Acme: ship the SaaS, not the scaffolding</h1>", expect)
        .verdict,
      "FAIL"
    );
    assert.equal(
      judgeLanding("<h1>Remember every book</h1>", expect).verdict,
      "FAIL"
    );
    assert.equal(
      judgeLanding("<h1>Shelfnote: remember every book</h1>", expect).verdict,
      "PASS"
    );
  });
});

describe("formatTable", () => {
  it("prints one row per MVP bar line and a stop point per FAIL row", () => {
    const results: LineResult[] = MVP_BAR.map((line) => ({
      id: line.id,
      verdict:
        line.id === "entity" ? "FAIL" : line.id === "preview" ? "N/A" : "PASS",
      detail: "x",
    }));
    const table = formatTable(results, 'stage "Stage 3" is stopped');
    const rows = table.split("\n").filter((line) => /^\| \d/.test(line));
    assert.equal(rows.length, MVP_BAR.length);
    assert.match(table, /^FAIL 4: stop point: stage "Stage 3" is stopped$/m);
    assert.doesNotMatch(table, /^FAIL 1:/m);
    assert.match(table, /10\/12 MVP bar lines pass, 1 N\/A, 1 FAIL\./);
  });

  it("holds the three bar lines of plan 0109, then the two agent lines of plan 0110", () => {
    assert.deepEqual(MVP_BAR.map((line) => line.id).slice(-5), [
      "interview",
      "entities",
      "preview",
      "agent-audit",
      "agent-use",
    ]);
  });

  it("says there is no build log when no stop point was found", () => {
    assert.match(
      formatTable([]),
      /^FAIL 1: stop point: no docs\/build-log\.md$/m
    );
  });
});

describe("filesystem checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-bench-"));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  it("finds a project one level below the run folder", () => {
    put("shelfnote/saasaloy.json", "{}");
    assert.equal(findProject(dir), join(dir, "shelfnote"));
  });

  it("names each missing entity part, then passes when all eight exist", () => {
    const project = join(dir, "shelfnote");
    put(
      "shelfnote/packages/db/src/schema/books.ts",
      'export const books = pgTable("books", {});'
    );
    put(
      "shelfnote/packages/db/migrations/0001_init.sql",
      "CREATE TABLE `books` (`id` text);"
    );
    assert.match(
      checkEntity(project, expect).detail,
      /missing: seed slice, validator, api route, app screen, admin list, route test$/
    );
    put("shelfnote/packages/db/src/seed/slices/books.ts", "");
    put(
      "shelfnote/packages/validators/src/book.ts",
      "export const bookInput = {};"
    );
    put(
      "shelfnote/apps/api/src/routes/books.ts",
      "export const booksRoute = {};"
    );
    put("shelfnote/apps/api/src/routes/books.test.ts", "it('lists books')");
    put(
      "shelfnote/apps/app/src/routes/books.tsx",
      "export function Books() {}"
    );
    put(
      "shelfnote/apps/admin/src/routes/books.tsx",
      "export function Books() {}"
    );
    assert.equal(checkEntity(project, expect).verdict, "PASS");
  });

  it("finds a kebab case seed slice for a snake case table", () => {
    const project = join(dir, "prepline");
    put("prepline/packages/db/src/seed/slices/prep-tasks.ts", "");
    assert.doesNotMatch(
      checkEntity(project, {
        ...expect,
        entity: { table: "prep_tasks", word: "prep" },
      }).detail,
      /seed slice/
    );
  });
});

const SPEC = `# Product spec

## Modules

| Module | Stage | Why |
|--------|-------|-----|
| None. | | |

## Entities

### 1. Stations

| Part | Value |
|------|-------|
| Table | \`stations\` |
| Fields | \`name\` text, required |
| Who may see it | the organization |
| Actions | \`list\`, \`create\`, \`update\` |
| Screens | app: list |

### 2. Prep tasks

| Part | Value |
|------|-------|
| Table | \`prep_tasks\` |
| Fields | \`title\` text, required |
| Who may see it | the organization |
| Actions | \`list\`, \`create\`, \`update\` |
| Screens | app: list |

## Not in this build

- None.

## Left for the owner

- None.
`;

describe("judgeInterview", () => {
  const exchange = (kind: string, reply: string) => ({
    call: 1,
    kind,
    numbers: [],
    sent: "",
    reply,
  });

  it("is N/A in brief mode", () => {
    assert.equal(judgeInterview("brief", undefined, []).verdict, "N/A");
  });

  it("passes one read-back and a build that asks nothing after it", () => {
    const result = judgeInterview(
      "interview",
      {
        exchanges: [
          exchange("opening", "**1. Name?**"),
          exchange("answers", "**Build it?**\na. Yes"),
          exchange("read-back", "The build is done. See docs/build-log.md."),
        ],
        end: "the build call exited 0",
      },
      [""]
    );
    assert.equal(result.verdict, "PASS");
  });

  it("fails an interview that never reached the read-back", () => {
    const result = judgeInterview(
      "interview",
      {
        exchanges: [exchange("opening", "**1. Name?**")],
        end: "the agent exited 1",
      },
      []
    );
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /no read-back.*exited 1/);
  });

  it("fails a question after the read-back, in the reply or by the picker tool", () => {
    const record = (last: string) => ({
      exchanges: [
        exchange("answers", "**Build it?**"),
        exchange("read-back", last),
      ],
      end: "x",
    });
    assert.match(
      judgeInterview("interview", record("Shall I start the Feature stage?"), [
        "",
      ]).detail,
      /question after the read-back/
    );
    const picker = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
      },
    });
    assert.equal(
      judgeInterview("interview", record("Done."), ["", picker]).verdict,
      "FAIL"
    );
  });

  it("fails a second read-back", () => {
    const result = judgeInterview(
      "interview",
      {
        exchanges: [
          exchange("answers", "**Build it?**"),
          exchange("read-back", "Changed it. **Build it?**"),
        ],
        end: "x",
      },
      [""]
    );
    assert.match(result.detail, /2 read-backs/);
  });
});

describe("featureSections", () => {
  it("reads each ## Feature: <table> heading", () => {
    assert.deepEqual(
      featureSections(
        "## Intake\n## Feature: stations\n## Feature: `prep_tasks`\n### Feature: no\n"
      ),
      ["stations", "prep_tasks"]
    );
  });
});

describe("entities end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-bench-entities-"));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  put(
    "packages/db/src/schema/stations.ts",
    'export const stations = pgTable("stations", {});'
  );
  put("apps/api/src/routes/stations.ts", 'app.get("/stations", list);');
  put("apps/app/src/routes/stations.tsx", "export function Stations() {}");
  const ENTITY_LOG = "## Feature: stations\nCommit abc1234.\n";

  it("names each part an entity has and lacks", () => {
    const parts = entityParts(dir, "stations", ENTITY_LOG, [
      "feat(build): feature stations",
    ]);
    assert.deepEqual(
      parts.filter(([, ok]) => !ok).map(([name]) => name),
      []
    );
    const missing = entityParts(dir, "prep_tasks", ENTITY_LOG, []);
    assert.deepEqual(
      missing.filter(([, ok]) => !ok).map(([name]) => name),
      ["build log section", "commit", "table", "api route", "app screen"]
    );
  });

  it("finds a route and a screen by the kebab-case name", () => {
    put(
      "packages/db/src/schema/prep.ts",
      'export const prepTasks = pgTable("prep_tasks", {});'
    );
    put("apps/api/src/routes/prep.ts", 'app.get("/prep-tasks", list);');
    put(
      "apps/app/src/routes/prep-tasks/index.tsx",
      "export function List() {}"
    );
    const parts = entityParts(dir, "prep_tasks", "## Feature: prep_tasks\n", [
      "feat(build): feature prep_tasks",
    ]);
    assert.deepEqual(
      parts.filter(([, ok]) => !ok).map(([name]) => name),
      []
    );
  });

  it("joins every spec table, and fails a route that answers 404", () => {
    const passing = judgeEntities({
      mode: "interview",
      project: dir,
      spec: SPEC,
      log: "## Feature: stations\n## Feature: prep_tasks\n",
      subjects: [
        "feat(build): feature stations",
        "feat(build): feature prep_tasks",
      ],
      http: new Map([
        ["stations", 401],
        ["prep_tasks", 401],
      ]),
    });
    assert.equal(passing.verdict, "PASS");
    assert.match(passing.detail, /2 entities/);
    const failing = judgeEntities({
      mode: "interview",
      project: dir,
      spec: SPEC,
      log: "## Feature: stations\n## Feature: prep_tasks\n",
      subjects: [
        "feat(build): feature stations",
        "feat(build): feature prep_tasks",
      ],
      http: new Map([
        ["stations", 401],
        ["prep_tasks", 404],
      ]),
    });
    assert.equal(failing.verdict, "FAIL");
    assert.match(failing.detail, /`prep_tasks` missing: http 404/);
  });

  it("is N/A in brief mode with no spec, and FAIL in interview mode", () => {
    const input = { project: dir, spec: undefined, log: "", subjects: [] };
    assert.equal(judgeEntities({ ...input, mode: "brief" }).verdict, "N/A");
    assert.equal(
      judgeEntities({ ...input, mode: "interview" }).verdict,
      "FAIL"
    );
  });
});

describe("the preview line", () => {
  it("reads deploy from the brief's frontmatter, none by default", () => {
    assert.equal(
      deployOf("---\nautonomy: afk\ndeploy: preview\n---\n# B"),
      "preview"
    );
    assert.equal(deployOf("---\nautonomy: afk\n---\n# B"), "none");
    assert.equal(deployOf(), "none");
  });

  it("finds wrangler and deploy commands in a stream-json transcript", () => {
    const bash = (command: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command } }],
        },
      });
    const text = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will not run wrangler." }],
      },
    });
    assert.deepEqual(
      deployCalls(
        [
          bash("pnpm check"),
          text,
          bash("npx wrangler deploy"),
          bash("pnpm deploy:preview"),
        ].join("\n")
      ),
      ["npx wrangler deploy", "pnpm deploy:preview"]
    );
  });

  it("does not count a command that only names wrangler.jsonc or .wrangler/", () => {
    const bash = (command: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command } }],
        },
      });
    const calls = deployCalls(
      [
        bash("grep -n hyperdrive apps/api/wrangler.jsonc"),
        bash("rm -rf apps/api/.wrangler/state"),
        bash("pnpm --filter api exec wrangler hyperdrive list"),
        bash("npx wrangler@4.40.0 deploy"),
      ].join("\n")
    );
    assert.deepEqual(calls, [
      "pnpm --filter api exec wrangler hyperdrive list",
      "npx wrangler@4.40.0 deploy",
    ]);
    assert.equal(
      judgePreview(
        "none",
        deployCalls(
          [
            bash("grep -n hyperdrive apps/api/wrangler.jsonc"),
            bash("rm -rf apps/api/.wrangler/state"),
          ].join("\n")
        )
      ).verdict,
      "N/A"
    );
  });

  it("does not count wrangler words that are a grep pattern or an echo", () => {
    const bash = (command: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command } }],
        },
      });
    assert.deepEqual(
      deployCalls(
        [
          bash(
            "export PATH=$PWD/../bin:$PATH; saasaloy env --check 2>&1 | grep -E 'wrangler secret put|unset|missing' | head -20"
          ),
          bash('echo "next: wrangler deploy"'),
          bash(
            "cat >> docs/build-log.md <<'EOF'\n\n## Left for a human\n\n- Deploy with `pnpm deploy:production`.\nEOF\ngit add docs/build-log.md"
          ),
          bash("pnpm build && pnpm --filter api exec wrangler deploy"),
          bash("CI=1 wrangler secret put KEY < key.txt"),
        ].join("\n")
      ),
      [
        "pnpm build && pnpm --filter api exec wrangler deploy",
        "CI=1 wrangler secret put KEY < key.txt",
      ]
    );
  });

  it("is N/A with deploy: none and no deploy call, and FAIL with one", () => {
    assert.equal(judgePreview("none", []).verdict, "N/A");
    const result = judgePreview("none", ["npx wrangler deploy"]);
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /wrangler deploy/);
  });

  it("passes deploy: preview when the web address answers 200", () => {
    assert.equal(
      judgePreview("preview", [], {
        url: "https://web-preview.x.workers.dev",
        status: 200,
      }).verdict,
      "PASS"
    );
    assert.equal(
      judgePreview("preview", [], {
        url: "https://web-preview.x.workers.dev",
        status: 522,
      }).verdict,
      "FAIL"
    );
    assert.equal(judgePreview("preview", []).verdict, "FAIL");
  });

  it("reads the addresses from the build log's Preview section", () => {
    assert.deepEqual(
      previewUrls(
        "## Handover\nhttps://example.test\n## Preview\n- web: https://web-preview.x.workers.dev\n- api: <https://api-preview.x.workers.dev>.\n"
      ),
      ["https://web-preview.x.workers.dev", "https://api-preview.x.workers.dev"]
    );
  });
});

describe("portsFromRecord", () => {
  it("takes the block's ports from .devports.json", () => {
    assert.deepEqual(
      portsFromRecord(
        JSON.stringify({
          block: 7,
          host: "localhost",
          cookiePrefix: "wt1",
          services: { web: 10_070, admin: 10_071, app: 10_072, api: 10_075 },
        }),
        7
      ),
      { web: 10_070, admin: 10_071, app: 10_072, api: 10_075 }
    );
  });

  it("computes the block's ports when the record is missing", () => {
    assert.deepEqual(portsFromRecord(undefined, 7), {
      web: 10_070,
      admin: 10_071,
      app: 10_072,
      api: 10_075,
    });
  });
});

describe("the agent audit line", () => {
  const report = (agent: boolean, failed?: { id: string; detail: string }) =>
    [
      "> shelfnote@0.0.0 agent:audit /run/shelfnote",
      "> node packages/tooling/src/agent-audit.ts",
      "",
      JSON.stringify(
        {
          ok: failed === undefined,
          site: "http://localhost:10000",
          api: "http://localhost:10005",
          agent,
          checks: [
            { id: "web/llms.txt", status: "PASS", detail: "200 text/plain" },
            {
              id: "api/tools-list",
              status: failed ? "FAIL" : "PASS",
              detail: failed?.detail ?? "4 tools",
            },
          ],
        },
        null,
        2
      ),
    ].join("\n");

  it("fails when the audit did not run, and says why", () => {
    const result = judgeAudit(undefined, "no key: sign-up returned 500");
    assert.equal(result.id, "agent-audit");
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /no key: sign-up returned 500/);
  });

  it("passes on exit 0 with agent installed, counting the checks", () => {
    const result = judgeAudit({ code: 0, output: report(true) });
    assert.equal(result.verdict, "PASS");
    assert.match(result.detail, /2 checks pass/);
  });

  it("fails on exit 0 when agent is not installed", () => {
    const result = judgeAudit({ code: 0, output: report(false) });
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /agent is not installed/);
  });

  it("fails on exit 1 and names the first failed check", () => {
    const result = judgeAudit({
      code: 1,
      output: report(true, { id: "api/tools-list", detail: "401" }),
    });
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /exited 1; api\/tools-list: 401/);
  });

  it("fails on a usage error, a timeout, and output that is not the JSON report", () => {
    assert.match(
      judgeAudit({ code: 2, output: "agent-audit: unknown flag --x" }).detail,
      /exited 2.*unknown flag --x/
    );
    assert.match(
      judgeAudit({ code: null, output: "", timedOut: true }).detail,
      /timed out/
    );
    const missing = judgeAudit({
      code: 1,
      output: 'ERR_PNPM_NO_SCRIPT Missing script: "agent:audit"',
    });
    assert.equal(missing.verdict, "FAIL");
    assert.match(missing.detail, /no JSON report.*Missing script/);
  });
});

describe("the second agent line", () => {
  const bash = (command: string) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command } }],
      },
    });
  const transcript = [
    bash("curl -s http://localhost:10000/llms.txt"),
    bash(
      `curl -s -X POST http://localhost:10005/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"books_create"}}'`
    ),
    bash(
      `curl -s -X POST http://localhost:10005/mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"books_list"}}'`
    ),
  ].join("\n");
  const run = {
    code: 0,
    timedOut: false,
    transcript,
    reply: "I created a book and read it back.\n\nREAD BACK: bk_123",
  };
  const read = { tool: "books_list", rows: [{ id: "bk_123", title: "Dune" }] };

  it("fails with the reason when no key was seeded or no agent ran", () => {
    const noKey = judgeAgentUse({
      table: "books",
      problem: "no key: api-key/create returned 403",
    });
    assert.equal(noKey.id, "agent-use");
    assert.equal(noKey.verdict, "FAIL");
    assert.match(noKey.detail, /api-key\/create returned 403/);
    assert.match(
      judgeAgentUse({ table: "books" }).detail,
      /the second agent did not run/
    );
  });

  it("fails when the second agent exits non-zero or times out", () => {
    assert.match(
      judgeAgentUse({ table: "books", run: { ...run, code: 1 }, read }).detail,
      /exited 1/
    );
    assert.match(
      judgeAgentUse({
        table: "books",
        run: { ...run, code: null, timedOut: true },
        read,
      }).detail,
      /timed out/
    );
  });

  it("fails when the transcript holds no MCP tools/call", () => {
    const result = judgeAgentUse({
      table: "books",
      run: { ...run, transcript: bash("curl -s http://localhost:10005/books") },
      read,
    });
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /no MCP tools\/call/);
  });

  it("fails when the key's user has no row, so nothing was created", () => {
    const result = judgeAgentUse({
      table: "books",
      run,
      read: { tool: "books_list", rows: [] },
    });
    assert.equal(result.verdict, "FAIL");
    assert.match(result.detail, /no `books` row/);
    assert.match(
      judgeAgentUse({
        table: "books",
        run,
        read: { problem: "no read tool for books:read" },
      }).detail,
      /no read tool for books:read/
    );
  });

  it("fails when the reply names no row, or a row the scorer cannot find", () => {
    assert.match(
      judgeAgentUse({ table: "books", run: { ...run, reply: "Done." }, read })
        .detail,
      /no `READ BACK: <id>` line/
    );
    assert.match(
      judgeAgentUse({
        table: "books",
        run: { ...run, reply: "READ BACK: bk_999" },
        read,
      }).detail,
      /bk_999 is not among the 1 `books` rows/
    );
  });

  it("passes when the agent created a row and named it, and the scorer reads it back", () => {
    const result = judgeAgentUse({ table: "books", run, read });
    assert.equal(result.verdict, "PASS");
    assert.match(result.detail, /bk_123.*books_list.*2 MCP tools\/call/);
  });
});
