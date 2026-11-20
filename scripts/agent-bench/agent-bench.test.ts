// The agent benchmark harness end to end, with a fake agent command and no model (issue
// #347). `fake-agent.ts` plays the agent's side of the contract in `agents/claude.ts`.
// Run with `pnpm test:scripts`, or `node --test scripts/agent-bench/agent-bench.test.ts`.
//
// It needs the CLI build on disk (`pnpm --filter saasaloy build`), because a run copies it
// out of the repo with `pnpm deploy`; it skips without one.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { claudeArgs, claudeEnv } from "./agents/claude.ts";
import { isInside } from "./harness.ts";

const root = resolve(import.meta.dirname, "../..");
const harness = join(root, "scripts/agent-bench.ts");
const fake = join(import.meta.dirname, "fake-agent.ts");
const noBuild = existsSync(join(root, "packages/cli/dist/index.js"))
  ? false
  : "no packages/cli/dist/index.js; run pnpm --filter saasaloy build";

function bench(runs: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    [
      harness,
      "--interview",
      "--brief",
      "shelfnote",
      "--agent",
      `${process.execPath} ${fake}`,
      "--runs",
      runs,
      "--no-build",
      "--static",
    ],
    {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        GITHUB_TOKEN: "ghp_must_not_reach_the_agent",
        ...env,
      },
      timeout: 120_000,
    }
  );
}

interface Seen {
  turn: number;
  session: string;
  message: string;
  cwd: string;
  block: string;
  registry: string;
  path: string;
  githubToken: string | null;
}

