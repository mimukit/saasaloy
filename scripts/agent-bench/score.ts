// Scores one agent benchmark run against the MVP bar of plan 0074 (issue #222), with the
// three lines plan 0109 adds (issue #347): the interview, each entity of the spec, and the
// preview; and the two lines plan 0110 adds (issue #348): the agent audit command, and a
// second agent that uses the product through MCP with only its address and a key.
//
// `scripts/agent-bench.ts` calls `scoreRun()` after the agent exits, or on its own with
// `--score <run-dir>`. Each MVP bar line becomes one PASS, FAIL or N/A row. N/A is for a
// line the run does not ask for: the interview in brief mode, the spec's entities with no
// spec in brief mode, and the preview under `deploy: none` when the agent made no deploy
// call. The static lines read the filesystem, git and the run's transcript; the runtime
// lines run `pnpm check` and `pnpm db:seed`, then start the project's dev servers and check
// over HTTP. Given a port block, the scorer runs `pnpm dev:ports` with `DEV_PORTS_BLOCK`
// first, so the servers take that block and not the pinned ports. Every process the scorer
// starts runs in its own process group, and the group is killed before the scorer
// returns. For a FAIL row, the scorer reads `docs/build-log.md` for the stop point.
//
// The parsers at the top are pure, and `./score.test.ts` covers them on `node --test`.
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawn } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, relative } from "node:path";

import { specEntities } from "../product-spec.ts";
import {
  mcpToolCalls,
  readBackId,
  readEntityRows,
  seedAgentKey,
} from "./agent-use.ts";
import type { Read } from "./agent-use.ts";
import { isReadBack, looksLikeQuestion } from "./interview.ts";
import type { Mode } from "./harness.ts";

export interface Expect {
  productName: string;
  entity: { table: string; word: string };
  defaultLandingMarkers: string[];
}

export type Verdict = "PASS" | "FAIL" | "N/A";

export interface LineResult {
  id: LineId;
  verdict: Verdict;
  detail: string;
}

export const MVP_BAR = [
  { id: "landing", text: "Landing page carries copy from the brief" },
  { id: "auth", text: "Sign up and sign in through `app`" },
  { id: "reset", text: "Password reset mail in email-console output" },
  { id: "entity", text: "One product entity end to end" },
  {
    id: "check",
    text: "`pnpm check` passes, `pnpm db:seed` twice same counts",
  },
  { id: "commits", text: "One commit per stage on build/mvp, nothing pushed" },
  { id: "build-log", text: "docs/build-log.md records stages and human steps" },
  {
    id: "interview",
    text: "Interview ends with one read-back, no question after it",
  },
  { id: "entities", text: "Each entity of the spec end to end" },
  { id: "preview", text: "Preview answers when the brief asks for one" },
  { id: "agent-audit", text: "`pnpm agent:audit` exits 0 with a seeded key" },
  {
    id: "agent-use",
    text: "A second agent with the address and a key creates and reads back one entity through MCP",
  },
] as const;

export type LineId = (typeof MVP_BAR)[number]["id"];

/** The dev ports the scorer checks. */
export interface Ports {
  web: number;
  admin: number;
  app: number;
  api: number;
}

/** The pinned dev ports of a generated project, from the base AGENTS.md port map. */
export const PINNED_PORTS: Ports = {
  web: 3000,
  admin: 3001,
  app: 3002,
  api: 4000,
};

/**
 * The ports of `block`, read from the project's `.devports.json` when it records them,
 * else computed the way `pnpm dev:ports` does: `10000 + 10 * block + slot`.
 */
export function portsFromRecord(
  text: string | undefined,
  block: number
): Ports {
  const base = 10_000 + 10 * block;
  const ports: Ports = {
    web: base,
    admin: base + 1,
    app: base + 2,
    api: base + 5,
  };
  let services: Record<string, unknown> = {};
  try {
    const record = JSON.parse(text ?? "{}") as { services?: unknown };
    if (typeof record.services === "object" && record.services !== null) {
      services = record.services as Record<string, unknown>;
    }
  } catch {
    // A malformed record: keep the computed ports.
  }
  for (const name of ["web", "admin", "app", "api"] as const) {
    const port = services[name];
    if (typeof port === "number") {
      ports[name] = port;
    }
  }
  return ports;
}

// --- Pure parsers ------------------------------------------------------------------

export type StageStatus = "done" | "stopped" | "open";

export interface Stage {
  title: string;
  commit: string | undefined;
  status: StageStatus;
}

export interface BuildLog {
  stages: Stage[];
  blocked: string[];
  humanSteps: string[];
  hasHumanSection: boolean;
}

const BLOCKED_TITLE = /^blocked\b/i;
const HUMAN_TITLE = /\bhuman\b|\bmanual\b|left for|for you\b|next steps/i;
const STOP_WORDS =
  /\b(blocked|stopped|failed|failing|incomplete|skipped|not done|could not)\b/i;
// A line that opens with a stop word: "Stopped: pnpm check failed", "- Blocked on a key".
const STOP_LINE = new RegExp(
  `^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?(?:status:\\s*)?${STOP_WORDS.source}`,
  "i"
);
const SHA = /\b[0-9a-f]{7,40}\b/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

/**
 * Reads a build log into stages, blocked items and human steps. The log's format is the
 * agent's to choose until the build skill pins one, so this reads loosely: every `##` or
 * `###` heading is a section, a section titled "Blocked" or naming a human is a list of
 * items, and every other section with a body is a stage. A stage's commit is the first
 * hex run of 7 to 40 characters in its title or body, and a stop word in either marks it
 * stopped.
 */
export function parseBuildLog(text: string): BuildLog {
  const log: BuildLog = {
    stages: [],
    blocked: [],
    humanSteps: [],
    hasHumanSection: false,
  };
  const sections: { level: number; title: string; body: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2]) {
      sections.push({ level: heading[1].length, title: heading[2], body: [] });
    } else {
      sections.at(-1)?.body.push(line);
    }
  }

  let parent = "";
  for (const section of sections) {
    if (section.level === 2) {
      parent = section.title;
    }
    const kindTitle =
      section.level === 3 ? `${parent} ${section.title}` : section.title;
    const items = section.body.flatMap((line) => {
      const item = LIST_ITEM.exec(line)?.[1];
      return item ? [item] : [];
    });
    if (
      BLOCKED_TITLE.test(section.title) ||
      (section.level === 3 && BLOCKED_TITLE.test(parent))
    ) {
      log.blocked.push(...items);
      continue;
    }
    if (HUMAN_TITLE.test(kindTitle)) {
      log.hasHumanSection = true;
      log.humanSteps.push(...items);
      continue;
    }
    const body = section.body.join("\n").trim();
    if (body === "") {
      continue;
    }
    const commit = SHA.exec(`${section.title}\n${body}`)?.[0];
    const stopped = commit
      ? committedStageStopped(section.title, body)
      : STOP_WORDS.test(`${section.title}\n${body}`);
    log.stages.push({
      title: section.title,
      commit,
      status: stopped ? "stopped" : commit ? "done" : "open",
    });
  }
  return log;
}

