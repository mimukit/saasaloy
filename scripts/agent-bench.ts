// The agent benchmark (plan 0074, issue #222): how far does an unattended agent get?
//
//   node scripts/agent-bench.ts                  run the agent, then score the result
//   node scripts/agent-bench.ts --score <dir>    score an earlier run folder again
//   node scripts/agent-bench.ts --score <dir> --static
//                                                score only the lines that need no server
//
// A run makes an empty folder `.dev/bench/<run-id>/`, copies in the brief fixture as
// `./product-brief.md` and the env fixture as `./env`, and starts Claude Code in it,
// headless: `claude -p --permission-mode bypassPermissions --max-turns 400` with the
// prompt in `scripts/agent-bench/prompt.md`. `saasaloy` on the agent's PATH is this
// worktree's freshly built CLI, through `scripts/saasaloy-shim.sh`, so the run measures
// unreleased changes to the CLI and to `modules/`. Logs, the transcript and the score go
// to `.dev/bench/<run-id>.out/`, outside the folder the agent sees.
//
// The agent's folder sits inside this repo, so the run walls it off from the repo:
//   - `CLAUDE_CONFIG_DIR` is a fresh folder, so this box's user settings, skills,
//     plugins and hooks do not load. `claudeMdExcludes` names this repo's own CLAUDE.md
//     and AGENTS.md, which Claude Code would otherwise read from the parent, and
//     `~/.claude/CLAUDE.md`, which Claude Code reads even with a fresh config folder.
//   - Two leaks stay: this repo's project skills (`.claude/skills/`) still load, and
//     nothing stops the agent reading the repo itself with `cd ../../..`. Only a folder
//     outside the repo, or a mount namespace, would close them.
//   - `GIT_CEILING_DIRECTORIES` stops git at `.dev/bench`, so the agent's commits land in
//     the project it makes and never on this repo's branch.
//   - `GITHUB_TOKEN` and `GH_TOKEN` are removed, so nothing the agent runs can push.
//   - The parent session's `CLAUDECODE*` variables are removed, so the agent does not
//     run as a child of whatever session started the benchmark.
//
// On demand only, on a box with the `claude` CLI and its credentials. Never in CI. It
// exits 0 when every MVP bar line passes, 1 when one fails, and 2 when it cannot run.
// Every process it starts is stopped before it exits, including any server the agent
// left behind in its folder.
//
// Imports nothing but node: builtins and the scorer. Node 24 strips the types.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  describeProject,
  killGroup,
  killStrays,
  portBusy,
  PORTS,
  scoreRun,
} from "./agent-bench/score.ts";
import type { Expect } from "./agent-bench/score.ts";

const root = resolve(import.meta.dirname, "..");
const fixtures = join(root, "scripts/agent-bench");
const benchDir = join(root, ".dev/bench");
const MAX_TURNS = "400";
const AGENT_TIMEOUT_MS = 4 * 60 * 60_000;

// Variables that tie a child to the parent Claude Code session, or that would let the
// agent push. The OAuth token stays: it is how a run on this box authenticates.
const STRIP = [
  /^CLAUDECODE$/,
  /^CLAUDE_CODE_(?!OAUTH_TOKEN$)/,
  /^CLAUDE_PID$/,
  /^CLAUDE_EFFORT$/,
  /^CLAUDE_AGENT_SDK_VERSION$/,
  /^CLAUDE_CONFIG_DIR$/,
  /^AI_AGENT$/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
];

function fatal(message: string): never {
  console.error(`agent-bench: ${message}`);
  process.exit(2);
}

function readExpect(): Expect {
  return JSON.parse(
    readFileSync(join(fixtures, "expect.json"), "utf-8")
  ) as Expect;
}

async function score(runDir: string, staticOnly: boolean): Promise<number> {
  const outDir = `${runDir.replace(/\/+$/, "")}.out`;
  const result = await scoreRun({
    runDir,
    outDir,
    expect: readExpect(),
    staticOnly,
  });
  writeFileSync(join(outDir, "score.md"), `${result.table}\n`);
  console.log(`\nProject: ${describeProject(runDir, result.project)}\n`);
  console.log(result.table);
  return result.results.every((r) => r.verdict === "PASS") ? 0 : 1;
}

function agentEnv(configDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIP.some((pattern) => pattern.test(key))) {
      env[key] = value;
    }
  }
  env.PATH = `${benchDir}:${process.env.PATH ?? ""}`;
  env.SAASALOY_REGISTRY_DIR = join(root, "modules");
  env.GIT_CEILING_DIRECTORIES = benchDir;
  env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

/** A fresh config folder, carrying only the credentials when no token is in the env. */
async function isolatedConfig(outDir: string): Promise<string> {
  const configDir = join(outDir, "claude-config");
  await mkdir(configDir, { recursive: true });
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
    const credentials = join(home, ".credentials.json");
    if (!existsSync(credentials)) {
      fatal(
        "no CLAUDE_CODE_OAUTH_TOKEN, no ANTHROPIC_API_KEY and no ~/.claude/.credentials.json"
      );
    }
    copyFileSync(credentials, join(configDir, ".credentials.json"));
  }
  return configDir;
}