describe(
  "agent-bench in interview mode, with a fake agent",
  { skip: noBuild },
  () => {
    const runs = mkdtempSync(join(tmpdir(), "agent-bench-runs-"));
    after(() => {
      rmSync(runs, { recursive: true, force: true });
    });
    const result = bench(runs);
    const runId =
      readdirSync(runs).find((name) => !name.endsWith(".out")) ?? "";
    // Node resolves macOS's /var link in process.cwd(), which the fake agent records.
    const runDir = realpathSync(join(runs, runId));
    const outDir = `${runDir}.out`;
    const seen = (): Seen[] =>
      readFileSync(join(outDir, "state", "fake-agent.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Seen);

    it("runs to the end and scores the run", () => {
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stdout,
        /the build call exited 0 after the read-back/
      );
    });

    it("starts from one sentence and answers each question by number", () => {
      const calls = seen();
      assert.deepEqual(
        calls.map((call) => call.turn),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      );
      assert.equal(new Set(calls.map((call) => call.session)).size, 1);
      assert.equal(
        calls[0]?.message.trim(),
        readFileSync(join(import.meta.dirname, "opening.md"), "utf-8").trim()
      );
      assert.equal(calls[1]?.message, "1. Shelfnote");
      assert.match(
        calls[2]?.message ?? "",
        /^2\. English \(`en`\)\n\n3\. Adults/
      );
      assert.match(calls[5]?.message ?? "", /^Take your first sample answer/);
      assert.match(
        calls[9]?.message ?? "",
        /^15\. a\. No, keep it on my machine/
      );
      assert.equal(calls[10]?.message, "a");
    });

    it("runs the agent outside the repo, on its own port block, with no push token", () => {
      for (const call of seen()) {
        assert.equal(call.cwd, runDir);
        assert.equal(isInside(root, call.cwd), false);
        assert.equal(isInside(root, call.registry), false);
        assert.match(call.block, /^\d+$/);
        assert.equal(call.githubToken, null);
        assert.equal(isInside(root, call.path.split(":")[0] ?? ""), false);
      }
    });

    it("records the turns, the time and the cost in run.json and score.md", () => {
      const run = JSON.parse(
        readFileSync(join(outDir, "run.json"), "utf-8")
      ) as {
        mode: string;
        turns: number;
        costUsd: number;
        minutes: number;
        calls: unknown[];
      };
      assert.equal(run.mode, "interview");
      assert.equal(run.calls.length, 11);
      assert.equal(run.turns, 22);
      assert.equal(run.costUsd, 0.11);
      assert.equal(typeof run.minutes, "number");
      const report = readFileSync(join(outDir, "score.md"), "utf-8");
      assert.match(report, /^Brief: shelfnote$/m);
      assert.match(report, /^Mode: interview$/m);
      assert.match(report, /^Turns: 22 over 11 agent calls$/m);
      assert.match(report, /^Cost: \$0\.11/m);
      assert.match(report, /^Time: \d+ min$/m);
    });

    it("scores one read-back with no question after it, and no deploy call", () => {
      const report = readFileSync(join(outDir, "score.md"), "utf-8");
      assert.match(
        report,
        /\| Interview ends with one read-back, no question after it +\| PASS/
      );
      assert.match(
        report,
        /\| Preview answers when the brief asks for one +\| N\/A/
      );
    });

    it("lists the two agent lines, which a static run does not score", () => {
      const report = readFileSync(join(outDir, "score.md"), "utf-8");
      assert.match(
        report,
        /\| `pnpm agent:audit` exits 0 with a seeded key +\| FAIL +\| not run \(static scoring only\)/
      );
      assert.match(
        report,
        /\| A second agent with the address and a key creates and reads back one entity through MCP +\| FAIL +\| not run \(static scoring only\)/
      );
    });
  }
);

describe(
  "agent-bench with an agent that reports no turns",
  { skip: noBuild },
  () => {
    const runs = mkdtempSync(join(tmpdir(), "agent-bench-plain-"));
    after(() => {
      rmSync(runs, { recursive: true, force: true });
    });

    it("records the turns and the cost as unknown, never a guess", () => {
      const result = bench(runs, { FAKE_AGENT_PLAIN: "1" });
      assert.equal(result.status, 1, result.stderr);
      const out = readdirSync(runs).find((name) => name.endsWith(".out")) ?? "";
      const report = readFileSync(join(runs, out, "score.md"), "utf-8");
      assert.match(report, /^Turns: unknown/m);
      assert.match(report, /^Cost: unknown/m);
    });
  }
);

describe("agent-bench refuses a runs folder inside the repo", () => {
  it("exits 2 and names the folder", () => {
    const result = spawnSync(
      process.execPath,
      [harness, "--runs", join(root, ".dev", "bench"), "--no-build"],
      { cwd: root, encoding: "utf-8" }
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /inside this repo/);
  });
});

describe("claudeEnv", () => {
  it("turns background work off and points at the run's config folder", () => {
    const env = claudeEnv({ PATH: "/bin" }, "/state/claude-config");
    assert.equal(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1");
    assert.equal(env.CLAUDE_CONFIG_DIR, "/state/claude-config");
    assert.equal(env.PATH, "/bin");
  });
});

describe("claudeArgs", () => {
  const call = {
    message: "1. Shelfnote",
    session: "0f4e5a4e-0000-4000-8000-000000000000",
    maxTurns: "400",
    extra: ["--model", "claude-sonnet-5-5"],
    home: "/home/u",
  };

  it("starts the session on the first call and resumes it later", () => {
    const first = claudeArgs({ ...call, turn: 1 });
    assert.deepEqual(first.slice(0, 4), [
      "-p",
      "1. Shelfnote",
      "--session-id",
      call.session,
    ]);
    const later = claudeArgs({ ...call, turn: 2 });
    assert.deepEqual(later.slice(2, 4), ["--resume", call.session]);
  });

  it("prints stream-json, turns the picker off and passes the extra flags", () => {
    const args = claudeArgs({ ...call, turn: 1 });
    assert.ok(args.includes("stream-json"));
    assert.deepEqual(
      args.slice(
        args.indexOf("--disallowedTools"),
        args.indexOf("--disallowedTools") + 2
      ),
      ["--disallowedTools", "AskUserQuestion"]
    );
    assert.match(args.join(" "), /\/home\/u\/\.claude\/CLAUDE\.md/);
    assert.deepEqual(args.slice(-2), ["--model", "claude-sonnet-5-5"]);
  });
});
