// Scores one agent benchmark run against the MVP bar of plan 0074 (issue #222).
//
// `scripts/agent-bench.ts` calls `scoreRun()` after the agent exits, or on its own with
// `--score <run-dir>`. Each MVP bar line becomes one PASS or FAIL row. The static lines
// read the filesystem and git; the runtime lines run `pnpm check` and `pnpm db:seed`, then
// start the project's dev servers on their pinned ports and check over HTTP. Every process
// the scorer starts runs in its own process group, and the group is killed before the
// scorer returns. For a FAIL row, the scorer reads `docs/build-log.md` for the stop point.
//
// The parsers at the top are pure, and `./score.test.ts` covers them on `node --test`.
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, relative } from "node:path";

export interface Expect {
  productName: string;
  entity: { table: string; word: string };
  defaultLandingMarkers: string[];
}

export type Verdict = "PASS" | "FAIL";

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
] as const;

export type LineId = (typeof MVP_BAR)[number]["id"];

/** The pinned dev ports of a generated project, from the base AGENTS.md port map. */
export const PORTS = { web: 3000, admin: 3001, app: 3002, api: 4000 } as const;

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
    const stopped = STOP_WORDS.test(`${section.title}\n${body}`);
    log.stages.push({
      title: section.title,
      commit,
      status: stopped ? "stopped" : commit ? "done" : "open",
    });
  }
  return log;
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
  const passed = rows.length - failed.length;
  lines.push("", `${passed}/${rows.length} MVP bar lines pass.`);
  return lines.join("\n");
}

function pass(id: LineId, detail: string): LineResult {
  return { id, verdict: "PASS", detail };
}