async function runAgent(): Promise<number> {
  if (spawnSync("claude", ["--version"]).status !== 0) {
    fatal("the `claude` CLI is not on PATH");
  }

  const busy: number[] = [];
  for (const port of Object.values(PORTS)) {
    if (await portBusy(port)) {
      busy.push(port);
    }
  }
  if (busy.length > 0) {
    fatal(`port ${busy.join(", ")} is busy; stop what holds it first`);
  }

  console.log("agent-bench: building the local CLI");
  const build = spawnSync("pnpm", ["--filter", "saasaloy", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    fatal("`pnpm --filter saasaloy build` failed");
  }

  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = join(benchDir, runId);
  const outDir = `${runDir}.out`;
  await mkdir(runDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  copyFileSync(join(fixtures, "brief.md"), join(runDir, "product-brief.md"));
  copyFileSync(join(fixtures, "env"), join(runDir, "env"));
  // The shim finds the repo root two levels above itself, so it sits in .dev/bench.
  copyFileSync(
    join(root, "scripts/saasaloy-shim.sh"),
    join(benchDir, "saasaloy")
  );
  chmodSync(join(benchDir, "saasaloy"), 0o755);

  const configDir = await isolatedConfig(outDir);
  const prompt = readFileSync(join(fixtures, "prompt.md"), "utf-8").trim();
  const settings = JSON.stringify({
    claudeMdExcludes: [
      join(root, "CLAUDE.md"),
      join(root, "AGENTS.md"),
      join(homedir(), ".claude/CLAUDE.md"),
    ],
  });
  const args = [
    "-p",
    prompt,
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    MAX_TURNS,
    "--output-format",
    "stream-json",
    "--verbose",
    "--settings",
    settings,
  ];

  console.log(`agent-bench: run ${runId}, agent folder ${runDir}`);
  const transcript = await open(join(outDir, "claude.jsonl"), "w");
  const stderr = await open(join(outDir, "claude.stderr.log"), "w");
  const started = Date.now();
  const agent = spawn("claude", args, {
    cwd: runDir,
    env: agentEnv(configDir),
    detached: true,
    stdio: ["ignore", transcript.fd, stderr.fd],
  });
  const stop = () => {
    killGroup(agent.pid, "SIGKILL");
    void killStrays(runDir).then(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const timer = setTimeout(() => {
    killGroup(agent.pid);
  }, AGENT_TIMEOUT_MS);
  const code = await new Promise<number | null>((done) => {
    agent.on("error", () => {
      done(null);
    });
    agent.on("exit", (exitCode) => {
      done(exitCode);
    });
  });
  clearTimeout(timer);
  killGroup(agent.pid, "SIGKILL");
  await transcript.close();
  await stderr.close();
  const leftover = await killStrays(runDir);

  const summary = summarize(join(outDir, "claude.jsonl"));
  const minutes = Math.round((Date.now() - started) / 60_000);
  writeFileSync(
    join(outDir, "run.json"),
    `${JSON.stringify({ runId, code, minutes, ...summary }, null, 2)}\n`
  );
  console.log(
    `agent-bench: agent exited ${code} after ${minutes} min, ${summary.turns ?? "?"} turns, result ${summary.subtype ?? "unknown"}`
  );
  if (leftover.length > 0) {
    console.error(`agent-bench: could not stop pid ${leftover.join(", ")}`);
  }

  const exit = await score(runDir, false);
  const strays = await killStrays(runDir);
  const held: number[] = [];
  for (const port of Object.values(PORTS)) {
    if (await portBusy(port)) {
      held.push(port);
    }
  }
  if (strays.length > 0 || held.length > 0) {
    console.error(
      `agent-bench: still running: pid ${strays.join(", ") || "none"}, port ${held.join(", ") || "none"}`
    );
    return 2;
  }
  console.log(
    "\nagent-bench: no process the benchmark started is still running."
  );
  return exit;
}

/** Reads the `result` event at the end of the stream-json transcript. */
function summarize(transcriptPath: string): {
  turns?: number;
  subtype?: string;
  costUsd?: number;
} {
  const lines = readFileSync(transcriptPath, "utf-8")
    .trim()
    .split("\n")
    .toReversed();
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        num_turns?: number;
        total_cost_usd?: number;
      };
      if (event.type === "result") {
        return {
          turns: event.num_turns,
          subtype: event.subtype,
          costUsd: event.total_cost_usd,
        };
      }
    } catch {
      // A partial line at the end of a killed run.
    }
  }
  return {};
}

const argv = process.argv.slice(2);
const scoreIndex = argv.indexOf("--score");
if (scoreIndex === -1) {
  process.exit(await runAgent());
} else {
  const dir = argv[scoreIndex + 1];
  if (!dir) {
    fatal("--score needs a run folder");
  }
  const runDir = resolve(dir);
  if (!existsSync(runDir)) {
    fatal(`no run folder at ${runDir}`);
  }
  const code = await score(runDir, argv.includes("--static"));
  const strays = await killStrays(runDir);
  if (strays.length > 0) {
    fatal(`could not stop pid ${strays.join(", ")}`);
  }
  process.exit(code);
}