/**
 * True when a stage that names a commit still says it stopped. A finished stage often
 * explains a choice in passing ("a required column could not be filled"), so a stop word
 * in the middle of its notes is not a stop. It counts in the title, at the start of a
 * line ("Stopped: ...", "- Failed ..."), or on the last line, where a build that stops
 * after its commit writes why ("Commit abc1234, then pnpm check failed.").
 */
function committedStageStopped(title: string, body: string): boolean {
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  return (
    STOP_WORDS.test(title) ||
    lines.some((line) => STOP_LINE.test(line)) ||
    STOP_WORDS.test(lines.at(-1) ?? "")
  );
}

/** Names where the agent stopped, from a parsed build log. */
export function stopPoint(log: BuildLog): string {
  const parts: string[] = [];
  const firstUnfinished = log.stages.find((stage) => stage.status !== "done");
  const lastDone = log.stages.findLast((stage) => stage.status === "done");
  if (firstUnfinished) {
    parts.push(`stage "${firstUnfinished.title}" is ${firstUnfinished.status}`);
  } else if (lastDone) {
    parts.push(`after stage "${lastDone.title}"`);
  } else {
    parts.push("the build log lists no stage");
  }
  if (log.blocked[0]) {
    parts.push(`blocked: ${log.blocked[0]}`);
  }
  return parts.join("; ");
}

/** Reads `pnpm db:seed` output (`  users  3 rows`) into a table → count map. */
export function parseSeedCounts(output: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+([a-z0-9_]+)\s+(\d+)\s+rows?\s*$/.exec(line);
    if (match?.[1] && match[2]) {
      counts.set(match[1], Number(match[2]));
    }
  }
  return counts;
}

/** True when both seed runs reported the same non-empty set of counts. */
export function sameCounts(
  a: Map<string, number>,
  b: Map<string, number>
): boolean {
  if (a.size === 0 || a.size !== b.size) {
    return false;
  }
  for (const [table, rows] of a) {
    if (b.get(table) !== rows) {
      return false;
    }
  }
  return true;
}

const TASK_PREFIX = /^[^\s:]+:[^\s:]+: /;

/** Finds the console provider's mail to `to` in a dev-server log, or undefined. */
export function findConsoleMail(log: string, to: string): string | undefined {
  // `pnpm dev` runs through turbo, which puts `@repo/api:dev: ` before every line.
  const plain = log
    .split(/\r?\n/)
    .map((line) => line.replace(TASK_PREFIX, ""))
    .join("\n");
  const blocks = plain.split("───── email (console provider) ─────").slice(1);
  return blocks
    .map(
      (block) => block.split("────────────────────────────────────")[0] ?? ""
    )
    .find((block) => new RegExp(`^to:\\s+.*${escape(to)}`, "m").test(block));
}

/** Judges the landing page's HTML against the brief. */
export function judgeLanding(html: string, expect: Expect): LineResult {
  const text = html.toLowerCase();
  const marker = expect.defaultLandingMarkers.find((m) =>
    text.includes(m.toLowerCase())
  );
  if (marker) {
    return fail("landing", `still shows the default copy ("${marker}")`);
  }
  if (!text.includes(expect.productName.toLowerCase())) {
    return fail("landing", `the page does not name "${expect.productName}"`);
  }
  return pass("landing", `names "${expect.productName}", no default copy`);
}