function fail(id: LineId, detail: string): LineResult {
  return { id, verdict: "FAIL", detail };
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
      existsSync(join(project, `packages/db/src/seed/slices/${table}.ts`)),
    ],
    [
      "validator",
      files(project, "packages/validators/src", ".ts").some((f) =>
        mentions.test(read(f))
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
  /** Where the scorer writes its logs. */
  outDir: string;
  expect: Expect;
  /** Skip the lines that run commands or start servers. */
  staticOnly?: boolean;
}

export interface Score {
  results: LineResult[];
  stop: string | undefined;
  table: string;
  project: string | undefined;
}

export async function scoreRun(options: ScoreOptions): Promise<Score> {
  const { runDir, outDir, expect } = options;
  await mkdir(outDir, { recursive: true });
  const project = findProject(runDir);
  const results: LineResult[] = [];
  let stop: string | undefined;

  if (!project) {
    const detail = "no saasaloy project (no saasaloy.json) in the run folder";
    for (const line of MVP_BAR) {
      results.push(fail(line.id, detail));
    }
    return finish(results);
  }

  const logPath = join(project, "docs/build-log.md");
  const log = existsSync(logPath) ? parseBuildLog(read(logPath)) : undefined;
  if (log) {
    stop = stopPoint(log);
  }

  results.push(
    checkEntity(project, expect),
    await checkCommits(project, outDir, log),
    await checkBuildLog(project, outDir, log)
  );

  if (options.staticOnly) {
    for (const id of ["landing", "auth", "reset", "check"] as const) {
      results.push(fail(id, "not run (static scoring only)"));
    }
  } else {
    results.push(...(await checkRuntime(project, outDir, expect)));
  }
  return finish(results, stop, project);
}

function finish(results: LineResult[], stop?: string, project?: string): Score {
  return { results, stop, table: formatTable(results, stop), project };
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

async function checkRuntime(
  project: string,
  outDir: string,
  expect: Expect
): Promise<LineResult[]> {
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

  // The dev servers, for the three HTTP lines.
  const busy: number[] = [];
  for (const port of Object.values(PORTS)) {
    if (await portBusy(port)) {
      busy.push(port);
    }
  }
  if (busy.length > 0) {
    const detail = `port ${busy.join(", ")} busy before scoring; not scored`;
    return [
      ...results,
      fail("landing", detail),
      fail("auth", detail),
      fail("reset", detail),
    ];
  }
  if (!scripts.dev) {
    const detail = "no `dev` script";
    return [
      ...results,
      fail("landing", detail),
      fail("auth", detail),
      fail("reset", detail),
    ];
  }

  const devLog = join(outDir, "dev.log");
  const handle = await open(devLog, "w");
  const dev = spawn("pnpm", ["dev"], {
    cwd: project,
    detached: true,
    stdio: ["ignore", handle.fd, handle.fd],
  });
  trackGroup(dev.pid);
  try {
    const webUp = await waitForHttp(`http://localhost:${PORTS.web}/`, 180_000);
    const apiUp = await waitForHttp(
      `http://localhost:${PORTS.api}/health`,
      60_000
    );

    if (webUp) {
      const html = await (await fetch(`http://localhost:${PORTS.web}/`)).text();
      results.push(judgeLanding(html, expect));
    } else {
      results.push(fail("landing", `web did not answer on ${PORTS.web}`));
    }

    const email = `bench-${Date.now()}@shelfnote.test`;
    if (apiUp) {
      results.push(
        await checkAuth(email, project),
        await checkReset(`reset-${email}`, devLog)
      );
    } else {
      results.push(
        fail("auth", `api did not answer on ${PORTS.api}`),
        fail("reset", `api did not answer on ${PORTS.api}`)
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
  return results;
}

const APP_ORIGIN = `http://localhost:${PORTS.app}`;
// The reset line tests the mail, not the app, so it calls from the web origin, which
// the base trusts. The auth line calls from `app`, because the bar says "through app".
const WEB_ORIGIN = `http://localhost:${PORTS.web}`;
const AUTH = `http://localhost:${PORTS.api}/auth`;
const PASSWORD = "bench-password-1234";

async function post(
  path: string,
  body: unknown,
  origin = APP_ORIGIN
): Promise<Response> {
  return fetch(`${AUTH}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

function statusOf(response: Response, origin = APP_ORIGIN): string {
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

async function checkAuth(email: string, project: string): Promise<LineResult> {
  const problems: string[] = [];
  if (!existsSync(join(project, "apps/app"))) {
    problems.push("no apps/app");
  } else if (!(await waitForHttp(`${APP_ORIGIN}/`, 60_000))) {
    problems.push(`app did not answer on ${PORTS.app}`);
  }
  try {
    const signUp = await post("/sign-up/email", {
      email,
      password: PASSWORD,
      name: "Bench Reader",
    });
    if (!signUp.ok) {
      problems.push(`sign-up returned ${statusOf(signUp)}`);
    }
    const signIn = await post("/sign-in/email", { email, password: PASSWORD });
    if (!signIn.ok) {
      problems.push(`sign-in returned ${statusOf(signIn)}`);
    }
    const cookie = cookieOf(signIn);
    const session = await fetch(`${AUTH}/get-session`, {
      headers: { cookie, origin: APP_ORIGIN },
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

async function checkReset(email: string, devLog: string): Promise<LineResult> {
  const body = { email, redirectTo: `${WEB_ORIGIN}/reset-password` };
  try {
    const user = { email, password: PASSWORD, name: "Bench Reset" };
    const signUp = await post("/sign-up/email", user, WEB_ORIGIN);
    if (!signUp.ok) {
      return fail("reset", `sign-up returned ${statusOf(signUp, WEB_ORIGIN)}`);
    }
    // Better Auth renamed `/forget-password` to `/request-password-reset`; try both.
    let response = await post("/request-password-reset", body, WEB_ORIGIN);
    if (response.status === 404) {
      response = await post("/forget-password", body, WEB_ORIGIN);
    }
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      return fail(
        "reset",
        `reset request returned ${statusOf(response, WEB_ORIGIN)} ${reason.slice(0, 120)}`.trim()
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
