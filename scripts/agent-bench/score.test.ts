// The agent benchmark scorer's parsers (issue #222). Run with `pnpm test:scripts`, or
// `node --test scripts/agent-bench/score.test.ts`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import {
  checkEntity,
  findConsoleMail,
  findProject,
  formatTable,
  judgeLanding,
  MVP_BAR,
  parseBuildLog,
  parseSeedCounts,
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
      verdict: line.id === "entity" ? "FAIL" : "PASS",
      detail: "x",
    }));
    const table = formatTable(results, 'stage "Stage 3" is stopped');
    const rows = table.split("\n").filter((line) => /^\| \d/.test(line));
    assert.equal(rows.length, MVP_BAR.length);
    assert.match(table, /^FAIL 4: stop point: stage "Stage 3" is stopped$/m);
    assert.doesNotMatch(table, /^FAIL 1:/m);
    assert.match(table, /6\/7 MVP bar lines pass\./);
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
      'export const books = sqliteTable("books", {});'
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
});
