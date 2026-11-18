// The agent benchmark (plan 0074, issue #222; interview mode, plan 0109, issue #347): how
// far does an unattended agent get?
//
//   node scripts/agent-bench.ts [--brief <name>]         brief mode: the old prompt with a
//                                                         brief file and an env file
//   node scripts/agent-bench.ts --interview [--brief <name>]
//                                                         interview mode: one sentence, then
//                                                         a scripted owner answers
//   node scripts/agent-bench.ts --score <run-dir> [--static]
//                                                         score an earlier run folder again
//
// More options: `--agent "<command>"` (default: `node scripts/agent-bench/agents/claude.ts`),
// `--runs <dir>` (default `~/.cache/saasaloy-bench`, never inside this repo), `--no-build`
// (use the CLI build on disk), `--static` (score only the lines that need no server).
//
// A brief is a folder under `scripts/agent-bench/briefs/`: `brief.md`, `env`,
// `expect.json` and `answers.md`. In brief mode the run copies `brief.md` in as
// `./product-brief.md` and `env` as `./env`, and sends `scripts/agent-bench/prompt.md`. In
// interview mode it copies nothing in: it sends `scripts/agent-bench/opening.md`, one
// sentence, and answers each question of `saasaloy-setup` from `answers.md`, one agent call
// per turn. `./agent-bench/interview.ts` says how a turn runs, how a reply is matched to an
// answer, and how the read-back and the end are found. `./agent-bench/agents/claude.ts`
// says what an agent command gets and must print.
//
// Where a run lives. `<runs>/<run-id>/` is the agent's folder, and `<runs>/<run-id>.out/`
// holds the transcript (`agent/call-NN.jsonl`), `interview.json`, `run.json`, the scorer's
// logs and `score.md`. Both sit outside this repo, so `cd ..` from the agent's folder never
// reaches it and the repo's CLAUDE.md, AGENTS.md and project skills never load. `saasaloy`
// on the agent's PATH is a copy of this worktree's CLI build, made with `pnpm deploy`, and
// `SAASALOY_REGISTRY_DIR` is a copy of `modules/`, both in `<run-id>.out/tools/`, so no
// path the agent sees points into the repo. The run measures unreleased changes to the CLI
// and to `modules/`. Nothing stops an agent with `bypassPermissions` reading any path it
// can guess; only a mount namespace would.
//
// Ports. A run takes its own block of ten ports from 10000 up, hashed from the run id and
// moved past any block with a listening port, as `pnpm dev:ports` picks a worktree's.
// `DEV_PORTS_BLOCK` in the agent's environment makes the project's `pnpm env:setup` and
// `pnpm dev:ports` write that block, so a run works while other dev servers hold 3000 to
// 4004. The scorer picks a free block again and starts the servers there.
//
// The environment. `GIT_CEILING_DIRECTORIES` stops git at the runs folder. `GITHUB_TOKEN`
// and `GH_TOKEN` are removed, so nothing the agent runs can push. The parent session's
// `CLAUDECODE*` variables are removed, so the agent does not run as a child of whatever
// session started the benchmark.
//
// The second agent. With the dev servers up, the scorer seeds a key for the spec's first
// entity and starts one more call of the same agent command, in an empty folder, with only
// the site's address and that key (`./agent-bench/second-agent.ts`). It must create one
// row and read it back through MCP. `./agent-bench/agent-use.ts` says how the key is
// seeded; `--score` starts the agent command that `run.json` records.
//
// The report. `score.md` starts with the brief, the mode, the revision, the turns, the
// time and the cost, then the bar table. The turns and the cost are the sum of what each
// agent call reported, or "unknown" when a call reported none. `release-preflight` reads
// these reports; see CONTRIBUTING.md, "Before you run it".
//
// On demand only, on a box with the agent's CLI and its credentials. Never in CI. It
// exits 0 when no bar line fails, 1 when one fails, and 2 when it cannot run. Every
// process it starts is stopped before it exits, including any server the agent left
// behind in its folder.
//
// Imports nothing but node: builtins and the files beside it. Node 24 strips the types.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  absolutePaths,
  cleanEnv,
  formatHeader,
  isInside,
  parseArgs,
  pickBlock,
  totals,
} from "./agent-bench/harness.ts";
import type { Call, Mode, Options, RunRecord } from "./agent-bench/harness.ts";
import {
  newInterview,
  nextMessage,
  parseAnswers,
  readTurnOutput,
} from "./agent-bench/interview.ts";
import {
  describeProject,
  killGroup,
  killStrays,
  portBusy,
  scoreRun,
  stopAllGroups,
  trackGroup,
  untrackGroup,
} from "./agent-bench/score.ts";
import type { Exchange, Expect, InterviewRecord } from "./agent-bench/score.ts";
import { secondAgent } from "./agent-bench/second-agent.ts";