/** Prints the score table and, under it, the stop point for each FAIL row. */
export function formatTable(results: LineResult[], stop?: string): string {
  const rows = MVP_BAR.map((line, index) => {
    const result = results.find((r) => r.id === line.id);
    return [
      String(index + 1),
      line.text,
      result?.verdict ?? "FAIL",
      result?.detail ?? "not scored",
    ];
  });
  const head = ["#", "MVP bar line", "Result", "Detail"];
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0))
  );
  const render = (cells: string[]) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(" | ")} |`;
  const lines = [
    render(head),
    render(widths.map((w) => "-".repeat(w))),
    ...rows.map(render),
  ];
  const failed = rows.filter((row) => row[2] === "FAIL");
  if (failed.length > 0) {
    lines.push("");
    for (const row of failed) {
      lines.push(
        `FAIL ${row[0]}: stop point: ${stop ?? "no docs/build-log.md"}`
      );
    }
  }
  const passed = rows.filter((row) => row[2] === "PASS").length;
  const na = rows.filter((row) => row[2] === "N/A").length;
  lines.push(
    "",
    `${passed}/${rows.length} MVP bar lines pass, ${na} N/A, ${failed.length} FAIL.`
  );
  return lines.join("\n");
}

function pass(id: LineId, detail: string): LineResult {
  return { id, verdict: "PASS", detail };
}

function fail(id: LineId, detail: string): LineResult {
  return { id, verdict: "FAIL", detail };
}

function notApplicable(id: LineId, detail: string): LineResult {
  return { id, verdict: "N/A", detail };
}

// --- The interview, the spec's entities and the preview (plan 0109) -----------------

/** One agent call of an interview run, as the harness writes it to `interview.json`. */
export interface Exchange {
  /** The agent call, from 1. */
  call: number;
  /** What the harness sent: `opening`, `answers`, `follow-up` or `read-back`. */
  kind: string;
  /** The question numbers the message answered. */
  numbers: number[];
  sent: string;
  /** The agent's reply to it. */
  reply: string;
}

export interface InterviewRecord {
  exchanges: Exchange[];
  /** Why the interview ended. */
  end: string;
}

const PICKER = /"name"\s*:\s*"AskUserQuestion"/;

/**
 * Judges the interview: exactly one read-back, and no question after it. `transcripts`
 * holds each call's transcript, in call order. A question after the read-back is the
 * build call's last reply asking something, or a call of the question-picker tool.
 */
export function judgeInterview(
  mode: Mode,
  record: InterviewRecord | undefined,
  transcripts: string[]
): LineResult {
  if (mode === "brief") {
    return notApplicable("interview", "brief mode: no interview");
  }
  if (!record) {
    return fail("interview", "no interview.json in the run's out folder");
  }
  const readBacks = record.exchanges.filter((e) => isReadBack(e.reply)).length;
  if (readBacks === 0) {
    return fail(
      "interview",
      `no read-back; the interview ended: ${record.end}`
    );
  }
  if (readBacks > 1) {
    return fail("interview", `${String(readBacks)} read-backs`);
  }
  const index = record.exchanges.findIndex((e) => e.kind === "read-back");
  const build = record.exchanges[index];
  if (!build) {
    return fail(
      "interview",
      `the read-back got no answer; the interview ended: ${record.end}`
    );
  }
  if (looksLikeQuestion(build.reply)) {
    const last = build.reply.trim().split("\n").at(-1) ?? "";
    return fail(
      "interview",
      `a question after the read-back: "${last.slice(0, 100)}"`
    );
  }
  if (transcripts.slice(index).some((text) => PICKER.test(text))) {
    return fail(
      "interview",
      "the question-picker tool ran after the read-back"
    );
  }
  const answered = record.exchanges.filter((e) => e.kind === "answers").length;
  return pass(
    "interview",
    `1 read-back after ${String(answered)} answer messages; no question after it`
  );
}

/** The table of each `## Feature: <table>` heading in a build log. */
export function featureSections(log: string): string[] {
  return [...log.matchAll(/^##\s+Feature:\s*`?([a-z0-9_]+)`?\s*$/gm)].map(
    (match) => match[1] ?? ""
  );
}

function kebab(table: string): string {
  return table.replaceAll("_", "-");
}

/** Matches a table name in a relative file path, including its kebab-case form. */
function entityPath(table: string): RegExp {
  return new RegExp(
    `(?:^|[^a-z0-9_-])(?:${escape(table)}|${escape(kebab(table))})(?:[^a-z0-9_-]|$)`
  );
}

/** Matches a Hono client call from a screen that can live at any route path. */
function entityClient(table: string): RegExp {
  const camel = table.replaceAll(/_[a-z]/g, (part) =>
    part.slice(1).toUpperCase()
  );
  return new RegExp(
    `\\bapi\\s*(?:\\.\\s*${escape(camel)}|\\[\\s*["'](?:${escape(table)}|${escape(kebab(table))})["']\\s*\\])\\s*\\.\\s*\\$(?:get|post|put|patch|delete)\\b`
  );
}

/**
 * Which parts of one spec entity exist: its build log section, its `feat(build): feature
 * <table>` commit, its Drizzle table, an api route file, and an app screen. A route or a
 * screen is found by the table's name, snake or kebab case, in its path or as a route path.
 * A screen can also call the entity's Hono client from another path, such as `/`.
 */
export function entityParts(
  project: string,
  table: string,
  log: string,
  subjects: string[]
): [string, boolean][] {
  const names = `(?:${escape(table)}|${escape(kebab(table))})`;
  const routePath = new RegExp(`["'\`]/${names}(?![a-z0-9_-])`);
  const inPath = entityPath(table);
  const client = entityClient(table);
  const tableName = new RegExp(`["'\`]${escape(table)}["'\`]`);
  const routes = files(project, "apps/api/src/routes", ".ts").filter(
    (f) => !f.endsWith(".test.ts")
  );
  const screens = [
    ...files(project, "apps/app/src/routes", ".tsx"),
    ...files(project, "apps/app/src/routes", ".ts"),
  ];
  const routesDir = join(project, "apps/api/src/routes");
  const screensDir = join(project, "apps/app/src/routes");
  return [
    ["build log section", featureSections(log).includes(table)],
    [
      "commit",
      subjects.some((subject) =>
        new RegExp(`^feat\\(build\\): feature \`?${escape(table)}\`?$`).test(
          subject.trim()
        )
      ),
    ],
    [
      "table",
      files(project, "packages/db/src/schema", ".ts").some((f) =>
        tableName.test(read(f))
      ),
    ],
    [
      "api route",
      routes.some(
        (f) => inPath.test(relative(routesDir, f)) || routePath.test(read(f))
      ),
    ],
    [
      "app screen",
      screens.some(
        (f) =>
          inPath.test(relative(screensDir, f)) ||
          routePath.test(read(f)) ||
          client.test(read(f))
      ),
    ],
  ];
}

/**
 * Judges each entity of `docs/product-spec.md` end to end. `http`, given after the dev
 * servers ran, maps each table to the status its list route gave with no session: a 401
 * or 403 proves the route is mounted and guarded.
 */
export function judgeEntities(input: {
  mode: Mode;
  project: string;
  spec: string | undefined;
  log: string;
  subjects: string[];
  http?: Map<string, number | undefined>;
}): LineResult {
  if (input.spec === undefined) {
    return input.mode === "brief"
      ? notApplicable(
          "entities",
          "brief mode with no docs/product-spec.md; line 4 scores the entity"
        )
      : fail("entities", "no docs/product-spec.md");
  }
  const tables = specEntities(input.spec)
    .map((entity) =>
      (entity.parts.get("Table") ?? "").replaceAll("`", "").trim()
    )
    .filter((table) => table !== "");
  if (tables.length === 0) {
    return fail("entities", "the spec names no table under ## Entities");
  }
  const problems: string[] = [];
  for (const table of tables) {
    const parts = entityParts(input.project, table, input.log, input.subjects);
    if (input.http) {
      const status = input.http.get(table);
      parts.push(
        status === 401 || status === 403
          ? ["http", true]
          : [
              `http ${status === undefined ? "no answer" : String(status)}`,
              false,
            ]
      );
    }
    const missing = parts.filter(([, ok]) => !ok).map(([name]) => name);
    if (missing.length > 0) {
      problems.push(`\`${table}\` missing: ${missing.join(", ")}`);
    }
  }
  if (problems.length > 0) {
    return fail("entities", problems.join("; "));
  }
  const checked = input.http
    ? "log section, commit, table, api route, app screen, 401 with no session"
    : "log section, commit, table, api route, app screen (no HTTP: static scoring)";
  return pass(
    "entities",
    `${String(tables.length)} entities, each with its ${checked}`
  );
}

/** The brief's `deploy` field: `preview` or `none`, and `none` when it is absent. */
export function deployOf(brief?: string): "preview" | "none" {
  const front = /^---\n([\s\S]*?)\n---/.exec(brief ?? "")?.[1] ?? "";
  return /^deploy:\s*preview\s*$/m.test(front) ? "preview" : "none";
}

/**
 * A `wrangler` invocation with a subcommand that reaches a Cloudflare account, or a deploy
 * script. A command that only names `wrangler.jsonc` or `.wrangler/` is not a call.
 */
const DEPLOY_COMMAND =
  /\bwrangler(?:@[\w.^~-]+)?\s+(?:deploy|publish|d1|pages|versions|secret|kv|r2|queues|rollback|delete|tail|triggers|deployments|hyperdrive)\b|\bdeploy:(?:preview|production)\b/;

// A command that only searches or prints text. Its arguments are a pattern or a message,
// so `grep 'wrangler secret put'` names a deploy call without making one.
const TEXT_TOOLS = new Set([
  "grep",
  "egrep",
  "rg",
  "echo",
  "printf",
  "sed",
  "awk",
]);

/**
 * The simple commands of a shell line, split on `|`, `;`, `&` and newlines outside quotes.
 * Each comes back as written, quotes and all.
 */
function simpleCommands(line: string): string[] {
  const commands: string[] = [];
  let current = "";
  let quote = "";
  for (const char of line) {
    if (quote !== "") {
      quote = char === quote ? "" : quote;
      current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if ("|;&\n".includes(char)) {
      commands.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  commands.push(current);
  return commands.map((command) => command.trim()).filter(Boolean);
}

/** The program a simple command runs, past `VAR=value` words and an `export`. */
function programOf(command: string): string {
  const words = command.split(/\s+/);
  const index = words.findIndex(
    (word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== "export"
  );
  return (words[index] ?? "").split("/").at(-1) ?? "";
}

/**
 * The command with each heredoc body removed, `<<EOF`, `<<-'EOF'` or `<<"EOF"` through the
 * line that holds only its delimiter. The body is data for the command, such as a build
 * log that names `pnpm deploy:production` as a step left for a person.
 */
function withoutHeredocs(command: string): string {
  const kept: string[] = [];
  let delimiter = "";
  for (const line of command.split("\n")) {
    if (delimiter !== "") {
      if (line.replace(/^\t+/, "") === delimiter) {
        delimiter = "";
      }
      continue;
    }
    kept.push(line);
    delimiter = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line)?.[2] ?? "";
  }
  return kept.join("\n");
}

/** True when a shell line holds a deploy call that is not just text for a text tool. */
export function isDeployCall(line: string): boolean {
  return simpleCommands(withoutHeredocs(line)).some(
    (command) =>
      !TEXT_TOOLS.has(programOf(command)) && DEPLOY_COMMAND.test(command)
  );
}

interface ToolEvent {
  type?: string;
  message?: {
    content?: { type?: string; input?: { command?: unknown } }[];
  };
}

/**
 * Every command in a transcript that calls `wrangler` or a deploy script. In a
 * stream-json transcript only tool calls count, not prose; a plain-text line counts when it
 * holds a wrangler subcommand or a deploy script.
 */
export function deployCalls(transcript: string): string[] {
  const calls: string[] = [];
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let event: ToolEvent | undefined;
    try {
      event = JSON.parse(trimmed) as ToolEvent;
    } catch {
      event = undefined;
    }
    if (!event || typeof event !== "object") {
      if (isDeployCall(trimmed)) {
        calls.push(trimmed);
      }
      continue;
    }
    if (event.type !== "assistant") {
      continue;
    }
    for (const block of event.message?.content ?? []) {
      const command = block.input?.command;
      if (
        block.type === "tool_use" &&
        typeof command === "string" &&
        isDeployCall(command)
      ) {
        calls.push(command);
      }
    }
  }
  return calls;
}

/** The `https://` addresses in the build log's `## ... Preview ...` section. */
export function previewUrls(log: string): string[] {
  const urls: string[] = [];
  for (const section of log.split(/^(?=## )/m)) {
    const title = section.split("\n")[0] ?? "";
    if (!/^##\s.*preview/i.test(title)) {
      continue;
    }
    for (const match of section.matchAll(/https:\/\/[^\s<>()`"']+/g)) {
      urls.push(match[0].replace(/[.,;:]+$/, ""));
    }
  }
  return urls;
}

/**
 * Judges the preview line. With `deploy: none` it is N/A while the agent made no deploy
 * call, and FAIL when it made one. With `deploy: preview` it passes when the first preview
 * address answered 200.
 */
export function judgePreview(
  deploy: "preview" | "none",
  calls: string[],
  probe?: { url: string; status: number | undefined }
): LineResult {
  if (deploy === "none") {
    return calls.length === 0
      ? notApplicable("preview", "deploy: none, and no wrangler or deploy call")
      : fail(
          "preview",
          `deploy: none, but the agent ran \`${calls[0] ?? ""}\``
        );
  }
  if (!probe) {
    return fail(
      "preview",
      "deploy: preview, but no address in the build log's Preview section"
    );
  }
  return probe.status === 200
    ? pass("preview", `${probe.url} answers 200`)
    : fail(
        "preview",
        `${probe.url} answers ${probe.status === undefined ? "nothing" : String(probe.status)}`
      );
}

// --- The agent lines (plan 0110) ------------------------------------------------------

/** What the audit command printed and how it exited. */
export interface AuditRun {
  code: number | null;
  output: string;
  timedOut?: boolean;
}

interface AuditReport {
  agent?: unknown;
  checks?: { id?: unknown; status?: unknown; detail?: unknown }[];
}

/** The `--json` report in the audit's output: from the first line that opens an object. */
function auditReport(output: string): AuditReport | undefined {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("{"));
  if (start === -1) {
    return undefined;
  }
  try {
    const report: unknown = JSON.parse(lines.slice(start).join("\n"));
    return typeof report === "object" && report !== null ? report : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Judges `pnpm agent:audit --require-key --json` against the running product. It passes
 * on exit 0 with `agent` installed: an audit with no `agent` skips every api check and
 * still exits 0, which proves nothing about the agent surface. `problem` says why the
 * audit did not run.
 */
export function judgeAudit(
  ran: AuditRun | undefined,
  problem?: string
): LineResult {
  if (!ran) {
    return fail("agent-audit", `not run: ${problem ?? "no reason recorded"}`);
  }
  if (ran.timedOut) {
    return fail("agent-audit", "the audit timed out");
  }
  const report = auditReport(ran.output);
  const tail = ran.output.trim().split("\n").slice(-2).join(" ").slice(0, 160);
  if (ran.code === 2) {
    return fail("agent-audit", `the audit exited 2 (usage or setup): ${tail}`);
  }
  if (!report) {
    return fail(
      "agent-audit",
      `the audit exited ${String(ran.code)} with no JSON report: ${tail}`
    );
  }
  const checks = report.checks ?? [];
  if (ran.code !== 0) {
    const first = checks.find(
      (check) =>
        typeof check.status === "string" &&
        check.status.toLowerCase() === "fail"
    );
    const id = typeof first?.id === "string" ? first.id : "no check";
    const detail =
      typeof first?.detail === "string"
        ? first.detail
        : "no failed check named";
    return fail(
      "agent-audit",
      `the audit exited ${String(ran.code)}; ${id}: ${detail}`
    );
  }
  if (report.agent !== true) {
    return fail(
      "agent-audit",
      "the audit exited 0, but agent is not installed, so no api check ran"
    );
  }
  const passed = checks.filter(
    (check) =>
      typeof check.status === "string" && check.status.toLowerCase() === "pass"
  ).length;
  return pass(
    "agent-audit",
    `exit 0; ${String(passed)} checks pass, tools/list with the seeded key included`
  );
}

/** What the second agent did: its exit, its transcript and its last reply. */
export interface SecondAgentRun {
  code: number | null;
  timedOut: boolean;
  transcript: string;
  reply: string;
}

/**
 * Starts the second agent with only the product's address and the key, and waits for it.
 * `scripts/agent-bench/second-agent.ts` is the harness's; a test passes a fake.
 */
export type SecondAgent = (input: {
  site: string;
  key: string;
  outDir: string;
}) => Promise<SecondAgentRun>;

/** The evidence of the second agent line. `problem` is why it could not run. */
export interface AgentUseEvidence {
  table: string;
  problem?: string;
  run?: SecondAgentRun;
  read?: Read;
}

/**
 * Judges the second agent: it ran to the end, it sent MCP `tools/call` requests, the key's
 * user (a fresh user, so it owned no row before) now has a row of the entity that the
 * scorer reads back through MCP, and the agent's reply names that row's id on a
 * `READ BACK: <id>` line.
 */
export function judgeAgentUse(evidence: AgentUseEvidence): LineResult {
  const { table, run: agentRun } = evidence;
  if (evidence.problem) {
    return fail("agent-use", evidence.problem);
  }
  if (!agentRun) {
    return fail("agent-use", "the second agent did not run");
  }
  if (agentRun.timedOut) {
    return fail("agent-use", "the second agent timed out");
  }
  if (agentRun.code !== 0) {
    return fail(
      "agent-use",
      `the second agent exited ${String(agentRun.code)}`
    );
  }
  const calls = mcpToolCalls(agentRun.transcript);
  if (calls === 0) {
    return fail(
      "agent-use",
      "the second agent's transcript holds no MCP tools/call"
    );
  }
  const rowsRead = evidence.read;
  if (!rowsRead) {
    return fail("agent-use", "the scorer did not read the rows back");
  }
  if ("problem" in rowsRead) {
    return fail("agent-use", `read back with the key: ${rowsRead.problem}`);
  }
  if (rowsRead.rows.length === 0) {
    return fail(
      "agent-use",
      `the key's user has no \`${table}\` row, so the second agent created nothing`
    );
  }
  const id = readBackId(agentRun.reply);
  if (id === undefined) {
    return fail(
      "agent-use",
      "the second agent's reply has no `READ BACK: <id>` line"
    );
  }
  const found = rowsRead.rows.some(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      String((row as { id?: unknown }).id) === id
  );
  return found
    ? pass(
        "agent-use",
        `row ${id} created and read back; the scorer read it with ${rowsRead.tool}; ${String(calls)} MCP tools/call in the transcript`
      )
    : fail(
        "agent-use",
        `${id} is not among the ${String(rowsRead.rows.length)} \`${table}\` rows the key reads`
      );
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Filesystem checks -------------------------------------------------------------

/** Finds the generated project: the run folder or a folder up to two levels below it. */
export function findProject(runDir: string): string | undefined {
  const queue: { dir: string; depth: number }[] = [{ dir: runDir, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    if (existsSync(join(next.dir, "saasaloy.json"))) {
      return next.dir;
    }
    if (next.depth === 2) {
      continue;
    }
    for (const entry of safeReaddir(next.dir)) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        queue.push({ dir: join(next.dir, entry.name), depth: next.depth + 1 });
      }
    }
  }
  return undefined;
}

/** Checks the eight parts of one entity end to end, by file and content. */
export function checkEntity(project: string, expect: Expect): LineResult {
  const { table, word } = expect.entity;
  const mentions = new RegExp(word, "i");
  const tableName = new RegExp(`["'\`]${table}["'\`]`);
  const parts: [string, boolean][] = [
    [
      "table",
      files(project, "packages/db/src/schema", ".ts").some((f) =>
        tableName.test(read(f))
      ),
    ],
    [
      "migration",
      files(project, "packages/db/migrations", ".sql").some((f) =>
        new RegExp(`create table[^(]*${table}`, "i").test(read(f))
      ),
    ],
    [
      "seed slice",
      // The shipped slices are kebab case (`audit-events.ts`); a snake case name counts too.
      [table, table.replaceAll("_", "-")].some((name) =>
        existsSync(join(project, `packages/db/src/seed/slices/${name}.ts`))
      ),
    ],
    [
      "validator",
      files(project, "packages/validators/src", ".ts").some(
        (f) =>
          entityPath(table).test(
            relative(join(project, "packages/validators/src"), f)
          ) || mentions.test(read(f))
      ),
    ],
    [
      "api route",
      files(project, "apps/api/src/routes", ".ts").some((f) =>
        mentions.test(read(f))
      ),
    ],
    [
      "app screen",
      files(project, "apps/app/src", ".tsx").some((f) =>
        mentions.test(read(f))
      ),
    ],
    [
      "admin list",
      files(project, "apps/admin/src/routes", ".tsx").some((f) =>
        mentions.test(read(f))
      ),
    ],
    [
      "route test",
      files(project, "apps/api/src", ".test.ts").some((f) =>
        mentions.test(read(f))
      ),
    ],
  ];
  const missing = parts.filter(([, ok]) => !ok).map(([name]) => name);
  return missing.length === 0
    ? pass("entity", `\`${table}\`: all 8 parts present`)
    : fail("entity", `\`${table}\` missing: ${missing.join(", ")}`);
}

function files(project: string, dir: string, suffix: string): string[] {
  const root = join(project, dir);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(entry.parentPath, entry.name));
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// --- Processes ---------------------------------------------------------------------

interface Ran {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/**
 * Runs a command in its own process group, with its output in `logFile`, and kills the
 * whole group when it times out. The group kill is what stops a `pnpm` wrapper's
 * grandchildren too.
 */
export async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    logFile: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
  }
): Promise<Ran> {
  const log = await open(options.logFile, "w");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  trackGroup(child.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid);
  }, options.timeoutMs);
  const code = await new Promise<number | null>((resolve) => {
    child.on("error", () => {
      resolve(null);
    });
    child.on("exit", (exitCode) => {
      resolve(exitCode);
    });
  });
  clearTimeout(timer);
  killGroup(child.pid);
  untrackGroup(child.pid);
  await log.close();
  return { code, output: readFileSync(options.logFile, "utf-8"), timedOut };
}

// Every process group the benchmark starts, so a signal handler can stop them all.
const groups = new Set<number>();

/** Records a detached child's process group for `stopAllGroups()`. */
export function trackGroup(pid: number | undefined): void {
  if (pid) {
    groups.add(pid);
  }
}

/** Forgets a process group once it is stopped, so a reused id is never killed. */
export function untrackGroup(pid: number | undefined): void {
  if (pid) {
    groups.delete(pid);
  }
}

/** Kills every tracked process group. Safe to call from a signal handler. */
export function stopAllGroups(): void {
  for (const pid of groups) {
    killGroup(pid, "SIGKILL");
  }
  groups.clear();
}

export function killGroup(
  pid: number | undefined,
  signal: NodeJS.Signals = "SIGTERM"
): void {
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

/** True when something accepts a TCP connection on the loopback port. */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // Not up yet.
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Kills every process whose working directory sits inside `dir`. The agent can start a
 * dev server with `nohup` or `setsid`, which leaves the process group the benchmark
 * owns, so a group kill alone misses it. Linux only: elsewhere it returns no pids.
 */
export async function killStrays(dir: string): Promise<number[]> {
  const found = straysIn(dir);
  for (const pid of found) {
    tryKill(pid, "SIGTERM");
  }
  if (found.length > 0) {
    await sleep(3000);
  }
  for (const pid of straysIn(dir)) {
    tryKill(pid, "SIGKILL");
  }
  if (found.length > 0) {
    await sleep(500);
  }
  return straysIn(dir);
}

function straysIn(dir: string): number[] {
  if (!existsSync("/proc")) {
    return [];
  }
  const pids: number[] = [];
  for (const entry of safeReaddir("/proc")) {
    const pid = Number(entry.name);
    if (!Number.isInteger(pid) || pid === process.pid) {
      continue;
    }
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd === dir || cwd.startsWith(`${dir}/`)) {
        pids.push(pid);
      }
    } catch {
      // Gone, or not ours to read.
    }
  }
  return pids;
}

function tryKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// --- Scoring -----------------------------------------------------------------------

export interface ScoreOptions {
  /** The folder the agent ran in. */
  runDir: string;
  /** Where the scorer writes its logs. The harness's `interview.json` and `agent/` sit here. */
  outDir: string;
  expect: Expect;
  /** `interview` when the harness ran the interview; `brief` by default. */
  mode?: Mode;
  /** The port block for the dev servers. Without one they take the pinned ports. */
  block?: number;
  /** Skip the lines that run commands or start servers. */
  staticOnly?: boolean;
  /**
   * Starts the second agent of the agent-use line. Without one that line fails: the
   * scorer never plays the second agent itself.
   */
  secondAgent?: SecondAgent;
}

export interface Score {
  results: LineResult[];
  stop: string | undefined;
  table: string;
  project: string | undefined;
}

function readIf(path: string): string | undefined {
  return existsSync(path) ? read(path) : undefined;
}

/** Each agent call's transcript in `<outDir>/agent/`, in call order. */
export function readTranscripts(outDir: string): string[] {
  const dir = join(outDir, "agent");
  return safeReaddir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .toSorted()
    .map((name) => read(join(dir, name)));
}

function readInterview(outDir: string): InterviewRecord | undefined {
  const text = readIf(join(outDir, "interview.json"));
  return text === undefined ? undefined : (JSON.parse(text) as InterviewRecord);
}

export async function scoreRun(options: ScoreOptions): Promise<Score> {
  const { runDir, outDir, expect } = options;
  const mode = options.mode ?? "brief";
  await mkdir(outDir, { recursive: true });
  const project = findProject(runDir);
  const transcripts = readTranscripts(outDir);
  const results: LineResult[] = [
    judgeInterview(mode, readInterview(outDir), transcripts),
  ];
  let stop: string | undefined;

  if (!project) {
    const detail = "no saasaloy project (no saasaloy.json) in the run folder";
    for (const line of MVP_BAR) {
      if (line.id !== "interview") {
        results.push(fail(line.id, detail));
      }
    }
    return finish(results);
  }

  const logPath = join(project, "docs/build-log.md");
  const logText = readIf(logPath) ?? "";
  const log = existsSync(logPath) ? parseBuildLog(logText) : undefined;
  if (log) {
    stop = stopPoint(log);
  }
  const spec = readIf(join(project, "docs/product-spec.md"));
  const tables = spec
    ? specEntities(spec)
        .map((e) => (e.parts.get("Table") ?? "").replaceAll("`", "").trim())
        .filter((table) => table !== "")
    : [];
  const subjects = await commitSubjects(project, outDir);
  const brief =
    readIf(join(project, "docs/product-brief.md")) ??
    readIf(join(runDir, "product-brief.md"));
  const deploy = deployOf(brief);
  const calls = transcripts.flatMap((text) => deployCalls(text));

  results.push(
    checkEntity(project, expect),
    await checkCommits(project, outDir, log),
    await checkBuildLog(project, outDir, log)
  );

  if (options.staticOnly) {
    for (const id of [
      "landing",
      "auth",
      "reset",
      "check",
      "agent-audit",
      "agent-use",
    ] as const) {
      results.push(fail(id, "not run (static scoring only)"));
    }
    results.push(
      judgeEntities({ mode, project, spec, log: logText, subjects }),
      deploy === "preview"
        ? fail("preview", "not run (static scoring only)")
        : judgePreview(deploy, calls)
    );
  } else {
    const runtime = await checkRuntime(
      project,
      outDir,
      expect,
      options.block,
      tables,
      options.secondAgent
    );
    results.push(
      ...runtime.results,
      judgeEntities({
        mode,
        project,
        spec,
        log: logText,
        subjects,
        http: runtime.http,
      }),
      judgePreview(deploy, calls, await probePreview(deploy, logText))
    );
  }
  return finish(results, stop, project);
}

function finish(results: LineResult[], stop?: string, project?: string): Score {
  return { results, stop, table: formatTable(results, stop), project };
}

/** The subject of each commit on `build/mvp`, newest first; empty with no such branch. */
async function commitSubjects(
  project: string,
  outDir: string
): Promise<string[]> {
  if (!existsSync(join(project, ".git"))) {
    return [];
  }
  const log = await git(project, outDir, [
    "log",
    "--format=%s",
    "refs/heads/build/mvp",
  ]);
  return log.code === 0 ? log.output.split("\n").filter((s) => s !== "") : [];
}

/** Fetches the first preview address of the build log, with `deploy: preview`. */
async function probePreview(
  deploy: "preview" | "none",
  log: string
): Promise<{ url: string; status: number | undefined } | undefined> {
  const url = previewUrls(log)[0];
  if (deploy !== "preview" || !url) {
    return undefined;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { url, status: response.status };
  } catch {
    return { url, status: undefined };
  }
}

async function git(
  project: string,
  outDir: string,
  args: string[]
): Promise<Ran> {
  return run("git", ["-C", project, ...args], {
    cwd: project,
    logFile: join(outDir, "git.log"),
    timeoutMs: 30_000,
  });
}

async function checkCommits(
  project: string,
  outDir: string,
  log: BuildLog | undefined
): Promise<LineResult> {
  if (!existsSync(join(project, ".git"))) {
    return fail("commits", "the project is not a git repository");
  }
  const tip = await git(project, outDir, [
    "rev-parse",
    "--verify",
    "--quiet",
    "refs/heads/build/mvp",
  ]);
  if (tip.code !== 0) {
    return fail("commits", "no build/mvp branch");
  }
  const others = await git(project, outDir, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
  ]);
  const exclude = others.output
    .split("\n")
    .filter((ref) => ref !== "" && ref !== "refs/heads/build/mvp");
  const count = await git(project, outDir, [
    "rev-list",
    "--count",
    "refs/heads/build/mvp",
    ...(exclude.length > 0 ? ["--not", ...exclude] : []),
  ]);
  const commits = Number(count.output.trim()) || 0;
  const remote = await git(project, outDir, [
    "branch",
    "-r",
    "--contains",
    tip.output.trim(),
  ]);
  const status = await git(project, outDir, ["status", "--porcelain"]);
  const stages =
    log?.stages.filter((stage) => stage.status === "done").length ?? 0;
  const problems: string[] = [];
  if (commits < Math.max(1, stages)) {
    problems.push(`${commits} commits for ${stages} finished stages`);
  }
  if (remote.output.trim() !== "") {
    problems.push("pushed to a remote");
  }
  if (status.output.trim() !== "") {
    problems.push("uncommitted changes");
  }
  return problems.length === 0
    ? pass("commits", `${commits} commits on build/mvp, nothing pushed`)
    : fail("commits", problems.join("; "));
}

async function checkBuildLog(
  project: string,
  outDir: string,
  log: BuildLog | undefined
): Promise<LineResult> {
  if (!log) {
    return fail("build-log", "no docs/build-log.md");
  }
  if (log.stages.length === 0) {
    return fail("build-log", "the log lists no stage");
  }
  const problems: string[] = [];
  const unknown: string[] = [];
  for (const stage of log.stages) {
    if (!stage.commit) {
      continue;
    }
    const found = await git(project, outDir, [
      "cat-file",
      "-e",
      `${stage.commit}^{commit}`,
    ]);
    if (found.code !== 0) {
      unknown.push(stage.commit);
    }
  }
  const withCommit = log.stages.filter((stage) => stage.commit).length;
  if (withCommit === 0) {
    problems.push("no stage names a commit");
  }
  if (unknown.length > 0) {
    problems.push(`unknown commits: ${unknown.join(", ")}`);
  }
  if (!log.hasHumanSection) {
    problems.push("no section for steps left to a human");
  }
  return problems.length === 0
    ? pass(
        "build-log",
        `${log.stages.length} stages, ${withCommit} with a commit`
      )
    : fail("build-log", problems.join("; "));
}

interface Runtime {
  results: LineResult[];
  /** Each spec table's list route status with no session; absent when the api never ran. */
  http?: Map<string, number | undefined>;
}

/**
 * The ports the dev servers take. Given a block and a project with `pnpm dev:ports`, it
 * runs that command with `DEV_PORTS_BLOCK`, which writes the block into each service's
 * `.env.local`, and reads `.devports.json`. Otherwise the pinned ports.
 */
async function devPorts(
  project: string,
  outDir: string,
  block: number | undefined,
  scripts: Record<string, string>
): Promise<{ ports: Ports; problem?: string }> {
  if (block === undefined || !scripts["dev:ports"]) {
    return { ports: PINNED_PORTS };
  }
  const ran = await run("pnpm", ["dev:ports"], {
    cwd: project,
    logFile: join(outDir, "dev-ports.log"),
    timeoutMs: 120_000,
    env: { ...process.env, DEV_PORTS_BLOCK: String(block) },
  });
  const ports = portsFromRecord(readIf(join(project, ".devports.json")), block);
  return ran.code === 0
    ? { ports }
    : { ports, problem: `pnpm dev:ports exited ${String(ran.code)}` };
}

async function checkRuntime(
  project: string,
  outDir: string,
  expect: Expect,
  block: number | undefined,
  tables: string[],
  secondAgent: SecondAgent | undefined
): Promise<Runtime> {
  const results: LineResult[] = [];
  const pkg = existsSync(join(project, "package.json"))
    ? (JSON.parse(read(join(project, "package.json"))) as {
        scripts?: Record<string, string>;
      })
    : {};
  const scripts = pkg.scripts ?? {};

  // `pnpm check` and the two seed runs.
  const checkProblems: string[] = [];
  if (!existsSync(join(project, "node_modules"))) {
    checkProblems.push("dependencies not installed");
  }
  if (scripts.check) {
    const check = await run("pnpm", ["check"], {
      cwd: project,
      logFile: join(outDir, "pnpm-check.log"),
      timeoutMs: 30 * 60_000,
    });
    if (check.code !== 0) {
      checkProblems.push(
        `pnpm check exited ${check.timedOut ? "on timeout" : check.code}`
      );
    }
  } else {
    checkProblems.push("no `check` script");
  }
  if (scripts["db:seed"]) {
    const seeds: Map<string, number>[] = [];
    for (const n of [1, 2]) {
      const seed = await run("pnpm", ["db:seed"], {
        cwd: project,
        logFile: join(outDir, `db-seed-${n}.log`),
        timeoutMs: 5 * 60_000,
      });
      if (seed.code !== 0) {
        checkProblems.push(`db:seed run ${n} exited ${seed.code}`);
      }
      seeds.push(parseSeedCounts(seed.output));
    }
    const [first, second] = seeds;
    if (first && second && !sameCounts(first, second)) {
      checkProblems.push("the two db:seed runs differ");
    }
  } else {
    checkProblems.push("no `db:seed` script");
  }
  results.push(
    checkProblems.length === 0
      ? pass("check", "pnpm check green, seed counts match")
      : fail("check", checkProblems.join("; "))
  );

  // The dev servers, for the HTTP lines.
  const notScored = (detail: string): Runtime => ({
    results: [
      ...results,
      fail("landing", detail),
      fail("auth", detail),
      fail("reset", detail),
      fail("agent-audit", detail),
      fail("agent-use", detail),
    ],
  });
  const { ports, problem } = await devPorts(project, outDir, block, scripts);
  if (problem) {
    return notScored(`${problem}; not scored`);
  }
  const busy: number[] = [];
  for (const port of [ports.web, ports.admin, ports.app, ports.api]) {
    if (await portBusy(port)) {
      busy.push(port);
    }
  }
  if (busy.length > 0) {
    return notScored(`port ${busy.join(", ")} busy before scoring; not scored`);
  }
  if (!scripts.dev) {
    return notScored("no `dev` script");
  }
  const origins = originsOf(ports);
  let http: Map<string, number | undefined> | undefined;

  const devLog = join(outDir, "dev.log");
  const handle = await open(devLog, "w");
  const dev = spawn("pnpm", ["dev"], {
    cwd: project,
    detached: true,
    stdio: ["ignore", handle.fd, handle.fd],
  });
  trackGroup(dev.pid);
  try {
    const webUp = await waitForHttp(`${origins.web}/`, 180_000);
    const apiUp = await waitForHttp(`${origins.api}/health`, 60_000);

    if (webUp) {
      const html = await (await fetch(`${origins.web}/`)).text();
      results.push(judgeLanding(html, expect));
    } else {
      results.push(fail("landing", `web did not answer on ${ports.web}`));
    }

    const email = `bench-${Date.now()}@bench.test`;
    if (apiUp) {
      results.push(
        await checkAuth(email, project, origins, ports),
        await checkReset(`reset-${email}`, devLog, origins)
      );
      http = await listRouteStatus(origins.api, tables);
      results.push(
        ...(await checkAgentLines({
          project,
          outDir,
          origins,
          table: tables[0] ?? expect.entity.table,
          secondAgent,
        }))
      );
    } else {
      const down = `api did not answer on ${ports.api}`;
      results.push(
        fail("auth", down),
        fail("reset", down),
        fail("agent-audit", down),
        fail("agent-use", down)
      );
    }
  } finally {
    killGroup(dev.pid);
    await sleep(3000);
    killGroup(dev.pid, "SIGKILL");
    untrackGroup(dev.pid);
    await handle.close();
    await killStrays(project);
  }
  return { results, http };
}

/**
 * Each table's list route status with no session: `GET /<kebab-table>`, then
 * `GET /<table>` when the first answers 404.
 */
async function listRouteStatus(
  api: string,
  tables: string[]
): Promise<Map<string, number | undefined>> {
  const statuses = new Map<string, number | undefined>();
  for (const table of tables) {
    let status: number | undefined;
    for (const path of new Set([kebab(table), table])) {
      try {
        const response = await fetch(`${api}/${path}`, {
          signal: AbortSignal.timeout(15_000),
        });
        status = response.status;
      } catch {
        status = undefined;
      }
      if (status !== 404) {
        break;
      }
    }
    statuses.set(table, status);
  }
  return statuses;
}

// The reset line tests the mail, not the app, so it calls from the web origin, which
// the base trusts. The auth line calls from `app`, because the bar says "through app".
interface Origins {
  web: string;
  app: string;
  api: string;
  auth: string;
}

function originsOf(ports: Ports): Origins {
  return {
    web: `http://localhost:${ports.web}`,
    app: `http://localhost:${ports.app}`,
    api: `http://localhost:${ports.api}`,
    auth: `http://localhost:${ports.api}/auth`,
  };
}

const PASSWORD = "bench-password-1234";

async function post(
  origins: Origins,
  path: string,
  body: unknown,
  origin = origins.app
): Promise<Response> {
  return fetch(`${origins.auth}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

function statusOf(response: Response, origin: string): string {
  return response.status === 403
    ? `403 (origin ${origin} not trusted)`
    : String(response.status);
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function checkAuth(
  email: string,
  project: string,
  origins: Origins,
  ports: Ports
): Promise<LineResult> {
  const problems: string[] = [];
  if (!existsSync(join(project, "apps/app"))) {
    problems.push("no apps/app");
  } else if (!(await waitForHttp(`${origins.app}/`, 60_000))) {
    problems.push(`app did not answer on ${ports.app}`);
  }
  try {
    const signUp = await post(origins, "/sign-up/email", {
      email,
      password: PASSWORD,
      name: "Bench Reader",
    });
    if (!signUp.ok) {
      problems.push(`sign-up returned ${statusOf(signUp, origins.app)}`);
    }
    const signIn = await post(origins, "/sign-in/email", {
      email,
      password: PASSWORD,
    });
    if (!signIn.ok) {
      problems.push(`sign-in returned ${statusOf(signIn, origins.app)}`);
    }
    const cookie = cookieOf(signIn);
    const session = await fetch(`${origins.auth}/get-session`, {
      headers: { cookie, origin: origins.app },
      signal: AbortSignal.timeout(15_000),
    });
    const data = session.ok
      ? ((await session.json()) as { user?: { email?: string } } | null)
      : null;
    if (data?.user?.email !== email) {
      problems.push("get-session does not return the new user");
    }
  } catch (error) {
    problems.push(`auth request failed: ${(error as Error).message}`);
  }
  return problems.length === 0
    ? pass("auth", "app answers; sign-up, sign-in and session work")
    : fail("auth", problems.join("; "));
}

async function checkReset(
  email: string,
  devLog: string,
  origins: Origins
): Promise<LineResult> {
  const web = origins.web;
  const body = { email, redirectTo: `${web}/reset-password` };
  try {
    const user = { email, password: PASSWORD, name: "Bench Reset" };
    const signUp = await post(origins, "/sign-up/email", user, web);
    if (!signUp.ok) {
      return fail("reset", `sign-up returned ${statusOf(signUp, web)}`);
    }
    // Better Auth renamed `/forget-password` to `/request-password-reset`; try both.
    let response = await post(origins, "/request-password-reset", body, web);
    if (response.status === 404) {
      response = await post(origins, "/forget-password", body, web);
    }
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      return fail(
        "reset",
        `reset request returned ${statusOf(response, web)} ${reason.slice(0, 120)}`.trim()
      );
    }
  } catch (error) {
    return fail("reset", `reset request failed: ${(error as Error).message}`);
  }
  await sleep(3000);
  const mail = findConsoleMail(read(devLog), email);
  if (!mail) {
    return fail("reset", "no console mail to the user in the api log");
  }
  return /reset/i.test(mail)
    ? pass("reset", "reset mail logged by email-console")
    : fail("reset", "a mail was logged, but it is not a reset mail");
}

/**
 * The two agent lines, with the dev servers up. The scorer seeds a key for the spec's first
 * entity (`./agent-use.ts` says how), runs the audit command with it, starts the second
 * agent with only the site's address and the key, then reads the entity's rows back
 * through MCP with the same key. `agent-key.json` in the out folder records the seed.
 */
async function checkAgentLines(input: {
  project: string;
  outDir: string;
  origins: Origins;
  table: string;
  secondAgent: SecondAgent | undefined;
}): Promise<LineResult[]> {
  const { project, outDir, origins, table, secondAgent } = input;
  const seeded = await seedAgentKey({
    api: origins.api,
    appOrigin: origins.app,
    table,
    email: `agent-${String(Date.now())}@bench.test`,
    password: PASSWORD,
  });
  writeFileSync(
    join(outDir, "agent-key.json"),
    `${JSON.stringify(
      "key" in seeded
        ? { table, scopes: seeded.scopes, keyStart: seeded.key.slice(0, 6) }
        : { table, problem: seeded.problem },
      null,
      2
    )}\n`
  );
  if (!("key" in seeded)) {
    const problem = `no key: ${seeded.problem}`;
    return [judgeAudit(undefined, problem), judgeAgentUse({ table, problem })];
  }
  const audit = await run(
    "pnpm",
    [
      "--silent",
      "agent:audit",
      "--site",
      origins.web,
      "--api",
      origins.api,
      "--require-key",
      "--json",
    ],
    {
      cwd: project,
      logFile: join(outDir, "agent-audit.log"),
      timeoutMs: 5 * 60_000,
      env: { ...process.env, AGENT_AUDIT_KEY: seeded.key },
    }
  );
  if (!secondAgent) {
    return [
      judgeAudit(audit),
      judgeAgentUse({
        table,
        problem: "no second agent command was given to the scorer",
      }),
    ];
  }
  const second = await secondAgent({
    site: origins.web,
    key: seeded.key,
    outDir,
  });
  const rows = await readEntityRows(origins.api, seeded.key, table);
  return [judgeAudit(audit), judgeAgentUse({ table, run: second, read: rows })];
}

/** The project path relative to the run folder, for the report. */
export function describeProject(
  runDir: string,
  project: string | undefined
): string {
  if (!project) {
    return "none";
  }
  return relative(runDir, project) || ".";
}
