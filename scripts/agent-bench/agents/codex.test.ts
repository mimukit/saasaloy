import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { readTurnOutput } from "../interview.ts";

it("resumes its own Codex thread and keeps raw evidence without inventing costs", () => {
  const state = mkdtempSync(join(tmpdir(), "bench-codex-test-"));
  try {
    const source = join(state, "source-home");
    mkdirSync(source);
    writeFileSync(join(source, "auth.json"), "fake login");
    writeFileSync(
      join(source, "AGENTS.md"),
      "Do not load these global instructions."
    );
    writeFileSync(
      join(source, "models_cache.json"),
      JSON.stringify({
        models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6.2-sol" }],
      })
    );
    const fake = join(state, "codex");
    writeFileSync(
      fake,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (fs.existsSync(process.env.CODEX_HOME + "/AGENTS.md")) process.exit(20);
if (fs.readFileSync(process.env.CODEX_HOME + "/auth.json", "utf8") !== "fake login") process.exit(21);
fs.appendFileSync(process.env.AGENT_BENCH_STATE + "/args", JSON.stringify(args) + "\\n");
let message = "";
process.stdin.on("data", (chunk) => { message += chunk; });
process.stdin.on("end", () => {
  if (process.env.FAKE_STOP === "1") {
    process.kill(process.ppid, "SIGTERM");
    return;
  }
  console.log(JSON.stringify({type: "thread.started", thread_id: "own-thread"}));
  console.log(JSON.stringify({type: "item.completed", item: {type: "command_execution", command: "tools/call", aggregated_output: "evidence"}}));
  console.log(JSON.stringify({type: "item.completed", item: {type: "agent_message", text: message}}));
  console.log(JSON.stringify({type: "turn.completed"}));
});
`
    );
    chmodSync(fake, 0o755);
    for (const turn of [1, 2]) {
      if (turn === 2) {
        writeFileSync(
          join(source, "models_cache.json"),
          JSON.stringify({ models: [{ slug: "gpt-7-sol" }] })
        );
      }
      const result = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "codex.ts")],
        {
          input: `reply ${String(turn)}`,
          encoding: "utf-8",
          env: {
            ...process.env,
            CODEX_HOME: source,
            PATH: `${state}:${process.env.PATH ?? ""}`,
            AGENT_BENCH_STATE: state,
            AGENT_BENCH_TURN: String(turn),
          },
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readTurnOutput(result.stdout), {
        reply: `reply ${String(turn)}`,
      });
      assert.match(result.stdout, /tools\/call/);
      assert.equal(existsSync(join(state, "codex-home", "auth.json")), false);
    }
    const args = readFileSync(join(state, "args"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(args[0]?.includes("resume"), false);
    const second = args[1] ?? [];
    assert.equal(second[second.indexOf("resume") + 1], "own-thread");
    assert.ok(second.includes('sandbox_mode="workspace-write"'));
    assert.ok(second.includes('approvals_reviewer="auto_review"'));
    assert.ok(second.includes("gpt-6.2-sol"));
    assert.ok(second.includes('model_reasoning_effort="medium"'));
    rmSync(join(source, "models_cache.json"));
    const custom = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "codex.ts"),
        "--model",
        "custom-sol",
        "--effort",
        "high",
      ],
      {
        input: "custom settings",
        encoding: "utf-8",
        env: {
          ...process.env,
          CODEX_HOME: source,
          PATH: `${state}:${process.env.PATH ?? ""}`,
          AGENT_BENCH_STATE: state,
          AGENT_BENCH_TURN: "1",
        },
      }
    );
    assert.equal(custom.status, 0, custom.stderr);
    const customArgs = JSON.parse(
      readFileSync(join(state, "args"), "utf-8").trim().split("\n").at(-1) ??
        "[]"
    ) as string[];
    assert.equal(customArgs.filter((arg) => arg === "--model").length, 1);
    assert.equal(customArgs[customArgs.indexOf("--model") + 1], "custom-sol");
    assert.ok(customArgs.includes('model_reasoning_effort="high"'));
    const stopped = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "codex.ts")],
      {
        input: "stop this call",
        env: {
          ...process.env,
          CODEX_HOME: source,
          PATH: `${state}:${process.env.PATH ?? ""}`,
          AGENT_BENCH_STATE: state,
          AGENT_BENCH_TURN: "1",
          FAKE_STOP: "1",
        },
      }
    );
    assert.equal(stopped.status, 143);
    assert.equal(existsSync(join(state, "codex-home", "auth.json")), false);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