const root = resolve(import.meta.dirname, "..");
const benchDir = join(root, "scripts/agent-bench");
const MAX_TURNS = "400";
const MAX_CALLS = 40;
const AGENT_TIMEOUT_MS = 4 * 60 * 60_000;

/**
 * Stops every process group the benchmark started, and every process left in the run
 * folder, when the benchmark is interrupted. Every child is detached, so a Ctrl-C or a
 * dropped SSH session (SIGHUP) reaches only this process, never the agent or a server.
 */
function stopOnSignal(runDir: string): void {
  const stop = () => {
    stopAllGroups();
    void killStrays(runDir).then(() => process.exit(130));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, stop);
  }
}

function fatal(message: string): never {
  console.error(`agent-bench: ${message}`);
  process.exit(2);
}

function briefDir(name: string): string {
  const dir = join(benchDir, "briefs", name);
  if (!existsSync(join(dir, "expect.json"))) {
    fatal(`no brief folder at scripts/agent-bench/briefs/${name}`);
  }
  return dir;
}

function readExpect(brief: string): Expect & { status?: string } {
  return JSON.parse(
    readFileSync(join(briefDir(brief), "expect.json"), "utf-8")
  ) as Expect & { status?: string };
}

/** The ports a run or the scorer can take: the first block with no listening port. */
function freeBlock(seed: string): Promise<number> {
  return pickBlock(seed, portBusy);
}

async function score(
  runDir: string,
  options: {
    brief: string;
    mode: Mode;
    staticOnly: boolean;
    agent: string[];
    header?: string;
  }
): Promise<number> {
  const outDir = `${runDir.replace(/\/+$/, "")}.out`;
  const block = await freeBlock(`${runDir}#score`);
  const result = await scoreRun({
    runDir,
    outDir,
    expect: readExpect(options.brief),
    mode: options.mode,
    block,
    staticOnly: options.staticOnly,
    secondAgent: secondAgent({ command: options.agent, env: process.env }),
  });
  const report = [options.header, result.table].filter(Boolean).join("\n\n");
  writeFileSync(join(outDir, "score.md"), `${report}\n`);
  console.log(`\nProject: ${describeProject(runDir, result.project)}\n`);
  console.log(report);
  return result.results.some((r) => r.verdict === "FAIL") ? 1 : 0;
}

function agentEnv(
  runs: string,
  bin: string,
  registry: string,
  extra: Record<string, string>
): NodeJS.ProcessEnv {
  return {
    ...cleanEnv(process.env),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SAASALOY_REGISTRY_DIR: registry,
    GIT_CEILING_DIRECTORIES: runs,
    ...extra,
  };
}

function gitText(args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/**
 * The tools the agent sees, outside the repo: a deployed copy of the CLI with its own
 * `node_modules`, a copy of `modules/` as the registry, and a `saasaloy` shim on PATH.
 */
function installTools(toolsDir: string): { bin: string; registry: string } {
  const cliDir = join(toolsDir, "cli");
  const deploy = spawnSync(
    "pnpm",
    ["--filter", "saasaloy", "deploy", "--prod", "--offline", cliDir],
    { cwd: root, encoding: "utf-8" }
  );
  if (deploy.status !== 0) {
    fatal(
      `\`pnpm --filter saasaloy deploy\` failed:\n${deploy.stderr || deploy.stdout}`
    );
  }
  const registry = join(toolsDir, "registry");
  cpSync(join(root, "modules"), registry, {
    recursive: true,
    filter: (source) => !source.split("/").includes("node_modules"),
  });
  const bin = join(toolsDir, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "saasaloy");
  writeFileSync(
    shim,
    `#!/usr/bin/env sh\nexec env SAASALOY_REGISTRY_DIR="${registry}" node "${join(cliDir, "dist", "index.js")}" "$@"\n`
  );
  chmodSync(shim, 0o755);
  return { bin, registry };
}

interface Agent {
  command: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  transcripts: string;
  stderr: string;
  deadline: number;
}

/** Runs one agent call with `message` on stdin, its stdout in the call's transcript. */
async function callAgent(
  agent: Agent,
  turn: number,
  message: string
): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
  const name = `call-${String(turn).padStart(2, "0")}.jsonl`;
  const transcriptPath = join(agent.transcripts, name);
  const transcript = await open(transcriptPath, "w");
  const stderr = await open(agent.stderr, "a");
  const [command = "", ...args] = agent.command;
  const child = spawn(command, args, {
    cwd: agent.cwd,
    env: { ...agent.env, AGENT_BENCH_TURN: String(turn) },
    detached: true,
    stdio: ["pipe", transcript.fd, stderr.fd],
  });
  trackGroup(child.pid);
  child.stdin?.on("error", () => {
    // The agent exited before it read its message; the exit code says why.
  });
  child.stdin?.end(message);
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      killGroup(child.pid);
    },
    Math.max(1000, agent.deadline - Date.now())
  );
  const code = await new Promise<number | null>((done) => {
    child.on("error", () => {
      done(null);
    });
    child.on("exit", (exitCode) => {
      done(exitCode);
    });
  });
  clearTimeout(timer);
  killGroup(child.pid, "SIGKILL");
  untrackGroup(child.pid);
  await transcript.close();
  await stderr.close();
  return { code, stdout: readFileSync(transcriptPath, "utf-8"), timedOut };
}

