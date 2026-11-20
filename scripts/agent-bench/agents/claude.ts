// The default agent command of the agent benchmark: Claude Code, headless, one call per
// turn (plan 0109 phase 8, issue #347).
//
//   node scripts/agent-bench/agents/claude.ts [extra claude flags, such as --model <id>]
//
// `scripts/agent-bench.ts` runs an agent command once per turn, in the agent's folder, and
// talks to it through this contract, which any other agent command can follow too:
//
//   - stdin holds the message for this turn: the prompt, an answer, or the read-back answer;
//   - `AGENT_BENCH_TURN` is the call number, from 1;
//   - `AGENT_BENCH_SESSION` is one UUID for the whole run;
//   - `AGENT_BENCH_STATE` is a folder outside the agent's folder that lasts the whole run;
//   - `AGENT_BENCH_MAX_TURNS` caps the agent's own turns in one call;
//   - stdout is the call's transcript. A Claude Code `stream-json` `result` event in it
//     gives the reply, the turns and the cost; without one the harness takes the last
//     assistant text, or the whole output, and records the turns and the cost as unknown;
//   - the exit code is 0 when the call ended its turn normally.
//
// This adapter turns the contract into `claude -p`: `--session-id` on the first call and
// `--resume` on each later one, so every call continues one conversation. It isolates the
// agent from this box:
//   - `CLAUDE_CONFIG_DIR` is `<state>/claude-config`, a fresh folder, so this box's user
//     settings, skills, plugins and hooks do not load. The session lives there too, which
//     is why the folder must last the whole run. It carries only the credentials, copied
//     from `~/.claude/.credentials.json` when no token is in the environment.
//   - `claudeMdExcludes` names `~/.claude/CLAUDE.md`, which Claude Code reads even with a
//     fresh config folder.
//   - The question-picker tool is turned off. A picker call cannot be answered with no
//     terminal, so the agent asks in text, which the harness reads.
//   - Background work is turned off with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. `claude
//     -p` exits when the agent ends its turn and kills what still runs in the background.
//     A Prepline run lost its build that way: the agent started the build as a background
//     subagent after the read-back, ended its turn, and the build stopped mid-stage.
//
// Imports nothing but node: builtins. Node 24 strips the types.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ClaudeCall {
  message: string;
  turn: number;
  session: string;
  maxTurns: string;
  extra: string[];
  home: string;
}

/** The `claude` arguments for one call. */
export function claudeArgs(call: ClaudeCall): string[] {
  const settings = JSON.stringify({
    claudeMdExcludes: [join(call.home, ".claude", "CLAUDE.md")],
  });
  return [
    "-p",
    call.message,
    call.turn === 1 ? "--session-id" : "--resume",
    call.session,
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    call.maxTurns,
    "--output-format",
    "stream-json",
    "--verbose",
    "--disallowedTools",
    "AskUserQuestion",
    "--settings",
    settings,
    ...call.extra,
  ];
}

/** The environment of one `claude` call. See the header for each variable. */
export function claudeEnv(
  env: NodeJS.ProcessEnv,
  configDir: string
): NodeJS.ProcessEnv {
  return {
    ...env,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  };
}

function fail(message: string): never {
  process.stderr.write(`agent-bench claude: ${message}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const message = Buffer.concat(chunks).toString("utf-8").trim();
  const turn = Number(process.env.AGENT_BENCH_TURN ?? "1");
  const session = process.env.AGENT_BENCH_SESSION;
  const state = process.env.AGENT_BENCH_STATE;
  if (!session || !state || message === "") {
    fail("needs a message on stdin, AGENT_BENCH_SESSION and AGENT_BENCH_STATE");
  }

  const configDir = join(state, "claude-config");
  mkdirSync(configDir, { recursive: true });
  if (
    !process.env.CLAUDE_CODE_OAUTH_TOKEN &&
    !process.env.ANTHROPIC_API_KEY &&
    !existsSync(join(configDir, ".credentials.json"))
  ) {
    const credentials = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(credentials)) {
      fail(
        "no CLAUDE_CODE_OAUTH_TOKEN, no ANTHROPIC_API_KEY and no ~/.claude/.credentials.json"
      );
    }
    copyFileSync(credentials, join(configDir, ".credentials.json"));
  }

  const args = claudeArgs({
    message,
    turn,
    session,
    maxTurns: process.env.AGENT_BENCH_MAX_TURNS ?? "400",
    extra: process.argv.slice(2),
    home: homedir(),
  });
  const child = spawn("claude", args, {
    env: claudeEnv(process.env, configDir),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise<number>((done) => {
    child.on("error", () => {
      done(127);
    });
    child.on("exit", (exitCode) => {
      done(exitCode ?? 1);
    });
  });
  process.exit(code);
}

// Only when run directly, so the test can import `claudeArgs`.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
