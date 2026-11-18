// The second agent of the agent-use bar line (plan 0110 phase 7, issue #348). After the
// build, with the product's dev servers up and a key seeded (`./agent-use.ts` says how),
// the scorer starts one more agent that knows nothing about the build: it gets the site's
// address and the key in `./second-agent.md`, and must find the MCP server from the site's
// own `llms.txt`, create one row and read it back.
//
// It runs the same agent command as the build, through the same contract
// (`./agents/claude.ts`), as one call with a new session:
//
//   - its folder is a new empty folder in the system temp folder, outside this repo, the
//     run folder and the out folder, removed after the call;
//   - its environment is the harness's, cleaned by `cleanEnv`: no port block, no CLI on
//     PATH, no registry, no push token, no audit key;
//   - `AGENT_BENCH_STATE` is `<out>/second-agent/state`, a folder of its own, so a Claude
//     config of the build's agent does not load;
//   - its stdout goes to `<out>/second-agent/transcript.jsonl`, which the judge reads.
//
// Imports node: builtins and the files beside it. Node 24 strips the types.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanEnv } from "./harness.ts";
import { readTurnOutput } from "./interview.ts";
import { killGroup, killStrays, trackGroup, untrackGroup } from "./score.ts";
import type { SecondAgent, SecondAgentRun } from "./score.ts";

const PROMPT = join(import.meta.dirname, "second-agent.md");
const TIMEOUT_MS = 30 * 60_000;
const MAX_TURNS = "100";

/** The second agent's whole message: `second-agent.md` with the address and the key. */
export function secondAgentMessage(site: string, key: string): string {
  return readFileSync(PROMPT, "utf-8")
    .trim()
    .replaceAll("{{SITE}}", site)
    .replaceAll("{{KEY}}", key);
}

/** The scorer's hook that starts the second agent with `command`. */
export function secondAgent(options: {
  command: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): SecondAgent {
  return async ({ site, key, outDir }): Promise<SecondAgentRun> => {
    const own = join(outDir, "second-agent");
    const state = join(own, "state");
    mkdirSync(state, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), "agent-bench-second-"));
    const transcriptPath = join(own, "transcript.jsonl");
    const transcript = await open(transcriptPath, "w");
    const stderr = await open(join(own, "stderr.log"), "w");
    const [command = "", ...args] = options.command;
    const child = spawn(command, args, {
      cwd: work,
      env: {
        ...cleanEnv(options.env),
        AGENT_BENCH_TURN: "1",
        AGENT_BENCH_SESSION: randomUUID(),
        AGENT_BENCH_STATE: state,
        AGENT_BENCH_MAX_TURNS: MAX_TURNS,
      },
      detached: true,
      stdio: ["pipe", transcript.fd, stderr.fd],
    });
    trackGroup(child.pid);
    child.stdin?.on("error", () => {
      // The agent exited before it read its message; the exit code says why.
    });
    child.stdin?.end(secondAgentMessage(site, key));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, options.timeoutMs ?? TIMEOUT_MS);
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
    await killStrays(work);
    rmSync(work, { recursive: true, force: true });
    const stdout = readFileSync(transcriptPath, "utf-8");
    return {
      code,
      timedOut,
      transcript: stdout,
      reply: readTurnOutput(stdout).reply,
    };
  };
}