/** Runs the agent: one call in brief mode, the whole interview in interview mode. */
async function converse(
  agent: Agent,
  options: Options,
  outDir: string
): Promise<{ calls: Call[]; answers: number; end: string }> {
  const calls: Call[] = [];
  const exchanges: Exchange[] = [];
  const record = (
    end: string
  ): { calls: Call[]; answers: number; end: string } => {
    if (options.mode === "interview") {
      const interview: InterviewRecord = { exchanges, end };
      writeFileSync(
        join(outDir, "interview.json"),
        `${JSON.stringify(interview, null, 2)}\n`
      );
    }
    return { calls, answers: Math.max(0, calls.length - 1), end };
  };

  if (options.mode === "brief") {
    const prompt = readFileSync(join(benchDir, "prompt.md"), "utf-8").trim();
    const out = await callAgent(agent, 1, prompt);
    calls.push(callOf(1, out.code, readTurnOutput(out.stdout)));
    return record(
      out.timedOut
        ? "the agent timed out"
        : `the agent exited ${String(out.code)}`
    );
  }

  const answers = parseAnswers(
    readFileSync(join(briefDir(options.brief), "answers.md"), "utf-8")
  );
  const state = newInterview();
  let message = readFileSync(join(benchDir, "opening.md"), "utf-8").trim();
  let kind = "opening";
  let numbers: number[] = [];
  for (let turn = 1; turn <= MAX_CALLS; turn += 1) {
    const out = await callAgent(agent, turn, message);
    const output = readTurnOutput(out.stdout);
    calls.push(callOf(turn, out.code, output));
    exchanges.push({
      call: turn,
      kind,
      numbers,
      sent: message,
      reply: output.reply,
    });
    console.log(
      `agent-bench: call ${String(turn)} (${kind}${numbers.length > 0 ? ` ${numbers.join(", ")}` : ""}) exited ${String(out.code)}`
    );
    if (out.timedOut) {
      return record("the agent timed out");
    }
    if (out.code !== 0) {
      return record(
        `the agent exited ${String(out.code)} on call ${String(turn)}`
      );
    }
    if (kind === "read-back") {
      return record(`the build call exited 0 after the read-back`);
    }
    const step = nextMessage(state, output.reply, answers);
    if (step.kind === "stop" || step.message === undefined) {
      return record(step.reason ?? "the interview stopped");
    }
    message = step.message;
    kind = step.kind;
    numbers = step.numbers;
  }
  return record(`${String(MAX_CALLS)} agent calls with no end`);
}

function callOf(
  turn: number,
  code: number | null,
  output: { numTurns?: number; costUsd?: number; subtype?: string }
): Call {
  const call: Call = { turn, code };
  if (output.numTurns !== undefined) {
    call.numTurns = output.numTurns;
  }
  if (output.costUsd !== undefined) {
    call.costUsd = output.costUsd;
  }
  if (output.subtype !== undefined) {
    call.subtype = output.subtype;
  }
  return call;
}

/** The agent command: `--agent` with its paths made absolute, else the claude adapter. */
function agentCommand(options: Options): string[] {
  return options.agent
    ? absolutePaths(options.agent, process.cwd(), existsSync)
    : [process.execPath, join(benchDir, "agents", "claude.ts")];
}

