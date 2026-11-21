// The parts of `scripts/agent-bench.ts` that decide, with no process and no file write:
// its options, the agent command, the port block, the totals and the report header.
// `./harness.test.ts` covers them on `node --test`.
//
// Imports node: builtins and the base template's dev-ports core, so a run picks its port
// block the way `pnpm dev:ports` picks a worktree's. Node 24 strips the types.

import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  blockPorts,
  checkoutHash,
  chooseBlock,
  homeBlock,
} from "../../packages/cli/templates/base/packages/env/src/dev-ports.ts";

export type Mode = "brief" | "interview";

export interface Options {
  /** `--score <dir>`: score an earlier run folder, run no agent. */
  scoreDir?: string;
  /** `--brief <name>`: the folder under `scripts/agent-bench/briefs/`. */
  brief: string;
  /** `--interview`: start from one sentence and answer the interview from `answers.md`. */
  mode: Mode;
  /** `--agent "<command>"`: the agent command, split on spaces. */
  agent: string[] | undefined;
  /** `--runs <dir>`: where run folders go. Must be outside the repo. */
  runs: string;
  /** `--no-build`: use the CLI build that is on disk. */
  build: boolean;
  /** `--static`: score only the lines that need no server. */
  staticOnly: boolean;
  /** Arguments this script does not take. */
  unknown: string[];
}

// Variables that tie a child to the parent Claude Code session, that would let the agent
// push, or that would hand it the run's port block, the CLI's registry or the audit key.
// The OAuth token stays: it is how a run on this box authenticates.
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
  /^DEV_PORTS_BLOCK$/,
  /^SAASALOY_REGISTRY_DIR$/,
  /^AGENT_AUDIT_KEY$/,
];

/** `env` without the variables in `STRIP`. The harness adds back what each agent gets. */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!STRIP.some((pattern) => pattern.test(key))) {
      clean[key] = value;
    }
  }
  return clean;
}

/** The default folder for run folders: outside any repository, in the user's cache. */
export function defaultRuns(home = homedir()): string {
  return join(home, ".cache", "saasaloy-bench");
}

export function parseArgs(argv: string[], home = homedir()): Options {
  const options: Options = {
    brief: "shelfnote",
    mode: "brief",
    agent: undefined,
    runs: defaultRuns(home),
    build: true,
    staticOnly: false,
    unknown: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const value = (): string | undefined => {
      const next = argv[index + 1];
      let taken: string | undefined;
      if (next === undefined || next.startsWith("--")) {
        options.unknown.push(`${arg} (needs a value)`);
      } else {
        index += 1;
        taken = next;
      }
      return taken;
    };
    if (arg === "--score") {
      options.scoreDir = value();
    } else if (arg === "--brief") {
      options.brief = value() ?? options.brief;
    } else if (arg === "--interview") {
      options.mode = "interview";
    } else if (arg === "--agent") {
      const text = value();
      options.agent = text === undefined ? undefined : splitCommand(text);
    } else if (arg === "--runs") {
      const dir = value();
      options.runs = dir === undefined ? options.runs : resolve(dir);
    } else if (arg === "--no-build") {
      options.build = false;
    } else if (arg === "--static") {
      options.staticOnly = true;
    } else {
      options.unknown.push(arg);
    }
  }
  return options;
}

/** An explicit command takes precedence; otherwise the owner must select an agent. */
export async function selectAgent(
  command: string[] | undefined,
  ask: () => Promise<string>
): Promise<string[]> {
  if (command && command.length > 0) {
    return command;
  }
  const answer = (await ask()).trim().toLowerCase();
  if (answer !== "claude" && answer !== "codex") {
    throw new Error("Choose claude or codex; there is no default agent.");
  }
  return [answer];
}

/**
 * Splits a command line on spaces, keeping a single- or double-quoted part whole. No
 * shell runs it, so no variable, glob or pipe is expanded.
 */
export function splitCommand(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    words.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return words;
}

/**
 * The command with each relative path made absolute against `cwd`, so it still runs from
 * the agent's folder. A word counts as a path when it holds a `/` and names a file there.
 */
export function absolutePaths(
  command: string[],
  cwd: string,
  exists: (path: string) => boolean
): string[] {
  return command.map((word) =>
    !isAbsolute(word) && word.includes("/") && exists(resolve(cwd, word))
      ? resolve(cwd, word)
      : word
  );
}

/** True when `child` is `parent` or sits below it. */
export function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** The ten ports of a block: five frontend slots, then five backend slots. */
export function blockSlots(block: number): number[] {
  const services = [3000, 3001, 3002, 3003, 3004, 4000, 4001, 4002, 4003, 4004];
  return Object.values(
    blockPorts(
      block,
      services.map((devPort) => ({ name: String(devPort), devPort }))
    )
  );
}

/**
 * The port block for a run: hashed from `seed` like a worktree's root, then moved up past
 * any block one of whose ten ports listens.
 */