async function runAgent(options: Options): Promise<number> {
  if (isInside(root, options.runs)) {
    fatal(
      `--runs ${options.runs} is inside this repo; pick a folder outside it, so the agent cannot reach the repo with cd ..`
    );
  }
  const dir = briefDir(options.brief);
  const expect = readExpect(options.brief);
  if (expect.status) {
    console.log(`agent-bench: brief ${options.brief} is a ${expect.status}`);
  }
  const command = agentCommand(options);

  if (options.build) {
    console.log("agent-bench: building the local CLI");
    const build = spawnSync("pnpm", ["--filter", "saasaloy", "build"], {
      cwd: root,
      stdio: "inherit",
    });
    if (build.status !== 0) {
      fatal("`pnpm --filter saasaloy build` failed");
    }
  }
  if (!existsSync(join(root, "packages/cli/dist/index.js"))) {
    fatal("no packages/cli/dist/index.js; run without --no-build");
  }

  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = join(options.runs, runId);
  const outDir = `${runDir}.out`;
  await mkdir(runDir, { recursive: true });
  stopOnSignal(runDir);
  await mkdir(join(outDir, "agent"), { recursive: true });
  await mkdir(join(outDir, "state"), { recursive: true });
  if (options.mode === "brief") {
    copyFileSync(join(dir, "brief.md"), join(runDir, "product-brief.md"));
    copyFileSync(join(dir, "env"), join(runDir, "env"));
  }
  const { bin, registry } = installTools(join(outDir, "tools"));
  const block = await freeBlock(runDir);

  const agent: Agent = {
    command,
    cwd: runDir,
    env: agentEnv(options.runs, bin, registry, {
      DEV_PORTS_BLOCK: String(block),
      AGENT_BENCH_SESSION: randomUUID(),
      AGENT_BENCH_STATE: join(outDir, "state"),
      AGENT_BENCH_MAX_TURNS: MAX_TURNS,
    }),
    transcripts: join(outDir, "agent"),
    stderr: join(outDir, "agent.stderr.log"),
    deadline: Date.now() + AGENT_TIMEOUT_MS,
  };

  console.log(
    `agent-bench: run ${runId}, ${options.mode} mode, brief ${options.brief}, block ${String(block)}, agent folder ${runDir}`
  );
  const started = Date.now();
  const talk = await converse(agent, options, outDir);
  const leftover = await killStrays(runDir);
  const minutes = Math.round((Date.now() - started) / 60_000);
  const sums = totals(talk.calls);
  const run: RunRecord = {
    runId,
    brief: options.brief,
    mode: options.mode,
    agent: command,
    revision: gitText(["rev-parse", "HEAD"]) || "unknown",
    tree: gitText(["status", "--porcelain"]) === "" ? "clean" : "dirty",
    block,
    minutes,
    calls: talk.calls,
    turns: sums.turns,
    costUsd: sums.costUsd,
    answers: talk.answers,
    end: talk.end,
  };
  writeFileSync(join(outDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  console.log(
    `agent-bench: ${talk.end}; ${String(minutes)} min, ${String(sums.turns)} turns, cost ${String(sums.costUsd)}`
  );
  if (leftover.length > 0) {
    console.error(`agent-bench: could not stop pid ${leftover.join(", ")}`);
  }

  const exit = await score(runDir, {
    brief: options.brief,
    mode: options.mode,
    staticOnly: options.staticOnly,
    agent: command,
    header: formatHeader(run),
  });
  const strays = await killStrays(runDir);
  if (strays.length > 0) {
    console.error(`agent-bench: still running: pid ${strays.join(", ")}`);
    return 2;
  }
  console.log(
    "\nagent-bench: no process the benchmark started is still running."
  );
  return exit;
}

/** Scores a run folder again, with the brief and mode its `run.json` records. */
async function rescore(options: Options): Promise<number> {
  const runDir = resolve(options.scoreDir ?? "");
  if (!existsSync(runDir)) {
    fatal(`no run folder at ${runDir}`);
  }
  stopOnSignal(runDir);
  const runFile = join(`${runDir.replace(/\/+$/, "")}.out`, "run.json");
  const run = existsSync(runFile)
    ? (JSON.parse(readFileSync(runFile, "utf-8")) as RunRecord)
    : undefined;
  const code = await score(runDir, {
    brief: run?.brief ?? options.brief,
    mode: run?.mode ?? options.mode,
    staticOnly: options.staticOnly,
    agent: run?.agent ?? agentCommand(options),
    header: run ? formatHeader(run) : undefined,
  });
  const strays = await killStrays(runDir);
  if (strays.length > 0) {
    fatal(`could not stop pid ${strays.join(", ")}`);
  }
  return code;
}

const options = parseArgs(process.argv.slice(2));
if (options.unknown.length > 0) {
  fatal(
    `unknown option ${options.unknown.join(", ")}; see the comment at the top of scripts/agent-bench.ts`
  );
}
process.exit(
  options.scoreDir === undefined
    ? await runAgent(options)
    : await rescore(options)
);