export async function pickBlock(
  seed: string,
  isListening: (port: number) => Promise<boolean>
): Promise<number> {
  return chooseBlock({
    home: homeBlock(checkoutHash(seed)),
    recorded: undefined,
    claimed: new Set(),
    isListening: async (block) => {
      const open = await Promise.all(blockSlots(block).map(isListening));
      return open.includes(true);
    },
  });
}

/** What one agent call reported, as `run.json` records it. */
export interface Call {
  turn: number;
  code: number | null;
  numTurns?: number;
  costUsd?: number;
  subtype?: string;
}

/**
 * The run's agent turns and cost: the sum over every call, or "unknown" when any call
 * did not report one. A missing number is never guessed.
 */
export function totals(calls: Call[]): {
  turns: number | "unknown";
  costUsd: number | "unknown";
} {
  const turns = calls.every((call) => call.numTurns !== undefined)
    ? calls.reduce((sum, call) => sum + (call.numTurns ?? 0), 0)
    : "unknown";
  const cost = calls.every((call) => call.costUsd !== undefined)
    ? Math.round(
        calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0) * 100
      ) / 100
    : "unknown";
  return {
    turns: calls.length === 0 ? "unknown" : turns,
    costUsd: calls.length === 0 ? "unknown" : cost,
  };
}

/** What `run.json` holds about one run. */
export interface RunRecord {
  runId: string;
  brief: string;
  mode: Mode;
  agent: string[];
  revision: string;
  tree: "clean" | "dirty";
  block: number;
  minutes: number;
  calls: Call[];
  turns: number | "unknown";
  costUsd: number | "unknown";
  /** Messages the scripted owner sent after the opening; 0 in brief mode. */
  answers: number;
  /** Why the run ended. */
  end: string;
}

/**
 * The head of a score report. `release-preflight` reads its `Brief:`, `Mode:` and
 * `Revision:` lines, so keep each on its own line with that exact label.
 */
export function formatHeader(run: RunRecord): string {
  const cost =
    run.costUsd === "unknown"
      ? "unknown (the agent command did not report it)"
      : `$${run.costUsd.toFixed(2)}, the sum of what each agent call reported`;
  const turns =
    run.turns === "unknown"
      ? "unknown (the agent command did not report them)"
      : `${String(run.turns)} over ${String(run.calls.length)} agent calls`;
  return [
    `# Agent benchmark: ${run.brief}`,
    "",
    `Brief: ${run.brief}`,
    `Mode: ${run.mode}`,
    `Revision: ${run.revision}`,
    `Tree: ${run.tree}`,
    `Run: ${run.runId}`,
    `Agent: ${run.agent.join(" ")}`,
    `Port block: ${String(run.block)} (ports ${blockSlots(run.block).join(", ")})`,
    `Time: ${String(run.minutes)} min`,
    `Turns: ${turns}`,
    `Owner answers: ${String(run.answers)}`,
    `Cost: ${cost}`,
    `End: ${run.end}`,
  ].join("\n");
}

/** A package runner the agent may call to start the CLI: `npx`, `pnpx` or `pnpm dlx`. */
export type Runner = "npx" | "pnpx" | "pnpm";

/**
 * The shim that stands in for a package runner on the agent's PATH. `llms.txt` tells the
 * agent to run `npx saasaloy@latest`, which would fetch the CLI from npm and measure the
 * last release, not this worktree. So a call that names `saasaloy` or `saasaloy@<any
 * version>` as its package runs `local`, the worktree's `saasaloy` shim, with the words
 * after the package name. Flags before the name are dropped. Any other call runs `real`
 * unchanged. For `pnpm`, only `pnpm dlx` is checked; every other pnpm command passes.
 */
export function runnerShim(
  runner: Runner,
  local: string,
  real: string
): string {
  const lines = ["#!/usr/bin/env sh"];
  if (runner === "pnpm") {
    lines.push(`[ "$1" = dlx ] || exec "${real}" "$@"`, "skip=1");
  } else {
    lines.push("skip=0");
  }
  lines.push(
    "n=0",
    "for arg do",
    "  n=$((n + 1))",
    '  [ "$n" -le "$skip" ] && continue',
    '  case "$arg" in',
    "    -*) continue ;;",
    `    saasaloy | saasaloy@*) shift "$n"; exec "${local}" "$@" ;;`,
    "  esac",
    "  break",
    "done",
    `exec "${real}" "$@"`,
    ""
  );
  return lines.join("\n");
}

/**
 * The run id, which also names the agent's folder: the start time as
 * `2026-11-20t08-42-18-047z`. Lowercase, because `llms.txt` has the agent run
 * `saasaloy init .` in that folder, and `init` takes the project name from the folder
 * name, which must be lowercase letters, digits and hyphens.
 */
export function runIdOf(date: Date): string {
  return date.toISOString().replaceAll(/[:.]/g, "-").toLowerCase();
}
